// Local-first cache (test-release). Light IndexedDB wrapper, no new
// dependency. Firestore persistent cache (firebase.ts) already queues
// document writes offline; this layer adds what Firestore does not:
// cached thumbnails and compressed photos as Blobs, cache-first reads
// for notes and messages, a 24h update-check cache, and an explicit
// offline queue for media uploads (Firestore does not queue Storage
// uploads).
//
// Client-side primary (test-release, 2026-11-17): the full compressed
// photo/video is stored on the device first, in IndexedDB here on web
// and in app-private external storage on Android, see
// utils/mediaStore.ts, which uses the same blobs. Storage is only a
// transient relay for sharing: the full file is deleted from Storage
// once both room members confirm they have it cached locally, the
// thumbnail stays in Storage. Firestore/Storage stay the source of
// truth for metadata and sharing between the two users; this cache only
// avoids re-downloading and re-reading what is already on the device.
// It is best-effort storage: the browser/WebView may evict it under
// storage pressure, and clearing the app data removes it. The relay
// file is the only copy that can rebuild it, so a device that clears
// its cache after the relay was deleted cannot get that full file back
// from the server, only its thumbnail, unless the item was later
// archived to Storage by the 30-day archive job (utils/mediaArchive.ts),
// in which case the archived copy is the way back. See TEST_RELEASE_NOTES.md.
//
// Stores: kv, notes, messages, rooms, profiles, blobs, blobMeta, queue.
// Blobs are capped at 500MB total media cache (see below). Thumbnails
// and compressed photos first, short video clips (the compressed 720p
// file, never the original) next. Full videos over 50MB are never
// stored, only their thumbnails. Eviction is LRU by last viewed time,
// favourites/pinned media is never evicted. Clear it from Settings.
// Clearing never deletes server data.
import type { Note } from '../../../shared/types';
import type { ChatMessage } from '../../../shared/types';
import { getDownloadUrl } from './b2Storage';

const DB_NAME = 'petals-local';
const DB_VERSION = 2;
const STORES = ['kv', 'notes', 'messages', 'rooms', 'profiles', 'blobs', 'blobMeta', 'queue'] as const;
export const MEDIA_CACHE_BUDGET_BYTES = 500 * 1024 * 1024;
export const MAX_CACHED_VIDEO_BYTES = 50 * 1024 * 1024;
export const MAX_CACHED_BLOB_BYTES = 50 * 1024 * 1024;

export interface BlobMeta {
  url: string;
  size: number;
  kind: 'image' | 'video' | 'thumb' | 'other';
  pinned: boolean;
  lastViewedAt: number;
  createdAt: number;
  // 30-day archive to server (test-release, revised 2026-11-17):
  // downloadedAt is when the full file was first saved locally (same
  // as createdAt), lastAccessedAt is the last open (kept in sync with
  // lastViewedAt). After 30 days without being opened, the file is NOT
  // wiped: utils/mediaArchive.ts uploads it back to Storage first and
  // only then deletes the local copy. Thumbnails and pinned media are
  // never archived by the expiry sweep. roomId/noteId/mediaId/
  // storagePath let the archive job find the Firestore doc to update;
  // they are filled in by the callers that know them (NoteEditorPage,
  // ChatPage), and the archive job can also parse storagePath back out
  // of a Firebase download URL when they are missing.
  downloadedAt?: number;
  lastAccessedAt?: number;
  roomId?: string;
  noteId?: string;
  mediaId?: string;
  storagePath?: string;
  mediaType?: 'image' | 'video';
  isViewOnce?: boolean;
  serverStored?: boolean;
  archivedAt?: number;
  archivedUrl?: string;
  archivedPath?: string;
}
export interface CacheSize {
  bytes: number;
  items: number;
  pinnedItems: number;
  budgetBytes: number;
  quotaBytes: number | null;
  usageBytes: number | null;
}

export interface QueuedJob {
  id: string;
  kind: 'chat-media' | 'note-media';
  roomId: string;
  noteId?: string;
  fileName: string;
  fileType: string;
  isVideo: boolean;
  isViewOnce: boolean;
  createdAt: number;
  // The File/Blob itself is stored in the blobs store under `blob:<id>`.
}

