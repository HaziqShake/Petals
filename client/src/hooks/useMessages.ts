// Chat messages hook, built from scratch for the test release.
// Collection: rooms/{roomId}/messages/{messageId}
// Notes data is untouched. Messages are a separate collection.
// No old messaging code is reused here; there was none in the repo.
import { useState, useEffect, useCallback, useRef } from 'react';
import {
  collection, collectionGroup, doc, getDoc, getDocs, limit, onSnapshot, orderBy, query,
  addDoc, updateDoc, arrayUnion, setDoc, startAfter, deleteField, where,
  type DocumentData, type QueryDocumentSnapshot,
} from 'firebase/firestore';
import { db } from '../firebase';
import type { ChatMessage } from '../../../shared/types';
import { cacheMessages, getCachedMessages } from '../utils/localStore';
import { deleteRelayFullFile } from '../utils/b2Storage';

export const CHAT_PAGE_SIZE = 50;

export type NewMessage = Omit<ChatMessage, 'id' | 'roomId' | 'createdAt' | 'deletedAt'> & { createdAt?: number };

function toMessage(d: QueryDocumentSnapshot<DocumentData>): ChatMessage {
  const data = d.data();
  const raw = data.createdAt;
  return {
    id: d.id,
    roomId: data.roomId ?? '',
    senderUid: data.senderUid ?? '',
    senderName: data.senderName,
    text: data.text,
    type: data.type ?? 'text',
    mediaUrl: data.mediaUrl,
    thumbUrl: data.thumbUrl,
    storagePath: data.storagePath,
    thumbPath: data.thumbPath,
    mediaType: data.mediaType,
    durationSeconds: data.durationSeconds,
    isViewOnce: data.isViewOnce ?? false,
    viewedBy: data.viewedBy ?? [],
    viewedAt: data.viewedAt,
    replyTo: data.replyTo ?? null,
    reactions: (data.reactions ?? {}) as Record<string, string>,
    createdAt: typeof raw === 'number' ? raw : (raw?.toMillis?.() ?? Date.now()),
    deletedAt: data.deletedAt ?? null,
    cachedBy: data.cachedBy ?? [],
    relayDeleted: data.relayDeleted ?? false,
    serverStored: data.serverStored ?? false,
    archivedAt: data.archivedAt,
    archivedUrl: data.archivedUrl,
    archivedPath: data.archivedPath,
    localExpired: data.localExpired ?? false,
  };
}

