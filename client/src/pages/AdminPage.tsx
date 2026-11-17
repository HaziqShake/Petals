// TEST ONLY (test-release branch): admin backdoor page.
// Visible only when the signed-in user is shaikhhaziq73@gmail.com.
// Lists every room, its notes and its photos, and can delete dormant
// rooms. View-once applies to everyone including admin: a viewed
// view-once photo shows only a Viewed placeholder here, never the
// image. The file stays in hidden app storage on the device that
// downloaded it, it is not deleted. See TEST_RELEASE_NOTES.md.
// This page, utils/admin.ts, and the matching Firestore rules
// must be removed before any public release.
import { useState, useEffect, useCallback } from 'react';
import { collection, doc, getDocs, query, deleteDoc, limit, orderBy } from 'firebase/firestore';
import { db } from '../firebase';
import { listRoomKeys, deleteRelayFullFile } from '../utils/b2Storage';
import { isAdminEmail } from '../utils/admin';
import { useAuth } from '../hooks/useAuth';
import type { Room, Note } from '../../../shared/types';

interface RoomRow { room: Room; notes: Note[]; photoCount: number; lastUpdated: number }

async function deleteCollectionDocs(roomId: string, coll: string, noteId?: string): Promise<void> {
  const base = noteId
    ? collection(db, 'rooms', roomId, 'notes', noteId, coll)
    : collection(db, 'rooms', roomId, coll);
  const snap = await getDocs(query(base, limit(400)));
  await Promise.all(snap.docs.map((d) => deleteDoc(d.ref).catch(() => undefined)));
}