let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      for (const s of STORES) if (!db.objectStoreNames.contains(s)) db.createObjectStore(s);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('IndexedDB open failed'));
  });
  return dbPromise;
}

async function tx<T>(store: string, mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const t = db.transaction(store, mode);
    const req = fn(t.objectStore(store));
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('IndexedDB request failed'));
  });
}

async function put(store: string, key: string, value: unknown): Promise<void> {
  await tx(store, 'readwrite', (s) => s.put(value, key));
}
async function get<T>(store: string, key: string): Promise<T | undefined> {
  return tx<T | undefined>(store, 'readonly', (s) => s.get(key));
}
async function del(store: string, key: string): Promise<void> {
  await tx(store, 'readwrite', (s) => s.delete(key));
}
async function all<T>(store: string): Promise<T[]> {
  return tx<T[]>(store, 'readonly', (s) => s.getAll());
}
async function clearStore(store: string): Promise<void> {
  await tx(store, 'readwrite', (s) => s.clear());
}

// Key-value, with optional expiry for things like the update check.
export async function kvSet(key: string, value: unknown, ttlMs?: number): Promise<void> {
  await put('kv', key, { value, expiresAt: ttlMs ? Date.now() + ttlMs : 0 }).catch(() => undefined);
}
export async function kvGet<T>(key: string): Promise<T | undefined> {
  const row = await get<{ value: T; expiresAt: number }>('kv', key).catch(() => undefined);
  if (!row) return undefined;
  if (row.expiresAt && row.expiresAt < Date.now()) { void del('kv', key); return undefined; }
  return row.value;
}

// Notes and messages: cache-first reads. Keyed by room, so switching
// rooms never shows the other room's cached data.
export async function cacheNotes(roomId: string, notes: Note[]): Promise<void> {
  await put('notes', roomId, { notes, cachedAt: Date.now() }).catch(() => undefined);
}
export async function getCachedNotes(roomId: string): Promise<Note[] | undefined> {
  const row = await get<{ notes: Note[] }>('notes', roomId).catch(() => undefined);
  return row?.notes;
}
export async function cacheMessages(roomId: string, messages: ChatMessage[]): Promise<void> {
  await put('messages', roomId, { messages: messages.slice(-100), cachedAt: Date.now() }).catch(() => undefined);
}
export async function getCachedMessages(roomId: string): Promise<ChatMessage[] | undefined> {
  const row = await get<{ messages: ChatMessage[] }>('messages', roomId).catch(() => undefined);
  return row?.messages;
}
export async function cacheRoom(roomId: string, room: unknown): Promise<void> {
  await put('rooms', roomId, { room, cachedAt: Date.now() }).catch(() => undefined);
}
export async function getCachedRoom<T>(roomId: string): Promise<T | undefined> {
  const row = await get<{ room: T }>('rooms', roomId).catch(() => undefined);
  return row?.room;
}

