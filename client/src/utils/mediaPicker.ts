// Custom media picker: the JS side of PetalsMediaPlugin.java.
// On Android it lists the device's recent photos and videos with
// real thumbnails, so the picker is a custom in-app sheet, not the
// system file chooser. On web, or if the plugin is missing, every
// call rejects and callers fall back to the system file input.
import { Capacitor, registerPlugin } from '@capacitor/core';

export interface PickerMediaItem {
  id: string;
  mediaType: 'image' | 'video';
  mimeType: string;
  name: string;
  dateAdded: number;
  width: number;
  height: number;
  durationSeconds: number;
  // Absolute cache file path for the 400px thumbnail, when available.
  thumbPath?: string;
}

interface PetalsMediaPlugin {
  getRecentMedia(options: { limit?: number }): Promise<{ items: PickerMediaItem[] }>;
  getMediaFile(options: { id: string; mediaType: string }): Promise<{ path: string; name: string; mimeType: string; size: number }>;
  requestMediaPermission(): Promise<void>;
}

const PetalsMedia = registerPlugin<PetalsMediaPlugin>('PetalsMedia');

export function isNativePickerAvailable(): boolean {
  return Capacitor.isNativePlatform();
}

// Thumbnail src for an <img>: a cache file path becomes a WebView URL.
export function thumbSrc(item: PickerMediaItem): string | null {
  return item.thumbPath ? Capacitor.convertFileSrc(item.thumbPath) : null;
}

export async function listRecentMedia(limit = 60): Promise<PickerMediaItem[]> {
  const out = await PetalsMedia.getRecentMedia({ limit });
  return out.items ?? [];
}

export async function requestMediaPermission(): Promise<void> {
  await PetalsMedia.requestMediaPermission();
}

// Full original as a File, ready for the normal send flow
// (compressor for photos, validation for videos).
export async function pickMediaFile(item: PickerMediaItem): Promise<File> {
  const out = await PetalsMedia.getMediaFile({ id: item.id, mediaType: item.mediaType });
  const res = await fetch(Capacitor.convertFileSrc(out.path));
  if (!res.ok) throw new Error('Could not read the selected media.');
  const blob = await res.blob();
  return new File([blob], out.name || item.name || `petals-media`, { type: out.mimeType || item.mimeType });
}
