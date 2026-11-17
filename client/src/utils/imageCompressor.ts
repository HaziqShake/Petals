// Smart in-app photo compressor (test-release).
// Replaces the old fixed 800px JPEG 0.6 path for new uploads. Legacy
// base64 photos are untouched and still render.
//
// Strategy: WebP, not JPEG. WebP at 0.85 looks about the same as JPEG at
// 0.92 and is 30-50 percent smaller. Start at 1920px longest edge and
// quality 0.86 with a 700KB target, then step quality down to 0.72, then
// shrink dimensions by 15 percent, max 5 tries. If the original is
// already under target, it is not recompressed at all.
// Re-encoding through canvas also strips EXIF and GPS. Orientation is
// handled by createImageBitmap with imageOrientation 'from-image'.

export interface CompressedPhoto {
  full: Blob;
  thumb: Blob;
  width: number;
  height: number;
  fullSize: number;
  thumbSize: number;
}

const TARGET_BYTES = 700 * 1024;
const START_MAX_DIM = 1920;
const START_QUALITY = 0.86;
// Any photo must be uploadable: the old loop stopped after 5 tries
// (quality 0.72, barely shrunk), so a detailed camera photo could
// still be over the Worker's 2 MB cap and the app told the user to
// "upload a smaller photo". Now the loop keeps going - quality down
// to 0.50, then dimensions down in 15% steps to 480px - until the
// result is under target, up to 20 tries. A 480px WebP at 0.50 is
// always far under 700 KB, so the loop is guaranteed to finish under
// target for any decodable image.
const MIN_QUALITY = 0.5;
const MIN_DIM = 480;
const MAX_TRIES = 20;

async function decodeFile(file: File): Promise<{ bitmap: ImageBitmap; width: number; height: number }> {
  try {
    const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
    return { bitmap, width: bitmap.width, height: bitmap.height };
  } catch {
    // Fallback for browsers without createImageBitmap orientation support.
    const url = URL.createObjectURL(file);
    try {
      const img = await new Promise<HTMLImageElement>((resolve, reject) => {
        const el = new Image();
        el.onload = () => resolve(el);
        el.onerror = () => reject(new Error('Failed to load image'));
        el.src = url;
      });
      const bitmap = await createImageBitmap(img);
      return { bitmap, width: img.naturalWidth || 800, height: img.naturalHeight || 800 };
    } finally {
      URL.revokeObjectURL(url);
    }
  }
}

function drawToBlob(
  bitmap: ImageBitmap,
  width: number,
  height: number,
  maxDim: number,
  quality: number,
): Promise<Blob> {
  const scale = Math.min(1, maxDim / Math.max(width, height));
  const w = Math.max(1, Math.round(width * scale));
  const h = Math.max(1, Math.round(height * scale));
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) return Promise.reject(new Error('Canvas 2D context unavailable'));
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(bitmap, 0, 0, w, h);
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error('WebP encode failed'))),
      'image/webp',
      quality,
    );
  });
}