// Effective media budget: 500MB, or 60 percent of the browser storage
// quota when navigator.storage.estimate reports a smaller quota.
export async function effectiveMediaBudget(): Promise<number> {
  try {
    const est = await navigator.storage?.estimate?.();
    if (est?.quota) return Math.min(MEDIA_CACHE_BUDGET_BYTES, Math.floor(est.quota * 0.6));
  } catch { /* fall through */ }
  return MEDIA_CACHE_BUDGET_BYTES;
}
export async function getCacheSize(): Promise<CacheSize> {
  let bytes = 0; let items = 0; let pinnedItems = 0;
  try {
    const metas = await all<BlobMeta>('blobMeta');
    for (const m of metas) { bytes += m.size; items += 1; if (m.pinned) pinnedItems += 1; }
    // Blobs without meta (v1 cache, queue blobs) are counted too.
    const db = await openDb();
    const keys = await new Promise<string[]>((resolve, reject) => {
      const req = db.transaction('blobs', 'readonly').objectStore('blobs').getAllKeys();
      req.onsuccess = () => resolve(req.result as string[]);
      req.onerror = () => reject(req.error);
    });
    const metaKeys = new Set(metas.map((m) => m.url));
    for (const k of keys) {
      if (metaKeys.has(k) || k.startsWith('blob:')) continue;
      const b = await get<Blob>('blobs', k);
      if (b) { bytes += b.size; items += 1; }
    }
  } catch { /* size is best effort */ }
  let quota: number | null = null; let usage: number | null = null;
  try {
    const est = await navigator.storage?.estimate?.();
    quota = est?.quota ?? null; usage = est?.usage ?? null;
  } catch { /* ignore */ }
  return { bytes, items, pinnedItems, budgetBytes: MEDIA_CACHE_BUDGET_BYTES, quotaBytes: quota, usageBytes: usage };
}
export async function setBlobPinned(url: string, pinned: boolean): Promise<void> {
  const meta = await get<BlobMeta>('blobMeta', url).catch(() => undefined);
  if (meta) await put('blobMeta', url, { ...meta, pinned }).catch(() => undefined);
  else await put('blobMeta', url, { url, size: 0, kind: 'other', pinned, lastViewedAt: Date.now(), createdAt: Date.now(), downloadedAt: Date.now(), lastAccessedAt: Date.now() }).catch(() => undefined);
}
// Record an open of a cached blob: this is the access time the 30-day
// archive counts from. Exported for mediaStore, which tracks the
// same timestamps for the native hidden files.
export async function recordBlobAccess(url: string): Promise<void> {
  await touchBlob(url);
}
async function touchBlob(url: string): Promise<void> {
  const meta = await get<BlobMeta>('blobMeta', url).catch(() => undefined);
  if (meta) await put('blobMeta', url, { ...meta, lastViewedAt: Date.now(), lastAccessedAt: Date.now() }).catch(() => undefined);
}

