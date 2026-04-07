/**
 * Compress an image file to a base64 data URL using native Canvas.
 * Max 800px longest edge, JPEG quality 0.6.
 * No external libraries, no Web Workers, no network — pure browser APIs.
 */
export function compressToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const objectUrl = URL.createObjectURL(file);
    const img = new Image();

    img.onload = () => {
      URL.revokeObjectURL(objectUrl);

      const MAX_SIZE = 800;
      let { width, height } = img;

      if (width > height && width > MAX_SIZE) {
        height *= MAX_SIZE / width;
        width = MAX_SIZE;
      } else if (height > MAX_SIZE) {
        width *= MAX_SIZE / height;
        height = MAX_SIZE;
      }

      const canvas = document.createElement('canvas');
      canvas.width = Math.round(width);
      canvas.height = Math.round(height);
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        reject(new Error('Canvas 2D context unavailable'));
        return;
      }

      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      const dataUrl = canvas.toDataURL('image/jpeg', 0.6);
      resolve(dataUrl);
    };

    img.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error('Failed to load image for compression'));
    };

    img.src = objectUrl;
  });
}

/**
 * Measure an image file's natural dimensions without any network calls.
 */
export function measureImage(file: File): Promise<{ w: number; h: number }> {
  return new Promise((resolve) => {
    const objectUrl = URL.createObjectURL(file);
    const img = new Image();

    img.onload = () => {
      URL.revokeObjectURL(objectUrl);
      resolve({ w: img.naturalWidth || 800, h: img.naturalHeight || 800 });
    };

    img.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      resolve({ w: 800, h: 800 }); // Safe fallback
    };

    img.src = objectUrl;
  });
}

/**
 * Apply white stroke outline to an image blob via Canvas API.
 * Used for custom stickers.
 */
export async function applyWhiteOutline(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const outlinePx = 6;
      const canvas = document.createElement('canvas');
      canvas.width = img.width + outlinePx * 2;
      canvas.height = img.height + outlinePx * 2;
      const ctx = canvas.getContext('2d')!;

      // Draw white-filled scaled-up version as outline mask
      ctx.save();
      ctx.filter = 'brightness(0) invert(1)';
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      ctx.restore();

      // Multiply pass to make outline white
      ctx.globalCompositeOperation = 'destination-over';
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.globalCompositeOperation = 'source-over';

      // Draw actual image centered
      ctx.drawImage(img, outlinePx, outlinePx, img.width, img.height);

      URL.revokeObjectURL(url);
      resolve(canvas.toDataURL('image/png'));
    };
    img.onerror = reject;
    img.src = url;
  });
}

/**
 * Deterministic photo tilt from photo ID: -3deg to +3deg.
 */
export function getPhotoTilt(id: string): number {
  let hash = 0;
  for (let i = 0; i < id.length; i++) {
    hash = (hash * 31 + id.charCodeAt(i)) & 0xffffffff;
  }
  return ((hash % 600) / 100) - 3;
}

/** Generate a unique ID (no uuid library) */
export function uid(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Download an image from a URL (supports both data URLs and remote URLs).
 */
export async function downloadImage(url: string, filename = 'petal-memory.jpg') {
  try {
    // For data URLs, create link directly
    if (url.startsWith('data:')) {
      const link = document.createElement('a');
      link.href = url;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      return;
    }

    // For remote URLs, fetch then download
    const response = await fetch(url);
    const blob = await response.blob();
    const blobUrl = URL.createObjectURL(blob);

    const link = document.createElement('a');
    link.href = blobUrl;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);

    setTimeout(() => URL.revokeObjectURL(blobUrl), 100);
  } catch (err) {
    console.error('Download failed:', err);
    window.open(url, '_blank');
  }
}
