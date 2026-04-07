import { useState, useEffect } from 'react';
import {
  collection,
  query,
  where,
  onSnapshot,
  doc,
  deleteDoc,
  updateDoc,
  arrayRemove,
  getDocs,
} from 'firebase/firestore';
import { db } from '../firebase';
import type { Room } from '../../../shared/types';

export function useUserRooms(uid: string | null) {
  const [rooms, setRooms] = useState<Room[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!uid) {
      setRooms([]);
      return;
    }

    setLoading(true);
    const q = query(collection(db, 'rooms'), where('members', 'array-contains', uid));
    
    const unsub = onSnapshot(q, (snap) => {
      const docs = snap.docs.map(d => ({ ...d.data(), id: d.id } as Room));
      setRooms(docs.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0)));
      setLoading(false);
    }, (err) => {
      console.error('Error fetching rooms:', err);
      setLoading(false);
    });

    return unsub;
  }, [uid]);

  const deleteRoom = async (roomId: string) => {
    if (!uid) return;
    
    const roomRef = doc(db, 'rooms', roomId);
    const room = rooms.find(r => r.id === roomId);
    if (!room) return;

    try {
      if (room.members.length <= 1) {
        // Last member: Delete room and all its notes
        const notesQ = query(collection(db, 'notes'), where('roomId', '==', roomId));
        const notesSnap = await getDocs(notesQ);
        const batch = notesSnap.docs.map(d => deleteDoc(d.ref));
        await Promise.all([...batch, deleteDoc(roomRef)]);
      } else {
        // Other members exist: Just leave the room
        await updateDoc(roomRef, {
          members: arrayRemove(uid)
        });
      }
    } catch (err) {
      console.error('Failed to delete/leave room:', err);
      throw err;
    }
  };

  return { rooms, loading, deleteRoom };
}