// Blobs: thumbnails and compressed photos, keyed by their URL.
// Returns an object URL for a cached blob, or null on a miss. Callers
// must revoke object URLs they create from a fresh fetch, not cached ones
// they did not create; getCachedBlobUrl tracks that for them.
const objectUrls = new Map<string, string>();
export async function getCachedBlobUrl(url: string): Promise<string | null> {
  if (!url || url.startsWith('data:')) return null;
  const hit = objectUrls.get(url);
  if (hit) return hit;
  const blob = await get<Blob>('blobs', url).catch(() => undefined);
  if (!blob) return null;
  void touchBlob(url);
  const objectUrl = URL.createObjectURL(blob);
  objectUrls.set(url, objectUrl);
  return objectUrl;
}
export async function fetchBlobCached(url: string, opts: { kind?: BlobMeta['kind']; maxBytes?: number; roomId?: string; noteId?: string; mediaId?: string; storagePath?: string; mediaType?: 'image' | 'video'; isViewOnce?: boolean } = {}): Promise<string> {
  const cached = await getCachedBlobUrl(url);
  if (cached) return cached;
  let res = await fetch(url);
  if (res.status === 403 && opts.storagePath) {
    // B2 presigned URLs expire (1 hour). The stored URL in Firestore is
    // stale; mint a fresh one from the B2 key and retry once. The blob
    // is still cached under the original (stable) URL, so the next open
    // hits the cache instead of re-signing.
    try {
      const freshUrl = await getDownloadUrl(opts.storagePath);
      res = await fetch(freshUrl);
    } catch { /* fall through and throw the download error below */ }
  }
  if (!res.ok) throw new Error('Download failed');
  const blob = await res.blob();
  const maxBytes = opts.maxBytes ?? MAX_CACHED_BLOB_BYTES;
  if (blob.size <= maxBytes) await putBlob(url, blob, { kind: opts.kind ?? 'image', roomId: opts.roomId, noteId: opts.noteId, mediaId: opts.mediaId, storagePath: opts.storagePath, mediaType: opts.mediaType, isViewOnce: opts.isViewOnce }).catch(() => undefined);
  const objectUrl = URL.createObjectURL(blob);
  objectUrls.set(url, objectUrl);
  return objectUrl;
}
// Cache a short video clip locally. Only the compressed 720p file, never
// the original, and never a file over 50MB: those keep only a thumbnail.
// Returns the object URL on a hit/store, or the remote URL when the
// clip is too big to cache.
export async function fetchVideoCached(url: string, thumbUrl?: string, opts: { roomId?: string; mediaId?: string; storagePath?: string; isViewOnce?: boolean } = {}): Promise<string> {
  const cached = await getCachedBlobUrl(url);
  if (cached) return cached;
  if (thumbUrl) void fetchBlobCached(thumbUrl, { kind: 'thumb' }).catch(() => undefined);
  let res = await fetch(url);
  if (res.status === 403 && opts.storagePath) {
    // Expired presigned URL: mint a fresh one from the B2 key and retry
    // once, same as fetchBlobCached above.
    try {
      res = await fetch(await getDownloadUrl(opts.storagePath));
    } catch { /* fall through; the stale URL is returned below */ }
  }
  if (!res.ok) return url;
  const blob = await res.blob();
  if (blob.size > MAX_CACHED_VIDEO_BYTES) return url;
  await putBlob(url, blob, { kind: 'video', roomId: opts.roomId, mediaId: opts.mediaId, storagePath: opts.storagePath, mediaType: 'video', isViewOnce: opts.isViewOnce }).catch(() => undefined);
  const objectUrl = URL.createObjectURL(blob);
  objectUrls.set(url, objectUrl);
  return objectUrl;
}
export async function putBlob(url: string, blob: Blob, opts: { kind?: BlobMeta['kind']; pinned?: boolean; roomId?: string; noteId?: string; mediaId?: string; storagePath?: string; mediaType?: 'image' | 'video'; isViewOnce?: boolean } = {}): Promise<void> {
  if (blob.size > MAX_CACHED_BLOB_BYTES && opts.kind !== 'video') return;
  if (opts.kind === 'video' && blob.size > MAX_CACHED_VIDEO_BYTES) return;
  await put('blobs', url, blob);
  const prev = await get<BlobMeta>('blobMeta', url).catch(() => undefined);
  await put('blobMeta', url, { url, size: blob.size, kind: opts.kind ?? 'image', pinned: opts.pinned ?? prev?.pinned ?? false, lastViewedAt: Date.now(), createdAt: prev?.createdAt ?? Date.now(), downloadedAt: prev?.downloadedAt ?? Date.now(), lastAccessedAt: Date.now(), roomId: opts.roomId ?? prev?.roomId, noteId: opts.noteId ?? prev?.noteId, mediaId: opts.mediaId ?? prev?.mediaId, storagePath: opts.storagePath ?? prev?.storagePath, mediaType: opts.mediaType ?? prev?.mediaType, isViewOnce: opts.isViewOnce ?? prev?.isViewOnce, serverStored: prev?.serverStored, archivedAt: prev?.archivedAt, archivedUrl: prev?.archivedUrl, archivedPath: prev?.archivedPath }).catch(() => undefined);
  void pruneBlobs();
}

// Read helpers for the archive job (utils/mediaArchive.ts).
export async function listBlobMetas(): Promise<BlobMeta[]> {
  return all<BlobMeta>('blobMeta').catch(() => []);
}
export async function getBlob(url: string): Promise<Blob | undefined> {
  return get<Blob>('blobs', url).catch(() => undefined);
}

// Delete one cached full file by its URL, but never a thumbnail, a
// pinned (favourite) file, or an offline-queue blob. Returns true when
// something was actually deleted. Used by the 30-day archive job, which
// calls it only after the server upload is verified.
export async function deleteCachedFullBlob(url: string): Promise<boolean> {
  if (!url || url.startsWith('blob:') || url.startsWith('data:')) return false;
  const meta = await get<BlobMeta>('blobMeta', url).catch(() => undefined);
  if (meta && (meta.kind === 'thumb' || meta.pinned)) return false;
  await deleteLocalBlob(url);
  return true;
}

// 30-day archive candidates for the IndexedDB blob cache (web, and
// the web half of the native build). Returns full image/video blobs
// that have not been opened for longer than retentionMs. Thumbnails
// (kind 'thumb'), pinned/favourite media, view-once media, and
// offline-queue blobs are never returned. This only LISTS candidates;
// utils/mediaArchive.ts uploads each one to Storage first and only
// then deletes the local copy. Nothing is wiped here.
export async function listExpiredBlobMetas(retentionMs: number): Promise<BlobMeta[]> {
  const now = Date.now();
  try {
    const metas = await all<BlobMeta>('blobMeta');
    return metas.filter((m) => {
      if (m.pinned || m.kind === 'thumb' || m.isViewOnce || m.serverStored) return false;
      if (m.url.startsWith('blob:')) return false;
      const lastAccess = m.lastAccessedAt ?? m.lastViewedAt ?? m.downloadedAt ?? m.createdAt;
      return now - lastAccess > retentionMs;
    });
  } catch { return []; }
}

