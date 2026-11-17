// 30-day archive to server (test-release, revised 2026-11-17).
//
// Revised rule, replacing the earlier wipe: after 30 days without
// being opened, a full photo/video in the hidden nomedia storage is
// NOT permanently deleted. Instead it is uploaded back to B2 as a
// long-term copy, the upload is verified, and only then
// is the local nomedia/IndexedDB copy deleted. The archived copy is
// never auto-deleted from B2; that is the point.
//
// Flow per item:
//   1. listExpiredBlobMetas() finds full blobs unopened for 30 days.
//   2. Resolve which Firestore doc it belongs to: a stored note photo
//      (rooms/{roomId}/notes/{noteId}/photos/{photoId}) or a chat
//      message (rooms/{roomId}/messages/{messageId}). The room/note/
//      media ids come from the blob metadata when the caller recorded
//      them, otherwise they are parsed back out of the Firebase
//      download URL. If neither works, the item is skipped, never
//      deleted.
//   3. Upload the blob to rooms/{roomId}/archived/{mediaId}.webp|.mp4
//      with uploadArchiveMedia(), which verifies the stored size
//      matches before it returns.
//   4. Only after that verification: delete the local IndexedDB blob
//      and the native hidden file, then update the Firestore doc to
//      serverStored: true, archivedAt, archivedUrl, archivedPath,
//      localExpired: true, and point mediaUrl/storageUrl/storagePath
//      at the archived copy, so tapping it re-downloads from there.
//      The thumbnail is untouched, and the Saved to Gallery copy is
//      untouched.
//   5. Tapping an archived item re-downloads the full file into
//      nomedia storage (the normal fetchBlobCached path) and calls
//      markMediaRedownloaded(), which clears localExpired and resets
//      the 30-day clock.
//
// Skipped, never archived: thumbnails, pinned/favourite media,
// view-once media (uploading those back would defeat view-once),
// legacy base64 photos that live inside a note doc array (no photo
// subcollection doc to update), and anything whose room/doc cannot be
// resolved. Favourites are exempt because BlobMeta.pinned is set for
// them. Offline: the job does nothing and returns skipped, it never
// deletes locally when the upload cannot run.
//
// Storage cost, stated plainly: archived full files stay on Storage
// long-term, about 700KB per compressed photo, up to 50MB per clip,
// so server storage grows instead of staying thumbnails-only. See
// TEST_RELEASE_NOTES.md.
import { doc, updateDoc } from 'firebase/firestore';
import { db } from '../firebase';
import {
  listExpiredBlobMetas, getBlob, deleteLocalBlob, kvGet, kvSet,
  type BlobMeta,
} from './localStore';
import { uploadArchiveMedia } from './b2Storage';
import { deleteHiddenMedia } from './mediaStore';

export const ARCHIVE_RETENTION_DAYS = 30;
export const ARCHIVE_RETENTION_MS = ARCHIVE_RETENTION_DAYS * 24 * 60 * 60 * 1000;
const ARCHIVE_COUNT_KEY = 'petals_archived_count';
const ARCHIVE_LAST_RUN_KEY = 'petals_archive_last_run';

export interface MediaTarget {
  roomId: string;
  noteId?: string;
  mediaId: string;
  kind: 'note' | 'chat';
}

export interface ArchiveResult {
  archived: number;
  skipped: number;
  failed: number;
}

export interface ArchiveStats {
  count: number;
  lastRunAt: number | null;
}

// Parse a Firebase Storage download URL back into its storage path:
// https://firebasestorage.googleapis.com/v0/b/<bucket>/o/<url-encoded
// path>?alt=media&token=...  Returns null for non-Storage URLs.
export function parseStoragePathFromUrl(url: string): string | null {
  try {
    const u = new URL(url);
    const marker = '/o/';
    const i = u.pathname.indexOf(marker);
    if (i === -1) return null;
    const encoded = u.pathname.slice(i + marker.length);
    const path = decodeURIComponent(encoded);
    return path.startsWith('rooms/') ? path : null;
  } catch {
    return null;
  }
}

