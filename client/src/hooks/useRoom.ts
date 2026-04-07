import { useState, useEffect } from 'react';
import {
  doc,
  setDoc,
  onSnapshot,
  runTransaction,
} from 'firebase/firestore';
import { db } from '../firebase';
import type { Room } from '../../../shared/types';

const ROOM_KEY = 'petals_room_id';

export function useRoom(uid: string | null) {
  const [roomId, setRoomId] = useState<string | null>(() => localStorage.getItem(ROOM_KEY));
  const [room, setRoom] = useState<Room | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Subscribe to room doc
  useEffect(() => {
    if (!roomId) return;
    const ref = doc(db, 'rooms', roomId);
    const unsub = onSnapshot(ref, (snap) => {
      if (snap.exists()) setRoom({ ...snap.data(), id: snap.id } as Room);
    });
    return unsub;
  }, [roomId]);

  /** Create a new room and return the invite code */
  const createRoom = async (): Promise<string> => {
    if (!uid) throw new Error('Not authenticated');
    setLoading(true);
    setError(null);
    try {
      const code = generateCode();
      const roomRef = doc(db, 'rooms', code);
      await setDoc(roomRef, {
        id: code,
        members: [uid],
        createdAt: Date.now(),
      } as Room);
      localStorage.setItem(ROOM_KEY, code);
      setRoomId(code);

      // Save roomId on user profile
      await setDoc(doc(db, 'users', uid), { roomId: code }, { merge: true });
      return code;
    } catch (e) {
      setError('Failed to create room');
      throw e;
    } finally {
      setLoading(false);
    }
  };

  /** Join an existing room with invite code */
  const joinRoom = async (code: string): Promise<void> => {
    if (!uid) throw new Error('Not authenticated');
    setLoading(true);
    setError(null);
    const roomRef = doc(db, 'rooms', code.toUpperCase());

    try {
      await runTransaction(db, async (tx) => {
        const snap = await tx.get(roomRef);
        if (!snap.exists()) throw new Error('Room not found');
        const data = snap.data() as Room;
        const members = data.members || [];
        
        if (members.includes(uid)) {
          // Already a member, just restore local ref
          return;
        }
        if (members.length >= 2) throw new Error('Room is full');
        tx.update(roomRef, { members: [...members, uid] });
      });


      localStorage.setItem(ROOM_KEY, code.toUpperCase());
      setRoomId(code.toUpperCase());
      await setDoc(doc(db, 'users', uid), { roomId: code.toUpperCase() }, { merge: true });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Failed to join room';
      setError(msg);
      throw e;
    } finally {
      setLoading(false);
    }
  };

  const leaveRoom = () => {
    localStorage.removeItem(ROOM_KEY);
    setRoomId(null);
    setRoom(null);
  };

  return { roomId, room, loading, error, createRoom, joinRoom, leaveRoom };
}

/** Subscribe to room data globally */
export function useRoomData(roomId: string | null) {
  const [room, setRoom] = useState<Room | null>(null);
  useEffect(() => {
    if (!roomId) return;
    const unsub = onSnapshot(doc(db, 'rooms', roomId), (snap) => {
      if (snap.exists()) setRoom({ ...snap.data(), id: snap.id } as Room);
    });
    return unsub;
  }, [roomId]);
  return room;
}

/** Generate a 6-char uppercase alphanumeric invite code */
function generateCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  return Array.from({ length: 6 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
}