// Save a full compressed file locally as the primary copy, at upload
// time, so the uploader never has to re-download their own photo. This
// is the same putBlob as the download cache, called eagerly instead of
// on first view. Asks the browser to keep the storage persistent, best
// effort: it may still be evicted, see the header note.
export async function ensurePersistentStorage(): Promise<boolean> {
  try {
    if (navigator.storage?.persist) return await navigator.storage.persist();
  } catch { /* best effort */ }
  return false;
}
export async function saveLocalMedia(url: string, blob: Blob, opts: { kind?: BlobMeta['kind']; pinned?: boolean; roomId?: string; noteId?: string; mediaId?: string; storagePath?: string; mediaType?: 'image' | 'video'; isViewOnce?: boolean } = {}): Promise<void> {
  void ensurePersistentStorage().catch(() => undefined);
  await putBlob(url, blob, opts).catch(() => undefined);
}
export async function deleteLocalBlob(url: string): Promise<void> {
  await del('blobs', url).catch(() => undefined);
  await del('blobMeta', url).catch(() => undefined);
  const obj = objectUrls.get(url);
  if (obj) { URL.revokeObjectURL(obj); objectUrls.delete(url); }
}
async function pruneBlobs(): Promise<void> {
  try {
    const budget = await effectiveMediaBudget();
    const metas = await all<BlobMeta>('blobMeta');
    let total = metas.reduce((s, m) => s + m.size, 0);
    if (total <= budget) return;
    // LRU: oldest viewed first, pinned media is never evicted.
    const evictable = metas.filter((m) => !m.pinned).sort((a, b) => a.lastViewedAt - b.lastViewedAt);
    for (const m of evictable) {
      if (total <= budget) break;
      total -= m.size;
      await del('blobs', m.url);
      await del('blobMeta', m.url);
      const obj = objectUrls.get(m.url);
      if (obj) { URL.revokeObjectURL(obj); objectUrls.delete(m.url); }
    }
  } catch { /* Cache pruning must never break the app. */ }
}

// Offline queue for media uploads. Firestore queues document writes
// itself; Storage uploads do not queue, so those go here and flush
// when the device is back online. Blobs are stored under `blob:<id>`.
export async function enqueueMedia(job: QueuedJob, blob: Blob): Promise<void> {
  await put('blobs', `blob:${job.id}`, blob);
  await put('queue', job.id, job);
}
export async function listQueuedJobs(): Promise<QueuedJob[]> {
  return all<QueuedJob>('queue').catch(() => []);
}
export async function dequeueMedia(id: string): Promise<void> {
  await del('queue', id);
  await del('blobs', `blob:${id}`);
}
export async function getQueuedBlob(id: string): Promise<Blob | undefined> {
  return get<Blob>('blobs', `blob:${id}`).catch(() => undefined);
}
export function queueCount(): Promise<number> {
  return listQueuedJobs().then((j) => j.length);
}

// Online / sync status. `online` is navigator.onLine, `pending` is the
// media queue length. Firestore's own offline queue is not counted here;
// its writes sync automatically when the connection returns.
export function isOnline(): boolean {
  return typeof navigator !== 'undefined' ? navigator.onLine : true;
}
export function onOnlineChange(cb: (online: boolean) => void): () => void {
  const on = () => cb(true);
  const off = () => cb(false);
  window.addEventListener('online', on);
  window.addEventListener('offline', off);
  return () => { window.removeEventListener('online', on); window.removeEventListener('offline', off); };
}

export async function clearLocalCache(): Promise<void> {
  for (const s of STORES) await clearStore(s).catch(() => undefined);
  for (const url of objectUrls.values()) URL.revokeObjectURL(url);
  objectUrls.clear();
  try { localStorage.removeItem('petals_last_notified_msg'); } catch { /* ignore */ }
}
