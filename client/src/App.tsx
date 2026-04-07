import { useState, useEffect } from 'react';
import { useAuth } from './hooks/useAuth';
import { Capacitor } from '@capacitor/core';
import { App as CapApp } from '@capacitor/app';
import { AppProvider, useAppContext } from './context/AppContext';
import { doc, updateDoc } from 'firebase/firestore';
import { db } from './firebase';
import AuthPage from './pages/AuthPage';
import NotesPage from './pages/NotesPage';
import PhotosPage from './pages/PhotosPage';
import SettingsPage from './pages/SettingsPage';
import FavouritesPage from './pages/FavouritesPage';
import NoteEditorPage from './pages/NoteEditorPage';
import BottomNav from './components/BottomNav';
import { PetalIcon } from './components/Icons';
import './styles/theme.css';

type Tab = 'notes' | 'favourites' | 'photos' | 'settings';

function InnerApp() {
  const { user } = useAuth();
  const { roomId } = useAppContext();
  const [tab, setTab] = useState<Tab>('notes');
  const [editingNoteId, setEditingNoteId] = useState<string | null>(null);

  useEffect(() => {
    if (!roomId || !user) return;
    updateDoc(doc(db, 'rooms', roomId), {
      [`activeNotes.${user.uid}`]: editingNoteId
    }).catch(console.error); // Catch in case doc missing
  }, [editingNoteId, roomId, user]);

  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;
    
    const initBack = async () => {
      const handler = await CapApp.addListener('backButton', (data: { canGoBack: boolean }) => {
        if (editingNoteId !== null) {
          setEditingNoteId(null);
        } else if (!data.canGoBack) {
          CapApp.exitApp();
        }
      });
      return handler;
    };
    
    const handlerPromise = initBack();
    return () => {
      handlerPromise.then(h => h.remove());
    };
  }, [editingNoteId]);

  if (!user || !roomId) {
    return <AuthPage />;
  }

  if (editingNoteId !== null) {
    return <NoteEditorPage noteId={editingNoteId} onBack={() => setEditingNoteId(null)} />;
  }

  return (
    <>
      {tab === 'notes'      && <NotesPage      onOpenNote={setEditingNoteId} />}
      {tab === 'favourites' && <FavouritesPage onOpenNote={setEditingNoteId} />}
      {tab === 'photos'     && <PhotosPage />}
      {tab === 'settings'   && <SettingsPage />}
      <BottomNav active={tab} onChange={setTab} />
    </>
  );
}

export default function App() {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <div style={{ display:'flex', flexDirection: 'column', alignItems:'center', justifyContent:'center', height:'100vh', background:'var(--bg)', gap: 16 }}>
        <PetalIcon size={64} color="var(--accent)" />
        <span style={{ fontFamily:'Caveat, cursive', fontSize:32, color:'var(--accent)' }}>Petals</span>
      </div>
    );
  }

  return (
    <AppProvider user={user}>
      <InnerApp />
    </AppProvider>
  );
}