export default function AdminPage() {
  const { user } = useAuth();
  const [rows, setRows] = useState<RoomRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const isAdmin = isAdminEmail(user?.email);

  const load = useCallback(async () => {
    if (!isAdmin) { setLoading(false); return; }
    setLoading(true);
    setError(null);
    try {
      const roomsSnap = await getDocs(query(collection(db, 'rooms'), orderBy('createdAt', 'desc'), limit(200)));
      const out: RoomRow[] = [];
      for (const r of roomsSnap.docs) {
        const room = { ...(r.data() as Room), id: r.id };
        const notesSnap = await getDocs(query(collection(db, 'rooms', r.id, 'notes'), limit(200)));
        const notes = notesSnap.docs.map((d) => ({ ...(d.data() as Note), id: d.id }));
        let photoCount = 0;
        for (const n of notes) {
          photoCount += (n.photos ?? []).length + (n.storedPhotoCount ?? 0);
        }
        const lastUpdated = notes.reduce((m, n) => Math.max(m, n.updatedAt ?? 0), room.createdAt ?? 0);
        out.push({ room, notes, photoCount, lastUpdated });
      }
      setRows(out);
    } catch (e) {
      console.error(e);
      setError('Could not load rooms. Check the Firestore rules allow the admin email, and that you are signed in with that email.');
    } finally { setLoading(false); }
  }, [isAdmin]);

  useEffect(() => { void load(); }, [load]);

  const deleteRoom = async (roomId: string) => {
    if (!window.confirm(`Delete room ${roomId} and all its notes, messages and photos? This cannot be undone.`)) return;
    setDeleting(roomId);
    try {
      const notesSnap = await getDocs(query(collection(db, 'rooms', roomId, 'notes'), limit(400)));
      for (const n of notesSnap.docs) {
        await deleteCollectionDocs(roomId, 'photos', n.id);
        await deleteCollectionDocs(roomId, 'messages');
        await deleteDoc(n.ref).catch(() => undefined);
      }
      await deleteCollectionDocs(roomId, 'messages');
      // B2 files for this room, best effort, via the signer Worker
      // (/list is admin-only, /delete checks membership or admin).
      try {
        const keys = await listRoomKeys(`rooms/${roomId}/`);
        await Promise.all(keys.map((k) => deleteRelayFullFile(k)));
      } catch { /* B2 may be empty or the signer unconfigured; Firestore data is already deleted. */ }
      await deleteDoc(doc(db, 'rooms', roomId));
      setRows((prev) => prev.filter((r) => r.room.id !== roomId));
    } catch (e) {
      console.error(e);
      setError('Delete failed partway. Reload and check what is left.');
    } finally { setDeleting(null); }
  };

  if (!isAdmin) return <div className="page" style={{ padding: 16 }}><h1>Admin</h1><p style={{ color: 'var(--ink-muted)' }}>This page is only for the admin account.</p></div>;
  if (loading) return <div className="page" style={{ padding: 16 }}><h1>Admin (test only)</h1><p style={{ color: 'var(--ink-muted)' }}>Loading rooms…</p></div>;

  return (
    <div className="page" style={{ padding: '0 16px 32px' }}>
      <div className="page-header"><h1>Admin (test only)</h1></div>
      <p style={{ fontSize: 12, color: 'var(--ink-muted)' }}>Signed in as {user?.email}. You can see every room, note and photo, so you can clear dormant rooms. View-once applies to you too: a viewed view-once photo shows only a Viewed placeholder, never the image. Remove this page before any public release.</p>
      <button className="btn-ghost" onClick={() => void load()} style={{ marginBottom: 12 }}>Reload</button>
      {error && <p style={{ color: 'var(--accent)', fontSize: 13 }}>{error}</p>}
      {rows.length === 0 ? <p style={{ color: 'var(--ink-muted)' }}>No rooms found.</p> : rows.map(({ room, notes, photoCount, lastUpdated }) => {
        const dormant = Date.now() - lastUpdated > 90 * 24 * 60 * 60 * 1000;
        return (
          <div key={room.id} style={{ background: 'var(--surface)', border: '1px solid var(--rule)', borderRadius: 12, padding: 12, marginBottom: 10 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'center' }}>
              <strong style={{ fontFamily: 'monospace' }}>{room.id}</strong>
              {dormant && <span style={{ fontSize: 11, background: 'var(--tag-bg)', borderRadius: 10, padding: '2px 8px' }}>Dormant 90+ days</span>}
            </div>
            <div style={{ fontSize: 12, color: 'var(--ink-muted)', marginTop: 4 }}>Members: {room.members?.length ?? 0} - Notes: {notes.length} - Photos: {photoCount} - Created: {room.createdAt ? new Date(room.createdAt).toLocaleDateString() : 'Unknown'} - Last updated: {lastUpdated ? new Date(lastUpdated).toLocaleDateString() : 'Unknown'}</div>
            <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
              <button className="btn-ghost" onClick={() => setExpanded(expanded === room.id ? null : room.id)} style={{ padding: '6px 12px' }}>{expanded === room.id ? 'Hide notes' : 'Show notes'}</button>
              <button className="btn-ghost" onClick={() => void deleteRoom(room.id)} disabled={deleting === room.id} style={{ padding: '6px 12px', color: 'var(--accent)' }}>{deleting === room.id ? 'Deleting…' : 'Delete room'}</button>
            </div>
            {expanded === room.id && (
              <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 8 }}>
                {notes.length === 0 ? <p style={{ fontSize: 12, color: 'var(--ink-muted)' }}>No notes in this room.</p> : notes.map((n) => (
                  <div key={n.id} style={{ borderTop: '1px solid var(--rule)', paddingTop: 8 }}>
                    <div style={{ fontSize: 13, fontWeight: 600 }}>{n.title?.trim() || 'Untitled'}</div>
                    <div style={{ fontSize: 12, color: 'var(--ink-muted)' }}>{(n.body ?? '').slice(0, 200)}{(n.body ?? '').length > 200 ? '…' : ''}</div>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 6 }}>
                      {(n.photos ?? []).map((p) => (
                        p.isViewOnce && (p.viewedBy ?? []).length > 0 ? (
                          <span key={p.id} style={{ width: 64, height: 64, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--bg)', color: 'var(--ink-muted)', fontSize: 10, textAlign: 'center', borderRadius: 8 }}>Viewed once</span>
                        ) : (
                          <a key={p.id} href={p.storageUrl ?? p.url} target="_blank" rel="noreferrer"><img src={p.thumbUrl ?? p.url} alt="" loading="lazy" style={{ width: 64, height: 64, objectFit: 'cover', borderRadius: 8 }} /></a>
                        )
                      ))}
                      {n.isFavourite ? <span style={{ fontSize: 11 }}>Favourite</span> : null}
                      {(n.photos ?? []).some((p) => p.isViewOnce) ? <span style={{ fontSize: 11 }}>Has view-once photos (hidden for everyone once viewed)</span> : null}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        );
      })}
      <p style={{ fontSize: 11, color: 'var(--ink-muted)' }}>Note: stored photos in the photos subcollection are counted via storedPhotoCount; their thumbnails are shown through the note photos above when present. Use the room delete to clear a dormant room fully.</p>
    </div>
  );
}