export async function compressPhoto(
  file: File,
  opts: { targetBytes?: number; startMaxDim?: number; startQuality?: number } = {},
): Promise<CompressedPhoto> {
  const targetBytes = opts.targetBytes ?? TARGET_BYTES;
  // If the original is already small and already a web-friendly format,
  // keep it as-is instead of degrading it with a recompress.
  if (file.size <= targetBytes && (file.type === 'image/webp' || file.type === 'image/jpeg')) {
    const { bitmap, width, height } = await decodeFile(file);
    try {
      const thumb = await drawToBlob(bitmap, width, height, 400, 0.75);
      return { full: file, thumb, width, height, fullSize: file.size, thumbSize: thumb.size };
    } finally {
      bitmap.close();
    }
  }

  const { bitmap, width, height } = await decodeFile(file);
  try {
    let maxDim = opts.startMaxDim ?? START_MAX_DIM;
    let quality = opts.startQuality ?? START_QUALITY;
    let full: Blob = await drawToBlob(bitmap, width, height, maxDim, quality);
    for (let attempt = 1; attempt < MAX_TRIES && full.size > targetBytes; attempt++) {
      if (quality > MIN_QUALITY) {
        quality = Math.max(MIN_QUALITY, quality - 0.07);
      } else if (maxDim > MIN_DIM) {
        maxDim = Math.max(MIN_DIM, Math.round(maxDim * 0.85));
      } else {
        break;
      }
      full = await drawToBlob(bitmap, width, height, maxDim, quality);
    }
    // Last resort, should never be reached: one tiny pass that is
    // always under target, so no photo is ever rejected for size.
    if (full.size > targetBytes) {
      full = await drawToBlob(bitmap, width, height, MIN_DIM, MIN_QUALITY);
    }
    const thumb = await drawToBlob(bitmap, width, height, 400, 0.75);
    const scale = Math.min(1, maxDim / Math.max(width, height));
    return {
      full,
      thumb,
      width: Math.round(width * scale),
      height: Math.round(height * scale),
      fullSize: full.size,
      thumbSize: thumb.size,
    };
  } finally {
    bitmap.close();
  }
}

/** Poster frame for a video, drawn from the first frame. Best effort. */
export async function makeVideoPoster(file: File): Promise<Blob | null> {
  const url = URL.createObjectURL(file);
  try {
    const video = document.createElement('video');
    video.muted = true;
    video.playsInline = true;
    video.preload = 'metadata';
    video.src = url;
    await new Promise<void>((resolve, reject) => {
      video.onloadedmetadata = () => resolve();
      video.onerror = () => reject(new Error('Failed to load video metadata'));
      setTimeout(() => reject(new Error('Video metadata timed out')), 10000);
    });
    const seekTo = Math.min(0.5, (video.duration || 1) / 4);
    await new Promise<void>((resolve) => {
      video.onseeked = () => resolve();
      video.onerror = () => resolve();
      video.currentTime = seekTo;
      setTimeout(() => resolve(), 3000);
    });
    const scale = Math.min(1, 400 / Math.max(video.videoWidth || 400, video.videoHeight || 400));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round((video.videoWidth || 400) * scale));
    canvas.height = Math.max(1, Math.round((video.videoHeight || 400) * scale));
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    return await new Promise<Blob | null>((resolve) => {
      canvas.toBlob((b) => resolve(b), 'image/webp', 0.75);
    });
  } catch {
    return null;
  } finally {
    URL.revokeObjectURL(url);
  }
}

// Short-clip limits for the video prototype (test-release): 1 minute max,
// 720p max, 50MB max. No transcoding in the app, so clips over these limits
// are rejected with a friendly message instead of being silently downscaled.
// A Cloud Function transcode step is documented in docs/VIDEO_RESEARCH.md
// as a later step.
export const VIDEO_MAX_SECONDS = 60;
export const VIDEO_MAX_MB = 50;
export const VIDEO_MAX_WIDTH = 1280;
export const VIDEO_MAX_HEIGHT = 720;

export interface VideoInfo {
  durationSeconds: number;
  width: number;
  height: number;
}

/** Read duration and resolution from a video file without uploading it. */
export async function getVideoInfo(file: File): Promise<VideoInfo> {
  const url = URL.createObjectURL(file);
  try {
    const video = document.createElement('video');
    video.muted = true;
    video.playsInline = true;
    video.preload = 'metadata';
    video.src = url;
    await new Promise<void>((resolve, reject) => {
      video.onloadedmetadata = () => resolve();
      video.onerror = () => reject(new Error('Could not read this video file.'));
      setTimeout(() => reject(new Error('Could not read this video file.')), 10000);
    });
    return {
      durationSeconds: video.duration || 0,
      width: video.videoWidth || 0,
      height: video.videoHeight || 0,
    };
  } finally {
    URL.revokeObjectURL(url);
  }
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}
