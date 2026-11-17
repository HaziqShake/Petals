// Hidden app-private media storage (test-release).
//
// Where files live:
// - Android (Capacitor): external app-specific storage,
//   Android/data/com.hi.petals/files/Petals/
//   That is Capacitor Filesystem Directory.External, which maps to
//   getExternalFilesDir(). It is NOT internal /data/data storage, so a
//   file manager can navigate to that exact path and see the files
//   without root. A .nomedia file sits in the folder, and MediaStore
//   does not scan Android/data at all, so Gallery apps will not index
//   these files and they will not show up in Gallery or Files search.
//   They are still findable in Petals itself, because the app knows
//   each file by its id and metadata, and in a file manager, by path.
// - Web: IndexedDB blobs (utils/localStore.ts). There is no file path
//   on web, so Export / Save to Gallery is the way to get a real file.
//
// Save to Gallery is always a COPY by default: the hidden app copy
// stays, a second copy is written to Pictures/Petals (photos) or
// Movies/Petals (videos) through the native MediaStore plugin, so it
// appears in Gallery. Settings can switch it to MOVE, which deletes
// the hidden copy after a successful save. See TEST_RELEASE_NOTES.md.
//
// Auto-download: on by default, on both WiFi and mobile data. There
// is no WiFi-only mode any more: uploads and downloads work the same
// on WiFi and on data.
import { Capacitor, registerPlugin } from '@capacitor/core';
import { Filesystem, Directory } from '@capacitor/filesystem';
import { getCachedBlobUrl, putBlob, deleteLocalBlob, type BlobMeta } from './localStore';

export const HIDDEN_FOLDER = 'Petals';
// Exact on-device path, shown in Settings. com.hi.petals is the app id
// in capacitor.config.ts; if the app id ever changes, this changes too.
export const HIDDEN_FOLDER_PATH = 'Android/data/com.hi.petals/files/Petals/';
export const GALLERY_FOLDER = 'Pictures/Petals (photos) / Movies/Petals (videos)';

export interface MediaSettings {
  autoDownload: boolean;
  autoDownloadOnMobileData: boolean;
  // false = copy to Gallery and keep the hidden Petals copy (default).
  // true = move: delete the hidden copy after a successful save.
  saveAsMove: boolean;
}
export const DEFAULT_MEDIA_SETTINGS: MediaSettings = {
  autoDownload: true,
  autoDownloadOnMobileData: false,
  saveAsMove: false,
};
const SETTINGS_KEY = 'petals_media_settings';

export function getMediaSettings(): MediaSettings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (!raw) return { ...DEFAULT_MEDIA_SETTINGS };
    return { ...DEFAULT_MEDIA_SETTINGS, ...(JSON.parse(raw) as Partial<MediaSettings>) };
  } catch {
    return { ...DEFAULT_MEDIA_SETTINGS };
  }
}
export function setMediaSettings(next: Partial<MediaSettings>): MediaSettings {
  const merged = { ...getMediaSettings(), ...next };
  try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(merged)); } catch { /* ignore */ }
  return merged;
}

// Should a full file auto-download right now? Thumbnails are not
// gated by this; only full photos and videos are. Works on WiFi and
// on mobile data alike.
export function shouldAutoDownload(): boolean {
  return getMediaSettings().autoDownload;
}

export function isNative(): boolean {
  return Capacitor.isNativePlatform();
}
export function hiddenFileName(id: string, mimeType?: string): string {
  const ext = mimeType === 'video/mp4' ? 'mp4' : mimeType === 'image/webp' ? 'webp' : mimeType?.startsWith('video/') ? 'mp4' : 'webp';
  return `${id}.${ext}`;
}
function extFor(mimeType?: string): string {
  return mimeType?.startsWith('video/') ? 'mp4' : 'webp';
}

// Native plugin (android/app/src/main/java/com/hi/petals/
// PetalsFilesPlugin.java, registered in MainActivity). It reads the
// hidden file by name and writes it to MediaStore, and opens the
// hidden folder in the system Files app. On web, or if the plugin is
// not present, calls reject and the callers fall back to a download
// or to copying the path, never to a silent failure.
interface PetalsFilesPlugin {
  saveToGallery(options: { fileName: string; mimeType: string; isVideo: boolean }): Promise<{ uri: string }>;
  openFolder(): Promise<void>;
}
const PetalsFiles = registerPlugin<PetalsFilesPlugin>('PetalsFiles');

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = String(reader.result ?? '');
      resolve(dataUrl.slice(dataUrl.indexOf(',') + 1));
    };
    reader.onerror = () => reject(reader.error ?? new Error('Could not read file'));
    reader.readAsDataURL(blob);
  });
}

// Create the hidden folder and its .nomedia file. Safe to call on
// every launch; writing .nomedia twice is harmless.
export async function ensureHiddenFolder(): Promise<void> {
  if (!isNative()) return;
  try {
    await Filesystem.writeFile({
      path: `${HIDDEN_FOLDER}/.nomedia`,
      data: '',
      directory: Directory.External,
      recursive: true,
    });
  } catch { /* best effort; the folder is still app-specific and unscanned */ }
}

