// Backblaze B2 storage for Petals (test-release, 2026-11-17).
// Replaces client/src/utils/storagePhotos.ts (Firebase Storage, which
// cannot be enabled on the Spark no-cost plan without a Blaze upgrade).
// Same function names and return shapes as storagePhotos.ts, so the
// callers (NoteEditorPage, ChatPage, usePhotos, useMessages,
// mediaArchive, mediaStore) switch with import-only changes.
//
// How it works: the app never holds the B2 key. It asks the Cloudflare
// Worker `petals-signer` (VITE_SIGNER_URL, public URL only, no secret)
// for a short-lived presigned URL, then PUTs/GETs directly to B2.
// The Worker verifies the Firebase ID token, checks room membership in
// Firestore (or the admin email shaikhhaziq73@gmail.com), validates the
// key pattern and size caps, and only then mints a URL.
//
// Paths (B2 object keys, same as the old Firebase Storage paths):
//   rooms/{roomId}/notes/{noteId}/photos/{photoId}.webp
//   rooms/{roomId}/notes/{noteId}/photos/{photoId}-thumb.webp
//   rooms/{roomId}/notes/{noteId}/photos/{photoId}.mp4 (chat videos)
//   rooms/{roomId}/archived/{mediaId}.webp|.mp4 (30-day archive)
//
// One change in meaning: `storageUrl` is no longer a permanent download
// URL. It is the presigned GET URL minted at upload time, and it expires
// (1 hour). The durable identifier is `storagePath` (the B2 key).
// Whenever a download fails with 403 (expired URL), the cache helpers in
// localStore.ts call getDownloadUrl(storagePath) and retry once. Never
// render a raw stored URL days later and expect it to work.
import { auth } from '../firebase';

// Public Worker URL only, no secret. Default is embedded so CI builds
// work without a .env file - without it uploads failed closed with
// "signer is not configured". Env var still overrides when present.
const SIGNER_URL = (import.meta.env.VITE_SIGNER_URL as string | undefined) ?? 'https://petals-signer.titan-stream.workers.dev';

function requireSigner(): string {
  if (!SIGNER_URL) {
    throw new Error(
      'B2 signer is not configured: set VITE_SIGNER_URL to the petals-signer Worker URL (see client/.env.example).',
    );
  }
  return SIGNER_URL.replace(/\/$/, '');
}

interface SignerResponse {
  url: string;
  key: string;
  expiresIn: number;
}

async function callSigner(path: string, body: Record<string, unknown>): Promise<unknown> {
  const base = requireSigner();
  const user = auth.currentUser;
  if (!user) throw new Error('Not signed in: cannot ask the signer for a B2 URL.');
  const idToken = await user.getIdToken();
  const res = await fetch(`${base}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${idToken}` },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    let detail = '';
    try {
      const data = await res.json() as { error?: string };
      if (data.error) detail = `: ${data.error}`;
    } catch { /* use the status alone */ }
    throw new Error(`Signer ${path} failed (HTTP ${res.status})${detail}`);
  }
  return res.json();
}

// Video extension follows the real mime type: the in-app camera
// records video/webm on most Android builds (MediaRecorder), while
// gallery clips are usually video/mp4. The Worker accepts both.
export function videoExtension(contentType?: string): 'mp4' | 'webm' {
  return contentType?.includes('webm') ? 'webm' : 'mp4';
}

export function photoStoragePaths(roomId: string, noteId: string, photoId: string, isVideo: boolean, contentType?: string) {
  const base = `rooms/${roomId}/notes/${noteId}/photos/${photoId}`;
  return {
    fullPath: isVideo ? `${base}.${videoExtension(contentType)}` : `${base}.webp`,
    thumbPath: `${base}-thumb.webp`,
  };
}

// Fresh short-lived download URL for a stored B2 key. Used by the cache
// helpers when a stored URL has expired (403). `method` is 'GET' for a
// download, 'HEAD' for a size check (archive verification).
export async function getDownloadUrl(storagePath: string, method: 'GET' | 'HEAD' = 'GET'): Promise<string> {
  const data = await callSigner('/sign-download', { key: storagePath, method }) as SignerResponse;
  if (!data.url) throw new Error(`Signer did not return a download URL for ${storagePath}`);
  return data.url;
}

async function signUpload(roomId: string, key: string, contentType: string, contentLength: number): Promise<string> {
  const data = await callSigner('/sign-upload', { roomId, key, contentType, contentLength }) as SignerResponse;
  if (!data.url) throw new Error(`Signer did not return an upload URL for ${key}`);
  return data.url;
}

async function putToPresignedUrl(url: string, blob: Blob, contentType: string): Promise<void> {
  const res = await fetch(url, { method: 'PUT', headers: { 'Content-Type': contentType }, body: blob });
  if (!res.ok) throw new Error(`B2 upload failed (HTTP ${res.status})`);
}

