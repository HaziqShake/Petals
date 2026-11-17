import { useState, useEffect, useCallback, useRef } from 'react';
import {
  collection,
  collectionGroup,
  doc,
  onSnapshot,
  addDoc,
  updateDoc,
  deleteDoc,
  query,
  orderBy,
  where,
  limit,
} from 'firebase/firestore';
import { db } from '../firebase';
import type { Note, StickerPlacement, Photo } from '../../../shared/types';
import { cacheNotes, getCachedNotes } from '../utils/localStore';

export function useNotes(roomId: string | null) {
  const [notes, setNotes] = useState<Note[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!roomId) return;
    // Cache first: show the last synced notes instantly, then sync
    // only the delta from Firestore. Unsubscribes on unmount / tab close.
    let alive = true;
    void getCachedNotes(roomId).then((cached) => {
      if (alive && cached && cached.length > 0) { setNotes(cached); setLoading(false); }
    });
    const q = query(collection(db, 'rooms', roomId, 'notes'), orderBy('updatedAt', 'desc'));
    const unsub = onSnapshot(q, (snap) => {
      const list = snap.docs.map((d) => ({ id: d.id, ...d.data() } as Note));
      setNotes(list);
      setLoading(false);
      void cacheNotes(roomId, list);
    });
    return () => { alive = false; unsub(); };
  }, [roomId]);

  const createNote = async (): Promise<string> => {
    if (!roomId) throw new Error('No room');
    const ref = await addDoc(collection(db, 'rooms', roomId, 'notes'), {
      roomId,
      title: '',
      body: '',
      bodyHtml: '',
      photos: [],
      stickers: [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
      editingBy: null,
      isFavourite: false,
    });
    return ref.id;
  };

  const deleteNote = async (noteId: string) => {
    if (!roomId) return;
    await deleteDoc(doc(db, 'rooms', roomId, 'notes', noteId));
  };

  const toggleFavourite = async (noteId: string, currentStatus: boolean) => {
    await updateNote(noteId, { isFavourite: !currentStatus });
  };

  const updateNote = async (noteId: string, data: Partial<Note>) => {
    if (!roomId) return;
    await updateDoc(doc(db, 'rooms', roomId, 'notes', noteId), {
      ...data,
      updatedAt: Date.now(),
    });
  };

  return { notes, loading, createNote, deleteNote, toggleFavourite, updateNote };
}

// Notes from every room the user is a member of, newest first.
// Collection-group query on roomId (no orderBy, so no composite index
// is needed; sorting is client side, like useRoomStoredPhotos).
// Only rooms the user belongs to are queried, so the Firestore rules
// (member or admin) pass per note.
export function useAllNotes(roomIds: string[]) {
  const [notes, setNotes] = useState<Note[]>([]);
  const [loading, setLoading] = useState(true);
  const key = roomIds.slice().sort().join(',');
  useEffect(() => {
    const ids = key ? key.split(',') : [];
    if (ids.length === 0) { setNotes([]); setLoading(false); return; }
    setLoading(true);
    // Firestore `in` takes at most 10 values; rooms are few, chunk anyway.
    const chunks: string[][] = [];
    for (let i = 0; i < ids.length; i += 10) chunks.push(ids.slice(i, i + 10));
    const unsubs: Array<() => void> = [];
    const byId = new Map<string, Note>();
    const emit = () => {
      setNotes([...byId.values()].sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0)));
      setLoading(false);
    };
    for (const chunk of chunks) {
      const q = query(collectionGroup(db, 'notes'), where('roomId', 'in', chunk), limit(200));
      unsubs.push(onSnapshot(q, (snap) => {
        for (const d of snap.docs) byId.set(`${(d.data() as Note).roomId}:${d.id}`, { id: d.id, ...d.data() } as Note);
        emit();
      }, () => setLoading(false)));
    }
    return () => { unsubs.forEach((u) => u()); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return { notes, loading };
}

export function useNote(roomId: string | null, noteId: string | null) {
  const [note, setNote] = useState<Note | null>(null);

  useEffect(() => {
    if (!roomId || !noteId) return;
    const ref = doc(db, 'rooms', roomId, 'notes', noteId);
    const unsub = onSnapshot(ref, (snap) => {
      if (snap.exists()) setNote({ id: snap.id, ...snap.data() } as Note);
    });
    return unsub;
  }, [roomId, noteId]);

  const save = useCallback(
    async (data: Partial<Note>) => {
      if (!roomId || !noteId) return;
      await updateDoc(doc(db, 'rooms', roomId, 'notes', noteId), {
        ...data,
        updatedAt: Date.now(),
      });
    },
    [roomId, noteId]
  );

  // Throttled save — syncs every 2.5 seconds WHILE typing!
  const throttleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const tempSaveRef = useRef<Partial<Note> | null>(null);

  const saveDebounced = useCallback((data: Partial<Note>) => {
    tempSaveRef.current = { ...tempSaveRef.current, ...data };
    
    if (!throttleTimer.current) {
      save(tempSaveRef.current);
      tempSaveRef.current = null;
      
      throttleTimer.current = setTimeout(() => {
        throttleTimer.current = null;
        if (tempSaveRef.current) {
          save(tempSaveRef.current);
          tempSaveRef.current = null;
        }
      }, 2000);
    }
  }, [save]);

  const setTyping = useCallback(
    async (uid: string | null) => {
      if (!roomId || !noteId) return;
      await updateDoc(doc(db, 'rooms', roomId, 'notes', noteId), { editingBy: uid });
    },
    [roomId, noteId]
  );

  const updateStickers = useCallback(
    (stickers: StickerPlacement[]) => {
      save({ stickers });
    },
    [save]
  );

  const updatePhotos = useCallback(
    (photos: Photo[]) => {
      save({ photos });
    },
    [save]
  );

  return { note, save, saveDebounced, setTyping, updateStickers, updatePhotos };
}
