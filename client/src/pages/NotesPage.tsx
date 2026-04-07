import { useState, useRef, useEffect } from 'react';
import { useAppContext } from '../context/AppContext';
import { useNotes } from '../hooks/useNote';
import { useRoomData } from '../hooks/useRoom';
import { usePullToRefresh } from '../hooks/usePullToRefresh';
import { PullToRefreshIndicator } from '../components/PullToRefreshIndicator';
import { SkeletonNoteCard } from '../components/SkeletonCard';
import { PetalIcon, NoteIcon, HeartIcon, PlusIcon, EditIcon, TrashIcon } from '../components/Icons';
import { formatNoteTime } from '../utils/formatDate';
import { doc, getDoc } from 'firebase/firestore';
import { db } from '../firebase';
import type { Note } from '../../../shared/types';

interface Props {
  onOpenNote: (id: string) => void;
}

// Simple windowed render — only render visible cards for perf
function MasonryNotes({ notes, onOpen, onLongPress, partnerUid, partnerActiveNoteId, partnerName }: { notes: Note[]; onOpen: (id: string) => void; onLongPress: (n: Note) => void; partnerUid: string | null; partnerActiveNoteId: string | null; partnerName: string }) {
  const WINDOW_SIZE = 30;
  const [visible, setVisible] = useState(WINDOW_SIZE);
  const sentinelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (notes.length <= WINDOW_SIZE) return;
    const observer = new IntersectionObserver((entries) => {
      if (entries[0].isIntersecting) setVisible((v) => Math.min(v + 10, notes.length));
    });
    if (sentinelRef.current) observer.observe(sentinelRef.current);
    return () => observer.disconnect();
  }, [notes.length]);

  const shown = notes.slice(0, visible);
  // Split into two columns
  const col1 = shown.filter((_, i) => i % 2 === 0);
  const col2 = shown.filter((_, i) => i % 2 === 1);

  return (
    <div className="masonry-grid">
      <div>
        {col1.map((n) => <NoteCard key={n.id} note={n} onClick={() => onOpen(n.id)} onLongPress={() => onLongPress(n)} partnerUid={partnerUid} partnerActiveNoteId={partnerActiveNoteId} partnerName={partnerName} />)}
      </div>
      <div>
        {col2.map((n) => <NoteCard key={n.id} note={n} onClick={() => onOpen(n.id)} onLongPress={() => onLongPress(n)} partnerUid={partnerUid} partnerActiveNoteId={partnerActiveNoteId} partnerName={partnerName} />)}
      </div>
      {visible < notes.length && <div ref={sentinelRef} style={{ height: 1 }} />}
    </div>
  );
}

function NoteCard({ note, onClick, onLongPress, partnerUid, partnerActiveNoteId, partnerName }: { note: Note; onClick: () => void; onLongPress: () => void; partnerUid: string | null; partnerActiveNoteId: string | null; partnerName: string }) {
  const thumb = note.photos?.[0];
  const preview = note.body?.split('\n').slice(0, 3).join('\n') ?? '';
  
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [longPressed, setLongPressed] = useState(false);

  const startPress = () => {
    setLongPressed(false);
    timerRef.current = setTimeout(() => {
      setLongPressed(true);
      onLongPress();
    }, 500);
  };

  const cancelPress = () => {
    if (timerRef.current) clearTimeout(timerRef.current);
  };

  const handleClick = (e: React.MouseEvent) => {
    if (longPressed) {
      e.stopPropagation();
      return;
    }
    onClick();
  };

  const isPartnerEditing = note.editingBy === partnerUid && partnerUid !== null;

  return (
    <div 
      className="note-card" 
      onClick={handleClick}
      onPointerDown={startPress}
      onPointerUp={cancelPress}
      onPointerLeave={cancelPress}
      style={{ position: 'relative', touchAction: 'pan-y' }}
    >
      {note.isFavourite && (
        <div className="favourite-indicator"><HeartIcon size={16} fill="var(--accent)" color="var(--accent)" /></div>
      )}
      {partnerActiveNoteId === note.id && (
        <div className="card-active-indicator" style={{ background: 'var(--tag-bg)', color: 'var(--ink)' }}>
          {partnerName} is here
        </div>
      )}
      {isPartnerEditing && (
        <div className="card-active-indicator">
          Writing<span className="dot-anim">...</span>
        </div>
      )}
      {thumb && (
        <img
          src={thumb.url}
          className="card-thumb"
          loading="lazy"
          alt=""
        />
      )}
      <div className="card-title">{note.title?.trim() || 'Untitled'}</div>
      <div className="card-preview">{preview || 'Empty note…'}</div>
      <div className="card-time">{formatNoteTime(note.updatedAt)}</div>
    </div>
  );
}