export async function uploadStoredMedia(
  roomId: string,
  noteId: string,
  photoId: string,
  full: Blob,
  thumb: Blob | null,
  isVideo: boolean,
  contentType?: string,
): Promise<{ storageUrl: string; thumbUrl?: string; storagePath: string; thumbPath?: string }> {
  const { fullPath, thumbPath } = photoStoragePaths(roomId, noteId, photoId, isVideo, contentType);
  const fullType = isVideo ? (contentType ?? 'video/mp4') : 'image/webp';
  const fullUploadUrl = await signUpload(roomId, fullPath, fullType, full.size);
  await putToPresignedUrl(fullUploadUrl, full, fullType);
  const storageUrl = await getDownloadUrl(fullPath);
  let thumbUrl: string | undefined;
  if (thumb) {
    const thumbUploadUrl = await signUpload(roomId, thumbPath, 'image/webp', thumb.size);
    await putToPresignedUrl(thumbUploadUrl, thumb, 'image/webp');
    thumbUrl = await getDownloadUrl(thumbPath);
  }
  return { storageUrl, thumbUrl, storagePath: fullPath, thumbPath: thumb ? thumbPath : undefined };
}

export async function deleteStoredMedia(storagePath?: string, thumbPath?: string): Promise<void> {
  const jobs: Promise<unknown>[] = [];
  if (storagePath) jobs.push(callSigner('/delete', { key: storagePath }).catch(() => undefined));
  if (thumbPath) jobs.push(callSigner('/delete', { key: thumbPath }).catch(() => undefined));
  await Promise.all(jobs);
}

// 30-day archive to server (test-release, revised 2026-11-17): the
// long-term home for a full file whose local nomedia copy expired.
// Path: rooms/{roomId}/archived/{mediaId}.webp (photo) or .mp4 (video).
// The archived copy is NEVER auto-deleted: deleting it is only done by
// the explicit deletePhoto/deleteMessage paths, which delete the current
// storagePath. The caller must verify the returned URL/size before
// deleting any local copy.
export function archiveStoragePath(roomId: string, mediaId: string, isVideo: boolean, contentType?: string): string {
  return `rooms/${roomId}/archived/${mediaId}${isVideo ? `.${videoExtension(contentType)}` : '.webp'}`;
}

export async function uploadArchiveMedia(
  roomId: string,
  mediaId: string,
  blob: Blob,
  isVideo: boolean,
  contentType?: string,
): Promise<{ storageUrl: string; storagePath: string }> {
  const storagePath = archiveStoragePath(roomId, mediaId, isVideo, contentType);
  const resolvedType = isVideo ? (contentType ?? 'video/mp4') : 'image/webp';
  const uploadUrl = await signUpload(roomId, storagePath, resolvedType, blob.size);
  await putToPresignedUrl(uploadUrl, blob, resolvedType);
  // Verify the upload actually landed before the caller deletes the
  // local copy: HEAD the stored object via a fresh presigned HEAD URL
  // and check its stored size matches the uploaded blob. (Firebase
  // getMetadata did this before; B2 has no metadata call from the app,
  // so an HTTP HEAD is the verification.)
  const headUrl = await getDownloadUrl(storagePath, 'HEAD');
  const head = await fetch(headUrl, { method: 'HEAD' });
  const storedSize = Number(head.headers.get('Content-Length'));
  if (!head.ok || storedSize !== blob.size) {
    throw new Error(`Archive upload verification failed for ${storagePath}`);
  }
  const storageUrl = await getDownloadUrl(storagePath);
  return { storageUrl, storagePath };
}

// Transient relay cleanup: delete only the full-size file, keep the
// thumbnail in B2. Called only after every room member has
// confirmed the full file is cached locally (cachedBy). If the relay
// file is deleted and a device later clears its local cache, that
// device cannot get the full file back, only the thumbnail.
export async function deleteRelayFullFile(storagePath?: string): Promise<void> {
  if (!storagePath) return;
  await callSigner('/delete', { key: storagePath }).catch(() => undefined);
}

// Admin only (73 email, test only): list every B2 key under a prefix,
// following continuation tokens. The Worker enforces the admin check;
// a non-admin caller gets a 403 from the signer.
export async function listRoomKeys(prefix: string): Promise<string[]> {
  const keys: string[] = [];
  let continuationToken: string | null | undefined;
  do {
    const data = await callSigner('/list', { prefix, continuationToken }) as { keys: string[]; nextPageToken?: string | null };
    keys.push(...(data.keys ?? []));
    continuationToken = data.nextPageToken;
    if (keys.length > 5000) break;
  } while (continuationToken);
  return keys;
}

// WiFi-only upload check. Uses the Network Information API where the
// browser exposes it; when it is unavailable the upload is allowed and
// the user can still pause it. Capacitor WebView on Android exposes
// connection.type as 'wifi' / 'cellular' in most builds.
export function isOnCellular(): boolean {
  const conn = (navigator as unknown as { connection?: { type?: string; effectiveType?: string; saveData?: boolean } }).connection;
  if (!conn) return false;
  if (conn.type && conn.type !== 'wifi' && conn.type !== 'ethernet' && conn.type !== 'none') return true;
  if (conn.effectiveType && ['slow-2g', '2g', '3g'].includes(conn.effectiveType)) return true;
  return false;
}