// Read-only messages from every room the user is a member of, newest
// first. Used by the Photos screen so chat media from other rooms
// shows up too. No orderBy, so no composite index is needed.
export function useAllMessages(roomIds: string[]) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const key = roomIds.slice().sort().join(',');
  useEffect(() => {
    const ids = key ? key.split(',') : [];
    if (ids.length === 0) { setMessages([]); return; }
    const q = query(collectionGroup(db, 'messages'), where('roomId', 'in', ids.slice(0, 10)), limit(200));
    const unsub = onSnapshot(q, (snap) => {
      setMessages(snap.docs.map(toMessage).sort((a, b) => b.createdAt - a.createdAt));
    }, () => undefined);
    return unsub;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return { messages };
}

export function useMessages(roomId: string | null) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [hasMore, setHasMore] = useState(false);
  const cursorRef = useRef<QueryDocumentSnapshot<DocumentData> | null>(null);
  const loadingMoreRef = useRef(false);
  const messagesRef = useRef<ChatMessage[]>([]);
  useEffect(() => { messagesRef.current = messages; }, [messages]);

  useEffect(() => {
    if (!roomId) { setMessages([]); setLoading(false); setHasMore(false); return; }
    // Cache first: show last synced messages instantly, then sync deltas.
    let alive = true;
    void getCachedMessages(roomId).then((cached) => {
      if (alive && cached && cached.length > 0) { setMessages(cached); setLoading(false); }
    });
    setLoading(true);
    const q = query(collection(db, 'rooms', roomId, 'messages'), orderBy('createdAt', 'desc'), limit(CHAT_PAGE_SIZE));
    const unsub = onSnapshot(q, (snap) => {
      const list = snap.docs.map(toMessage).reverse();
      setMessages(list);
      cursorRef.current = snap.docs[snap.docs.length - 1] ?? null;
      setHasMore(snap.docs.length === CHAT_PAGE_SIZE);
      setLoading(false);
      void cacheMessages(roomId, list);
    }, () => setLoading(false));
    return () => { alive = false; unsub(); };
  }, [roomId]);

  const loadMore = useCallback(async () => {
    if (!roomId || !cursorRef.current || loadingMoreRef.current) return;
    loadingMoreRef.current = true;
    try {
      const q = query(collection(db, 'rooms', roomId, 'messages'), orderBy('createdAt', 'desc'), startAfter(cursorRef.current), limit(CHAT_PAGE_SIZE));
      const snap = await getDocs(q);
      if (snap.docs.length > 0) {
        cursorRef.current = snap.docs[snap.docs.length - 1];
        setMessages((prev) => {
          const seen = new Set(prev.map((m) => m.id));
          return [...snap.docs.map(toMessage).reverse().filter((m) => !seen.has(m.id)), ...prev];
        });
      }
      setHasMore(snap.docs.length === CHAT_PAGE_SIZE);
    } finally { loadingMoreRef.current = false; }
  }, [roomId]);

  const sendMessage = useCallback(async (data: NewMessage): Promise<string> => {
    if (!roomId) throw new Error('No room');
    const ref = await addDoc(collection(db, 'rooms', roomId, 'messages'), {
      ...data, roomId, createdAt: data.createdAt ?? Date.now(), deletedAt: null,
    });
    return ref.id;
  }, [roomId]);

  const markViewed = useCallback(async (messageId: string, uid: string) => {
    if (!roomId) return;
    await updateDoc(doc(db, 'rooms', roomId, 'messages', messageId), { viewedBy: arrayUnion(uid), viewedAt: Date.now() }).catch(() => undefined);
  }, [roomId]);

  // Transient relay for chat media, same rule as photos: only after
  // the full file is saved locally, and only delete the Storage full
  // file once every room member has cached it. Thumbnail stays.
  const markCached = useCallback(async (message: ChatMessage, uid: string, members?: string[]) => {
    if (!roomId || !message.storagePath || message.relayDeleted) return;
    const ref = doc(db, 'rooms', roomId, 'messages', message.id);
    await updateDoc(ref, { cachedBy: arrayUnion(uid) }).catch(() => undefined);
    // Archived items are the long-term server copy: never delete the
    // archived full file here, even once both members have cached it.
    if (message.serverStored) return;
    if (!members || members.length === 0) return;
    try {
      const snap = await getDoc(ref);
      const data = snap.data();
      if (!data || data.relayDeleted) return;
      const cached: string[] = data.cachedBy ?? [];
      if (!members.every((m) => cached.includes(m))) return;
      await deleteRelayFullFile(message.storagePath);
      await updateDoc(ref, { relayDeleted: true }).catch(() => undefined);
    } catch { /* relay cleanup must never break chat */ }
  }, [roomId]);

  // Toggle a reaction, optimistically. Same emoji again removes it,
  // a different emoji replaces it. Only the reactions.<uid> field is
  // written, never the whole message. Temp (unsent) messages have no
  // server doc yet, so the caller must not react to those.
  const toggleReaction = useCallback(async (messageId: string, uid: string, emoji: string) => {
    if (!roomId || !uid || !emoji) return;
    const current = messagesRef.current.find((mm) => mm.id === messageId)?.reactions?.[uid] ?? null;
    const next: Record<string, string> = { ...(messagesRef.current.find((mm) => mm.id === messageId)?.reactions ?? {}) };
    if (current === emoji) delete next[uid];
    else next[uid] = emoji;
    setMessages((prev) => prev.map((mm) => (mm.id === messageId ? { ...mm, reactions: next } : mm)));
    try {
      if (current === emoji) {
        await updateDoc(doc(db, 'rooms', roomId, 'messages', messageId), { [`reactions.${uid}`]: deleteField() });
      } else {
        await updateDoc(doc(db, 'rooms', roomId, 'messages', messageId), { [`reactions.${uid}`]: emoji });
      }
    } catch {
      // Revert the optimistic change; the snapshot will also correct it.
      setMessages((prev) => prev.map((mm) => {
        if (mm.id !== messageId) return mm;
        const reverted: Record<string, string> = { ...(mm.reactions ?? {}) };
        if (current) reverted[uid] = current;
        else delete reverted[uid];
        return { ...mm, reactions: reverted };
      }));
    }
  }, [roomId]);

  const deleteMessage = useCallback(async (messageId: string) => {
    if (!roomId) return;
    // Clear the media URLs too: a deleted media message must not stay
    // openable/downloadable from its old URL. The Storage file itself
    // is left for the relay/archive cleanup; the message no longer
    // points at it.
    await updateDoc(doc(db, 'rooms', roomId, 'messages', messageId), { deletedAt: Date.now(), text: '', mediaUrl: '', thumbUrl: '' }).catch(() => undefined);
  }, [roomId]);

  const markRoomRead = useCallback(async (uid: string) => {
    if (!roomId || !uid) return;
    await setDoc(doc(db, 'rooms', roomId), { lastReadAt: { [uid]: Date.now() } }, { merge: true }).catch(() => undefined);
  }, [roomId]);

  const setTyping = useCallback(async (uid: string, typing: boolean) => {
    if (!roomId || !uid) return;
    await setDoc(doc(db, 'rooms', roomId), { chatTyping: { [uid]: typing ? Date.now() : 0 } }, { merge: true }).catch(() => undefined);
  }, [roomId]);

  return { messages, loading, hasMore, loadMore, sendMessage, markViewed, markCached, deleteMessage, markRoomRead, setTyping, toggleReaction };
}