export default function NotesPage({ onOpenNote }: Props) {
  const { roomId, user } = useAppContext();
  const { notes, loading, createNote, deleteNote, toggleFavourite, updateNote } = useNotes(roomId);
  const [selectedNoteForMenu, setSelectedNoteForMenu] = useState<Note | null>(null);
  const room = useRoomData(roomId);
  const [partnerName, setPartnerName] = useState('Partner');

  const partnerUid = room?.members?.find(m => m !== user?.uid) ?? null;
  const partnerActiveNoteId = partnerUid && room?.activeNotes ? room.activeNotes[partnerUid] : null;

  useEffect(() => {
    if (!partnerUid) return;
    getDoc(doc(db, 'users', partnerUid)).then((snap) => {
      if (snap.exists()) {
        const name = snap.data().displayName?.split(' ')[0] || 'Partner';
        setPartnerName(name);
      }
    });
  }, [partnerUid]);

  const handleNew = async () => {
    const id = await createNote();
    onOpenNote(id);
  };

  const { pullDist, isRefreshing, handlers } = usePullToRefresh(async () => {
    // Real-time sync is already on, so we just simulate a "sync" delay
    return new Promise(resolve => setTimeout(resolve, 800));
  });

  if (!roomId) {
    return (
      <div className="page">
        <div className="empty-state">
          <div className="empty-icon"><PetalIcon size={56} color="var(--rule)" /></div>
          <p>Join or create a room first to start writing together.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="page" {...handlers} style={{ overflowY: 'auto' }}>
      <PullToRefreshIndicator pullDist={pullDist} isRefreshing={isRefreshing} threshold={70} />
      <div className="page-header">
        <h1>Our Notes</h1>
      </div>

      {loading ? (
        <div className="masonry-grid">
          <div>{[1, 2, 3].map(i => <SkeletonNoteCard key={i} />)}</div>
          <div>{[4, 5, 6].map(i => <SkeletonNoteCard key={i} />)}</div>
        </div>
      ) : notes.length === 0 ? (
        <div className="empty-state">
          <div className="empty-icon"><NoteIcon size={56} color="var(--rule)" /></div>
          <p>No notes yet. Tap + to write your first one!</p>
        </div>
      ) : (
        <MasonryNotes 
          notes={notes} 
          onOpen={onOpenNote} 
          onLongPress={(n) => setSelectedNoteForMenu(n)}
          partnerUid={user?.uid ?? null} 
          partnerActiveNoteId={partnerActiveNoteId ?? null} 
          partnerName={partnerName} 
        />
      )}

      {selectedNoteForMenu && (
        <>
          <div className="dashboard-backdrop" onClick={() => setSelectedNoteForMenu(null)} />
          <div className="context-menu">
            <button className="context-menu-item" onClick={() => {
              onOpenNote(selectedNoteForMenu.id);
              setSelectedNoteForMenu(null);
            }}>
              <EditIcon /> Open
            </button>
            <button className="context-menu-item" onClick={() => {
              const newTitle = window.prompt('Rename note', selectedNoteForMenu.title || '');
              if (newTitle !== null) {
                updateNote(selectedNoteForMenu.id, { title: newTitle });
              }
              setSelectedNoteForMenu(null);
            }}>
              <PlusIcon style={{ transform: 'rotate(45deg)' }} /> Rename
            </button>
            <button className="context-menu-item" onClick={() => {
              toggleFavourite(selectedNoteForMenu.id, !!selectedNoteForMenu.isFavourite);
              setSelectedNoteForMenu(null);
            }}>
              <HeartIcon fill={selectedNoteForMenu.isFavourite ? 'var(--accent)' : 'none'} color={selectedNoteForMenu.isFavourite ? 'var(--accent)' : 'currentColor'} /> 
              {selectedNoteForMenu.isFavourite ? 'Unfavourite' : 'Favourite'}
            </button>
            <button className="context-menu-item delete" onClick={() => {
              if (window.confirm(`Drop note "${selectedNoteForMenu.title || 'Untitled'}" in the bin?`)) {
                deleteNote(selectedNoteForMenu.id);
              }
              setSelectedNoteForMenu(null);
            }}>
              <TrashIcon /> Delete
            </button>
          </div>
        </>
      )}

      <button className="fab" onClick={handleNew} aria-label="New note"><PlusIcon size={28} /></button>
    </div>
  );
}