export interface B2UploadTask {
  pause(): void;
  resume(): void;
  cancel(): void;
}

export interface ResumableUpload {
  task: B2UploadTask;
  done: Promise<{ storageUrl: string; thumbUrl?: string; storagePath: string; thumbPath?: string }>;
}

/**
 * Resumable upload with progress, backed by a single PUT to a presigned
 * B2 URL via XMLHttpRequest so upload.onprogress gives a real 0-100.
 * The caller keeps the returned task and can call task.pause() /
 * resume() / cancel() from the UI.
 *
 * Honest limit: this is NOT true S3 multipart resume. pause() and
 * cancel() abort the in-flight PUT; resume() restarts the upload from
 * 0 with a fresh presigned URL. That is cheap here because photos are
 * ~700 KB and clips are at most 50 MB, but a 50 MB clip interrupted at
 * 99% restarts from the beginning. Do not present it as a byte-range
 * resume.
 */
export function uploadStoredMediaResumable(
  roomId: string,
  noteId: string,
  photoId: string,
  full: Blob,
  thumb: Blob | null,
  isVideo: boolean,
  onProgress: (percent: number) => void,
  contentType?: string,
): ResumableUpload {
  const { fullPath, thumbPath } = photoStoragePaths(roomId, noteId, photoId, isVideo, contentType);
  const fullType = isVideo ? (contentType ?? 'video/mp4') : 'image/webp';
  let xhr: XMLHttpRequest | null = null;
  let state: 'running' | 'paused' | 'cancelled' | 'done' = 'running';
  let settled = false;

  let resolveDone!: (v: { storageUrl: string; thumbUrl?: string; storagePath: string; thumbPath?: string }) => void;
  let rejectDone!: (e: unknown) => void;
  const done = new Promise<{ storageUrl: string; thumbUrl?: string; storagePath: string; thumbPath?: string }>((resolve, reject) => {
    resolveDone = resolve;
    rejectDone = reject;
  });
  // The caller owns `done`; an abort with no handler must not surface
  // as an unhandled rejection in the console.
  done.catch(() => undefined);

  const finish = async () => {
    try {
      const storageUrl = await getDownloadUrl(fullPath);
      let thumbUrl: string | undefined;
      if (thumb) {
        const thumbUploadUrl = await signUpload(roomId, thumbPath, 'image/webp', thumb.size);
        await putToPresignedUrl(thumbUploadUrl, thumb, 'image/webp');
        thumbUrl = await getDownloadUrl(thumbPath);
      }
      if (settled) return;
      settled = true;
      state = 'done';
      resolveDone({ storageUrl, thumbUrl, storagePath: fullPath, thumbPath: thumb ? thumbPath : undefined });
    } catch (e) {
      if (settled) return;
      settled = true;
      rejectDone(e);
    }
  };

  const startPut = async () => {
    try {
      const uploadUrl = await signUpload(roomId, fullPath, fullType, full.size);
      if (state !== 'running') return; // paused/cancelled while signing
      const req = new XMLHttpRequest();
      xhr = req;
      req.open('PUT', uploadUrl, true);
      req.setRequestHeader('Content-Type', fullType);
      req.upload.onprogress = (e) => {
        if (e.lengthComputable && e.total > 0) onProgress(Math.round((e.loaded / e.total) * 100));
      };
      req.onload = () => {
        xhr = null;
        if (state !== 'running') return;
        if (req.status >= 200 && req.status < 300) void finish();
        else if (!settled) { settled = true; rejectDone(new Error(`B2 upload failed (HTTP ${req.status})`)); }
      };
      req.onerror = () => {
        xhr = null;
        if (state !== 'running') return; // abort from pause/cancel, not an error
        if (!settled) { settled = true; rejectDone(new Error('B2 upload failed (network error)')); }
      };
      req.onabort = () => { xhr = null; };
      req.send(full);
    } catch (e) {
      if (state === 'running' && !settled) { settled = true; rejectDone(e); }
    }
  };

  void startPut();

  const task: B2UploadTask = {
    pause() {
      if (state !== 'running') return;
      state = 'paused';
      xhr?.abort();
      xhr = null;
    },
    resume() {
      // Restart from 0 with a fresh presigned URL; see the honest-limit
      // note above. No byte-range resume is attempted.
      if (state !== 'paused') return;
      state = 'running';
      onProgress(0);
      void startPut();
    },
    cancel() {
      if (state === 'cancelled' || state === 'done') return;
      state = 'cancelled';
      xhr?.abort();
      xhr = null;
      if (!settled) { settled = true; rejectDone(new Error('Upload cancelled')); }
    },
  };
  return { task, done };
}
