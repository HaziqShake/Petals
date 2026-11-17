// Stored photos subcollection hook.
// rooms/{roomId}/notes/{noteId}/photos/{photoId}
// Legacy Note.photos (base64) is untouched; stored photos render alongside
// it and are deduped by id in NoteEditorPage / PhotosPage.
import { useState, useEffect, useCallback, useRef } from 'react';
import {
  collection,
  collectionGroup,
  doc,
  getDoc,
  getDocs,
  limit,
  onSnapshot,
  orderBy,
  query,
  setDoc,
  startAfter,
  updateDoc,
  deleteDoc,
  where,
  arrayUnion,
  type DocumentData,
  type QueryDocumentSnapshot,
} from 'firebase/firestore';
import { db } from '../firebase';
import type { StoredPhoto } from '../../../shared/types';
import { deleteStoredMedia, deleteRelayFullFile } from '../utils/b2Storage';

const PAGE_SIZE = 30;

function toStoredPhoto(d: QueryDocumentSnapshot<DocumentData>): StoredPhoto {
  const data = d.data();
  return {
    id: d.id,
    roomId: data.roomId ?? '',
    noteId: data.noteId ?? '',
    url: data.storageUrl ?? data.url ?? '',
    storageUrl: data.storageUrl ?? data.url ?? '',
    thumbUrl: data.thumbUrl,
    storagePath: data.storagePath ?? '',
    thumbPath: data.thumbPath,
    width: data.width ?? 800,
    height: data.height ?? 800,
    scale: data.scale ?? 1,
    rotation: data.rotation ?? 0,
    x: data.x ?? 50,
    y: data.y ?? 200,
    coordVersion: 2,
    takenAt: data.takenAt,
    createdAt: data.createdAt ?? Date.now(),
    mediaType: data.mediaType ?? 'image',
    durationSeconds: data.durationSeconds,
    isViewOnce: data.isViewOnce ?? false,
    viewedBy: data.viewedBy ?? [],
    viewedAt: data.viewedAt,
    cachedBy: data.cachedBy ?? [],
    relayDeleted: data.relayDeleted ?? false,
    serverStored: data.serverStored ?? false,
    archivedAt: data.archivedAt,
    archivedUrl: data.archivedUrl,
    archivedPath: data.archivedPath,
    localExpired: data.localExpired ?? false,
  };
}

