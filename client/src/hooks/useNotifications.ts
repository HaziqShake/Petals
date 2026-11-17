// In-app notifications (test-release).
// Source of truth for the centre is users/{uid}/notifications/{id}.
// Writes are client-side in this test build: when a message arrives from
// the partner, the receiving client writes a notification for itself.
// That avoids a Cloud Function for the in-app layer. Push is separate,
// see utils/fcm.ts and functions/.
// Types of notification: message, note, view-once-viewed, partner-editing.
// Typing/editing notifications are deliberately NOT stored (too spammy);
// they are shown live only, via the existing typing indicator.
import { useState, useEffect, useCallback } from 'react';
import {
  collection, doc, limit, onSnapshot, orderBy, query, setDoc,
  updateDoc, where, getDocs,
} from 'firebase/firestore';
import { db } from '../firebase';
import type { AppNotification } from '../../../shared/types';

export async function createNotification(uid: string, n: Omit<AppNotification, 'id' | 'uid' | 'createdAt' | 'read'>): Promise<void> {
  if (!uid) return;
  const id = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  await setDoc(doc(db, 'users', uid, 'notifications', id), {
    ...n, id, uid, createdAt: Date.now(), read: false,
  }).catch(() => undefined);
}

export function useNotifications(uid: string | null) {
  const [notifications, setNotifications] = useState<AppNotification[]>([]);
  const [loading, setLoading] = useState(true);
  const unread = notifications.filter((n) => !n.read).length;

  useEffect(() => {
    if (!uid) { setNotifications([]); setLoading(false); return; }
    setLoading(true);
    const q = query(collection(db, 'users', uid, 'notifications'), orderBy('createdAt', 'desc'), limit(100));
    const unsub = onSnapshot(q, (snap) => {
      setNotifications(snap.docs.map((d) => ({ ...(d.data() as AppNotification), id: d.id })));
      setLoading(false);
    }, () => setLoading(false));
    return unsub;
  }, [uid]);

  const markRead = useCallback(async (id: string) => {
    if (!uid) return;
    await updateDoc(doc(db, 'users', uid, 'notifications', id), { read: true }).catch(() => undefined);
  }, [uid]);

  const markAllRead = useCallback(async () => {
    if (!uid) return;
    const q = query(collection(db, 'users', uid, 'notifications'), where('read', '==', false), limit(100));
    const snap = await getDocs(q).catch(() => null);
    if (!snap) return;
    await Promise.all(snap.docs.map((d) => updateDoc(d.ref, { read: true }).catch(() => undefined)));
  }, [uid]);

  return { notifications, loading, unread, markRead, markAllRead };
}