// Save a full compressed file as the hidden primary copy. On Android
// this is a real file in Android/data/com.hi.petals/files/Petals/;
// on web it is an IndexedDB blob under the same id.
export async function saveHiddenMedia(id: string, blob: Blob, mimeType?: string): Promise<void> {
  const fileName = hiddenFileName(id, mimeType);
  if (isNative()) {
    await ensureHiddenFolder();
    const data = await blobToBase64(blob);
    await Filesystem.writeFile({
      path: `${HIDDEN_FOLDER}/${fileName}`,
      data,
      directory: Directory.External,
      recursive: true,
    });
    return;
  }
  await putBlob(`local:${id}`, blob, { kind: mimeType?.startsWith('video/') ? 'video' : 'image' }).catch(() => undefined);
}

export async function hasHiddenMedia(id: string, mimeType?: string): Promise<boolean> {
  if (isNative()) {
    try {
      await Filesystem.stat({ path: `${HIDDEN_FOLDER}/${hiddenFileName(id, mimeType)}`, directory: Directory.External });
      return true;
    } catch { return false; }
  }
  return (await getCachedBlobUrl(`local:${id}`)) !== null;
}

// A displayable URL for a hidden file, or null. On Android this is a
// Capacitor file URL for the real file; on web it is a blob URL.
export async function getHiddenMediaSrc(id: string, mimeType?: string): Promise<string | null> {
  if (isNative()) {
    try {
      const uri = await Filesystem.getUri({ path: `${HIDDEN_FOLDER}/${hiddenFileName(id, mimeType)}`, directory: Directory.External });
      return Capacitor.convertFileSrc(uri.uri);
    } catch { return null; }
  }
  return getCachedBlobUrl(`local:${id}`);
}

export async function deleteHiddenMedia(id: string, mimeType?: string): Promise<void> {
  if (isNative()) {
    await Filesystem.deleteFile({ path: `${HIDDEN_FOLDER}/${hiddenFileName(id, mimeType)}`, directory: Directory.External }).catch(() => undefined);
    return;
  }
  await deleteLocalBlob(`local:${id}`);
}

// Copy the hidden file to the visible Gallery, Pictures/Petals or
// Movies/Petals, through MediaStore, so it appears in Gallery search.
// Returns the gallery uri on native, or 'downloaded' on web. When
// saveAsMove is on in Settings, the hidden copy is deleted after a
// successful save; otherwise it is kept, so the app copy stays hidden
// and the gallery copy is the visible one.
export async function saveToGallery(id: string, blob: Blob, mimeType?: string): Promise<string> {
  const fileName = hiddenFileName(id, mimeType);
  const isVideo = (mimeType ?? '').startsWith('video/');
  if (isNative()) {
    // The plugin reads the hidden file by name, so make sure it is there.
    await saveHiddenMedia(id, blob, mimeType).catch(() => undefined);
    try {
      const res = await PetalsFiles.saveToGallery({ fileName, mimeType: mimeType ?? (isVideo ? 'video/mp4' : 'image/webp'), isVideo });
      if (getMediaSettings().saveAsMove) await deleteHiddenMedia(id, mimeType);
      return res.uri;
    } catch {
      // Fallback: write into the public Documents folder. This is not
      // the Gallery path and may not be indexed immediately; the
      // MediaStore plugin is the real path, this only avoids losing
      // the save entirely on a device where the plugin is missing.
      const data = await blobToBase64(blob);
      await Filesystem.writeFile({
        path: `Petals/${fileName}`,
        data,
        directory: Directory.Documents,
        recursive: true,
      });
      if (getMediaSettings().saveAsMove) await deleteHiddenMedia(id, mimeType);
      return 'documents';
    }
  }
  // Web: no Gallery and no file path, so this is a browser download.
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  return 'downloaded';
}

// Fetch a remote file, then save it to the Gallery. Used by the
// Lightbox, Chat bubbles and Photos grid, which only have a URL.
export async function saveUrlToGallery(url: string, id: string, mimeType?: string): Promise<string> {
  const res = await fetch(url);
  if (!res.ok) throw new Error('Could not download that file');
  const blob = await res.blob();
  return saveToGallery(id, blob, mimeType ?? blob.type);
}

// Open the hidden folder in the system Files app, so the user can see
// the files by path. Falls back to copying the exact path to the
// clipboard when the Files app cannot be opened directly.
export async function openHiddenFolder(): Promise<'opened' | 'copied'> {
  if (isNative()) {
    try {
      await PetalsFiles.openFolder();
      return 'opened';
    } catch { /* fall through to copying the path */ }
  }
  try {
    await navigator.clipboard.writeText(HIDDEN_FOLDER_PATH);
  } catch { /* clipboard may be unavailable */ }
  return 'copied';
}

export type { BlobMeta };
export { extFor };
