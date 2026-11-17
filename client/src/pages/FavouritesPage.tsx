import { useState } from 'react';
import { useAppContext } from '../context/AppContext';
import { useNotes } from '../hooks/useNote';
import { SkeletonNoteCard } from '../components/SkeletonCard';
import { HeartIcon, TrashIcon, EditIcon } from '../components/Icons';
import type { Note } from '../../../shared/types';
import { formatCreatedDate } from '../utils/formatDate';

interface Props {
  onOpenNote: (id: string) => void;
}

// Reuse the Masonry logic or simple list for Favourites
// For now, let's stick to the Masonry style for consistency
function MasonryFavourites({ notes, onOpen, onLongPress, partnerUid, partnerActiveNoteId, partnerName }: { notes: Note[]; onOpen: (id: string) => void; onLongPress: (n: Note) => void; partnerUid: string | null; partnerActiveNoteId: string | null; partnerName: string }) {
  const col1 = notes.filter((_, i) => i % 2 === 0);
  const col2 = notes.filter((_, i) => i % 2 === 1);

  return (
    <div className="masonry-grid">
      <div>
        {col1.map((n) => <FavouriteNoteCard key={n.id} note={n} onClick={() => onOpen(n.id)} onLongPress={() => onLongPress(n)} partnerUid={partnerUid} partnerActiveNoteId={partnerActiveNoteId} partnerName={partnerName} />)}
      </div>
      <div>
        {col2.map((n) => <FavouriteNoteCard key={n.id} note={n} onClick={() => onOpen(n.id)} onLongPress={() => onLongPress(n)} partnerUid={partnerUid} partnerActiveNoteId={partnerActiveNoteId} partnerName={partnerName} />)}
      </div>
    </div>
  );
}

function FavouriteNoteCard({ note, onClick, onLongPress }: { note: Note; onClick: () => void; onLongPress: () => void; partnerUid: string | null; partnerActiveNoteId: string | null; partnerName: string }) {
  const preview = note.body?.split('\n').slice(0, 3).join('\n') ?? '';
  
  return (
    <div className="note-card" onClick={onClick} onContextMenu={(e) => { e.preventDefault(); onLongPress(); }} style={{ position: 'relative' }}>
      <div className="favourite-indicator"><HeartIcon size={16} fill="var(--accent)" color="var(--accent)" /></div>
      <div className="card-title">{note.title?.trim() || 'Untitled'}</div>
      <div className="card-time" style={{ marginTop: 0 }}>Created {formatCreatedDate(note.createdAt ?? note.updatedAt)}</div>
      <div className="card-preview">{preview || 'Empty note…'}</div>
    </div>
  );
}

export default function FavouritesPage({ onOpenNote }: Props) {
  const { roomId } = useAppContext();
  const { notes, loading, toggleFavourite, deleteNote } = useNotes(roomId);
  const [selectedNote, setSelectedNote] = useState<Note | null>(null);
  
  const favNotes = notes.filter(n => n.isFavourite);

  if (loading) {
    return (
      <div className="page">
        <div className="page-header"><h1>Favourites</h1></div>
        <div className="masonry-grid">
          <div><SkeletonNoteCard /></div>
          <div><SkeletonNoteCard /></div>
        </div>
      </div>
    );
  }

  return (
    <div className="page">
      <div className="page-header">
        <h1>Favourites</h1>
      </div>

      {favNotes.length === 0 ? (
        <div className="empty-state">
          <div className="empty-icon"><HeartIcon size={48} color="var(--rule)" /></div>
          <p>No favourites yet. Long-press a note to pin it here!</p>
        </div>
      ) : (
        <MasonryFavourites 
          notes={favNotes} 
          onOpen={onOpenNote} 
          onLongPress={setSelectedNote}
          partnerUid={null}
          partnerActiveNoteId={null}
          partnerName=""
        />
      )}

      {selectedNote && (
        <>
          <div className="dashboard-backdrop" onClick={() => setSelectedNote(null)} />
          <div className="context-menu">
            <button className="context-menu-item" onClick={() => { onOpenNote(selectedNote.id); setSelectedNote(null); }}>
              <EditIcon /> Edit
            </button>
            <button className="context-menu-item" onClick={() => { toggleFavourite(selectedNote.id, true); setSelectedNote(null); }}>
              <HeartIcon /> Unfavourite
            </button>
            <button className="context-menu-item delete" onClick={() => { if(window.confirm('Delete?')) deleteNote(selectedNote.id); setSelectedNote(null); }}>
              <TrashIcon /> Delete
            </button>
          </div>
        </>
      )}
    </div>
  );
}