export function usePhotos(roomId: string | null, noteId: string | null) {
  const [photos, setPhotos] = useState<StoredPhoto[]>([]);
  const [loading, setLoading] = useState(true);
  const [hasMore, setHasMore] = useState(false);
  const cursorRef = useRef<QueryDocumentSnapshot<DocumentData> | null>(null);
  const loadingMoreRef = useRef(false);

  useEffect(() => {
    if (!roomId || !noteId) {
      setPhotos([]);
      setLoading(false);
      setHasMore(false);
      return;
    }
    setLoading(true);
    const q = query(
      collection(db, 'rooms', roomId, 'notes', noteId, 'photos'),
      orderBy('createdAt', 'desc'),
      limit(PAGE_SIZE),
    );
    const unsub = onSnapshot(
      q,
      (snap) => {
        setPhotos(snap.docs.map(toStoredPhoto));
        const last = snap.docs[snap.docs.length - 1] ?? null;
        cursorRef.current = last;
        setHasMore(snap.docs.length === PAGE_SIZE);
        setLoading(false);
      },
      () => setLoading(false),
    );
    return unsub;
  }, [roomId, noteId]);

  const loadMore = useCallback(async () => {
    if (!roomId || !noteId || !cursorRef.current || loadingMoreRef.current) return;
    loadingMoreRef.current = true;
    try {
      const q = query(
        collection(db, 'rooms', roomId, 'notes', noteId, 'photos'),
        orderBy('createdAt', 'desc'),
        startAfter(cursorRef.current),
        limit(PAGE_SIZE),
      );
      const snap = await getDocs(q);
      if (snap.docs.length > 0) {
        cursorRef.current = snap.docs[snap.docs.length - 1];
        setPhotos((prev) => {
          const seen = new Set(prev.map((p) => p.id));
          return [...prev, ...snap.docs.map(toStoredPhoto).filter((p) => !seen.has(p.id))];
        });
      }
      setHasMore(snap.docs.length === PAGE_SIZE);
    } finally {
      loadingMoreRef.current = false;
    }
  }, [roomId, noteId]);

  const addPhoto = useCallback(
    async (photo: StoredPhoto) => {
      if (!roomId || !noteId) return;
      await setDoc(doc(db, 'rooms', roomId, 'notes', noteId, 'photos', photo.id), {
        ...photo,
        roomId,
        noteId,
      });
    },
    [roomId, noteId],
  );

  const updatePhoto = useCallback(
    async (photoId: string, data: Partial<StoredPhoto>) => {
      if (!roomId || !noteId) return;
      await updateDoc(doc(db, 'rooms', roomId, 'notes', noteId, 'photos', photoId), data);
    },
    [roomId, noteId],
  );

  const markViewed = useCallback(
    async (photoId: string, uid: string) => {
      if (!roomId || !noteId) return;
      await updateDoc(doc(db, 'rooms', roomId, 'notes', noteId, 'photos', photoId), {
        viewedBy: arrayUnion(uid),
        viewedAt: Date.now(),
      });
    },
    [roomId, noteId],
  );

  // Transient relay: record that this device has the full file stored
  // locally, then delete the full file from Storage once every room
  // member has it. The thumbnail stays in Storage. Call this only
  // after the full blob is actually saved locally, never for a
  // thumbnail-only view.
  const markCached = useCallback(
    async (photo: StoredPhoto, uid: string, members?: string[]) => {
      if (!roomId || !noteId || photo.relayDeleted) return;
      const ref = doc(db, 'rooms', roomId, 'notes', noteId, 'photos', photo.id);
      await updateDoc(ref, { cachedBy: arrayUnion(uid) }).catch(() => undefined);
      // Archived items are the long-term server copy: never delete the
      // archived full file here, even once both members have cached it.
      if (photo.serverStored) return;
      if (!members || members.length === 0) return;
      try {
        const snap = await getDoc(ref);
        const data = snap.data();
        if (!data || data.relayDeleted) return;
        const cached: string[] = data.cachedBy ?? [];
        if (!members.every((m) => cached.includes(m))) return;
        await deleteRelayFullFile(photo.storagePath);
        await updateDoc(ref, { relayDeleted: true }).catch(() => undefined);
      } catch { /* relay cleanup must never break viewing */ }
    },
    [roomId, noteId],
  );

  const deletePhoto = useCallback(
    async (photo: StoredPhoto) => {
      if (!roomId || !noteId) return;
      await deleteDoc(doc(db, 'rooms', roomId, 'notes', noteId, 'photos', photo.id));
      await deleteStoredMedia(photo.storagePath, photo.thumbPath);
    },
    [roomId, noteId],
  );

  return { photos, loading, hasMore, loadMore, addPhoto, updatePhoto, markViewed, markCached, deletePhoto };
}

/** All stored photos in a room, newest first, thumbnails only. No orderBy
 *  on the collectionGroup query so no composite index is needed in test;
 *  sorting is done client side. */
export function useRoomStoredPhotos(roomId: string | string[] | null) {
  const [photos, setPhotos] = useState<StoredPhoto[]>([]);
  const [loading, setLoading] = useState(true);
  const key = Array.isArray(roomId) ? roomId.slice().sort().join(',') : (roomId ?? '');

  useEffect(() => {
    const ids = key ? key.split(',') : [];
    if (ids.length === 0) {
      setPhotos([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    const q = query(collectionGroup(db, 'photos'), where('roomId', 'in', ids.slice(0, 10)), limit(200));
    const unsub = onSnapshot(
      q,
      (snap) => {
        const list = snap.docs.map(toStoredPhoto).sort((a, b) => (b.takenAt ?? b.createdAt) - (a.takenAt ?? a.createdAt));
        setPhotos(list);
        setLoading(false);
      },
      () => setLoading(false),
    );
    return unsub;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  return { photos, loading };
}