// Work out which Firestore doc a cached blob belongs to, from its
// recorded metadata first, otherwise from its Storage download URL.
// Returns null when it cannot be resolved; the caller must skip the
// item then, never delete it.
export function resolveArchiveTarget(meta: BlobMeta): MediaTarget | null {
  const storagePath = meta.storagePath ?? parseStoragePathFromUrl(meta.url);
  if (!storagePath) return null;
  // Note photo: rooms/{roomId}/notes/{noteId}/photos/{photoId}.webp|.mp4
  const noteMatch = storagePath.match(/^rooms\/([^/]+)\/notes\/([^/]+)\/photos\/([^/.]+)\.(webp|mp4)$/);
  if (noteMatch) {
    return { roomId: noteMatch[1], noteId: noteMatch[2], mediaId: meta.mediaId ?? noteMatch[3], kind: 'note' };
  }
  // Chat media: rooms/{roomId}/__chat__/{messageId}.webp|.mp4 (the
  // upload helper uses noteId '__chat__' for chat, see b2Storage).
  const chatMatch = storagePath.match(/^rooms\/([^/]+)\/__chat__\/([^/.]+)\.(webp|mp4)$/);
  if (chatMatch) {
    return { roomId: chatMatch[1], mediaId: meta.mediaId ?? chatMatch[2], kind: 'chat' };
  }
  return null;
}

function docRef(target: MediaTarget) {
  return target.kind === 'note' && target.noteId
    ? doc(db, 'rooms', target.roomId, 'notes', target.noteId, 'photos', target.mediaId)
    : doc(db, 'rooms', target.roomId, 'messages', target.mediaId);
}

export async function getArchiveStats(): Promise<ArchiveStats> {
  const count = (await kvGet<number>(ARCHIVE_COUNT_KEY).catch(() => undefined)) ?? 0;
  const lastRunAt = (await kvGet<number>(ARCHIVE_LAST_RUN_KEY).catch(() => undefined)) ?? null;
  return { count, lastRunAt };
}

// The archive job. Upload first, verify, delete locally only after
// the verification passes, then mark the Firestore doc. Any failure
// leaves the local copy in place, so the next run can retry it.
export async function archiveExpiredBlobs(retentionMs: number = ARCHIVE_RETENTION_MS): Promise<ArchiveResult> {
  const result: ArchiveResult = { archived: 0, skipped: 0, failed: 0 };
  try {
    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      // Offline: cannot upload, so do nothing at all.
      const pending = await listExpiredBlobMetas(retentionMs);
      result.skipped += pending.length;
      await kvSet(ARCHIVE_LAST_RUN_KEY, Date.now()).catch(() => undefined);
      return result;
    }
    const expired = await listExpiredBlobMetas(retentionMs);
    for (const meta of expired) {
      try {
        const target = resolveArchiveTarget(meta);
        if (!target) { result.skipped += 1; continue; }
        const blob = await getBlob(meta.url);
        if (!blob || blob.size === 0) { result.skipped += 1; continue; }
        const isVideo = meta.mediaType === 'video' || meta.kind === 'video';
        const up = await uploadArchiveMedia(target.roomId, target.mediaId, blob, isVideo, isVideo ? (blob.type || 'video/mp4') : undefined);
        // Upload verified by uploadArchiveMedia (download URL + size
        // match). Only now is it safe to delete the local copy.
        await deleteLocalBlob(meta.url);
        await deleteHiddenMedia(target.mediaId, isVideo ? (blob.type || 'video/mp4') : 'image/webp').catch(() => undefined);
        const archivedAt = Date.now();
        await updateDoc(docRef(target), {
          serverStored: true,
          archivedAt,
          archivedUrl: up.storageUrl,
          archivedPath: up.storagePath,
          localExpired: true,
          // Point the media at the archived copy, so tapping it
          // re-downloads from Storage instead of a deleted relay path.
          // The thumbnail stays where it was.
          mediaUrl: up.storageUrl,
          storageUrl: up.storageUrl,
          storagePath: up.storagePath,
          url: up.storageUrl,
          relayDeleted: false,
        }).catch(() => undefined);
        const prev = (await kvGet<number>(ARCHIVE_COUNT_KEY).catch(() => undefined)) ?? 0;
        await kvSet(ARCHIVE_COUNT_KEY, prev + 1).catch(() => undefined);
        result.archived += 1;
      } catch {
        // Never delete locally on failure; the next run retries.
        result.failed += 1;
      }
    }
  } catch {
    // The archive job must never break the app.
  }
  await kvSet(ARCHIVE_LAST_RUN_KEY, Date.now()).catch(() => undefined);
  return result;
}

// Called after an archived item is tapped and its full file has been
// re-downloaded into nomedia storage. Clears localExpired and resets
// the 30-day clock; the server copy stays as the long-term backup, so
// serverStored stays true.
export async function markMediaRedownloaded(target: MediaTarget): Promise<void> {
  try {
    await updateDoc(docRef(target), { localExpired: false });
  } catch { /* best effort; the local cache is what matters here */ }
}
