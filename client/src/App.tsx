// Lazy-loaded pages keep the first paint small: only Auth + Notes are
// needed at startup, Chat/Admin/Photos/Settings load on demand.
import { useState, useEffect, lazy, Suspense, useRef } from 'react';
import { useAuth } from './hooks/useAuth';
import { Capacitor } from '@capacitor/core';
import { App as CapApp } from '@capacitor/app';
import { AppProvider, useAppContext } from './context/AppContext';
import { doc, updateDoc, collection, query, orderBy, limit, onSnapshot } from 'firebase/firestore';
import { db } from './firebase';
import AuthPage from './pages/AuthPage';
import BottomNav, { type Tab } from './components/BottomNav';
import { PetalIcon, BellIcon } from './components/Icons';
import UpdateBanner from './components/UpdateBanner';
import { checkForUpdate, type UpdateInfo, type CheckResult } from './utils/updateCheck';
import { isAdminEmail } from './utils/admin';
import { createNotification, useNotifications } from './hooks/useNotifications';
import { registerFcmToken, onForegroundMessage } from './utils/fcm';
import { isOnline, onOnlineChange, queueCount } from './utils/localStore';
import { ensureHiddenFolder } from './utils/mediaStore';
import { archiveExpiredBlobs, getArchiveStats, ARCHIVE_RETENTION_MS } from './utils/mediaArchive';
import './styles/theme.css';

const NotesPage = lazy(() => import('./pages/NotesPage'));
const PhotosPage = lazy(() => import('./pages/PhotosPage'));
const SettingsPage = lazy(() => import('./pages/SettingsPage'));
const FavouritesPage = lazy(() => import('./pages/FavouritesPage'));
const NoteEditorPage = lazy(() => import('./pages/NoteEditorPage'));
const ChatPage = lazy(() => import('./pages/ChatPage'));
const AdminPage = lazy(() => import('./pages/AdminPage'));
const NotificationsPage = lazy(() => import('./pages/NotificationsPage'));

function Loading() {
  return <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '60vh', color: 'var(--ink-muted)' }}>Loading…</div>;
}

function InnerApp() {
  const { user } = useAuth();
  const { roomId } = useAppContext();
  const [tab, setTab] = useState<Tab>('notes');
  const [editingNoteId, setEditingNoteId] = useState<string | null>(null);
  const [showNotifications, setShowNotifications] = useState(false);
  const [update, setUpdate] = useState<UpdateInfo | null>(null);
  const [updateStatus, setUpdateStatus] = useState<string | null>(null);
  const [checkingUpdate, setCheckingUpdate] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const { unread } = useNotifications(user?.uid ?? null);
  const [online, setOnline] = useState(isOnline());
  const [pending, setPending] = useState(0);
  useEffect(() => {
    const off = onOnlineChange(setOnline);
    const refresh = () => { void queueCount().then(setPending); };
    refresh();
    const id = setInterval(refresh, 10000);
    return () => { off(); clearInterval(id); };
  }, []);
  const isAdmin = isAdminEmail(user?.email);
  const tabRef = useRef(tab);
  tabRef.current = tab;
  const lastNotifiedRef = useRef<string | null>(localStorage.getItem('petals_last_notified_msg'));

  useEffect(() => {
    if (!roomId || !user) return;
    updateDoc(doc(db, 'rooms', roomId), { [`activeNotes.${user.uid}`]: editingNoteId }).catch(console.error);
  }, [editingNoteId, roomId, user]);

  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;
    const initBack = async () => {
      const handler = await CapApp.addListener('backButton', (data: { canGoBack: boolean }) => {
        if (showNotifications) setShowNotifications(false);
        else if (editingNoteId !== null) setEditingNoteId(null);
        else if (!data.canGoBack) CapApp.exitApp();
      });
      return handler;
    };
    const handlerPromise = initBack();
    return () => { handlerPromise.then((h) => h.remove()); };
  }, [editingNoteId, showNotifications]);

  // Update check once per launch, non-blocking. A dismissed version
  // stays dismissed until a newer release appears.
  useEffect(() => {
    let alive = true;
    void checkForUpdate().then((result: CheckResult) => {
      if (!alive || result.status !== 'available' || !result.info) return;
      try {
        if (localStorage.getItem('petals_update_dismissed') === result.info.latestVersion) return;
      } catch { /* ignore */ }
      setUpdate(result.info);
    });
    return () => { alive = false; };
  }, []);

  // Manual check from Settings: always goes to the network, and a
  // found update shows again even if it was dismissed before.
  const manualCheckForUpdates = async () => {
    setCheckingUpdate(true);
    setUpdateStatus(null);
    try {
      const result = await checkForUpdate({ force: true });
      if (result.status === 'available' && result.info) {
        try { localStorage.removeItem('petals_update_dismissed'); } catch { /* ignore */ }
        setUpdate(result.info);
        setUpdateStatus(`Petals ${result.info.latestVersion} is available. Download it from the banner above, or from here.`);
      } else if (result.status === 'up-to-date' && result.info) {
        setUpdateStatus(`You are on the latest version (${result.info.currentVersion}).`);
      } else if (result.status === 'no-release') {
        setUpdateStatus('No releases published yet.');
      } else {
        setUpdateStatus(result.message ?? 'Could not check for updates. Try again later.');
      }
    } finally {
      setCheckingUpdate(false);
    }
  };

  const dismissUpdate = () => {
    if (update) {
      try { localStorage.setItem('petals_update_dismissed', update.latestVersion); } catch { /* ignore */ }
    }
    setUpdate(null);
  };

  // 30-day archive to server: full photos/videos in hidden nomedia
  // storage that have not been opened for 30 days are uploaded back
  // to Storage as a long-term copy and only then deleted locally.
  // Runs once a day at most (checked against the last run time), plus
  // once a day while the app stays open. Never deletes without a
  // verified server upload; offline runs do nothing.
  useEffect(() => {
    if (!user || !roomId) return;
    let alive = true;
    const maybeRun = async () => {
      const stats = await getArchiveStats().catch(() => null);
      if (!alive) return;
      if (stats?.lastRunAt && Date.now() - stats.lastRunAt < 24 * 60 * 60 * 1000) return;
      await archiveExpiredBlobs(ARCHIVE_RETENTION_MS).catch(() => undefined);
    };
    void maybeRun();
    const id = setInterval(() => { void maybeRun(); }, 24 * 60 * 60 * 1000);
    return () => { alive = false; clearInterval(id); };
  }, [user, roomId]);

  // Hidden media folder: create Android/data/com.hi.petals/files/
  // Petals/ with its .nomedia file on launch, so auto-downloads never
  // land in a folder Gallery can index.
  useEffect(() => { void ensureHiddenFolder().catch(() => undefined); }, []);

  // FCM prototype: register token + foreground messages, best effort.
  useEffect(() => {
    if (!user) return;
    void registerFcmToken(user.uid);
    let off: (() => void) | undefined;
    void onForegroundMessage((title, body) => { setToast(`${title}: ${body}`); setTimeout(() => setToast(null), 4000); }).then((fn) => { off = fn; });
    return () => { off?.(); };
  }, [user]);

  // In-app notification for partner messages while not on the Chat tab.
  // Reuses the messages listener; writes one notification per message,
  // deduped by last notified id in localStorage.
  useEffect(() => {
    if (!roomId || !user) return;
    const q = query(collection(db, 'rooms', roomId, 'messages'), orderBy('createdAt', 'desc'), limit(1));
    const unsub = onSnapshot(q, (snap) => {
      const d = snap.docs[0];
      if (!d) return;
      const data = d.data();
      if (data.senderUid === user.uid) return;
      if (lastNotifiedRef.current === d.id) return;
      if (tabRef.current === 'chat') { lastNotifiedRef.current = d.id; localStorage.setItem('petals_last_notified_msg', d.id); return; }
      lastNotifiedRef.current = d.id;
      localStorage.setItem('petals_last_notified_msg', d.id);
      void createNotification(user.uid, {
        kind: 'message',
        title: data.senderName ? `${data.senderName} sent a message` : 'New message',
        body: data.type === 'text' ? (data.text ?? '').slice(0, 120) : data.type === 'video' ? 'Sent a short clip' : 'Sent a photo',
        roomId, messageId: d.id,
      });
    });
    return unsub;
  }, [roomId, user]);

  // Update banner must show on the login screen too, not only after
  // sign-in: the old code returned <AuthPage /> here before the
  // banner JSX below, so a logged-out user never saw an update.
  if (!user || !roomId) return (<>{update && <UpdateBanner info={update} onDismiss={dismissUpdate} />}<AuthPage /></>);

  if (showNotifications) {
    return (
      <Suspense fallback={<Loading />}>
        <NotificationsPage onClose={() => setShowNotifications(false)} onOpenChat={() => { setShowNotifications(false); setTab('chat'); }} onOpenNote={(id) => { setShowNotifications(false); setEditingNoteId(id); }} />
      </Suspense>
    );
  }

  if (editingNoteId !== null) {
    return (
      <Suspense fallback={<Loading />}>
        <NoteEditorPage noteId={editingNoteId} onBack={() => setEditingNoteId(null)} />
      </Suspense>
    );
  }

  return (
    <>
      {update && <UpdateBanner info={update} onDismiss={dismissUpdate} />}
      {toast && <div style={{ position: 'fixed', top: 12, left: '50%', transform: 'translateX(-50%)', background: 'var(--ink)', color: '#fff', padding: '8px 16px', borderRadius: 16, fontSize: 13, zIndex: 200 }}>{toast}</div>}
      {!online && <div style={{ position: 'fixed', top: 12, left: 12, zIndex: 150, background: 'var(--tag-bg)', border: '1px solid var(--rule)', borderRadius: 16, padding: '6px 12px', fontSize: 12 }}>Offline{pending > 0 ? ` - ${pending} queued` : ''}</div>}
      <button onClick={() => setShowNotifications(true)} aria-label={`Notifications, ${unread} unread`} style={{ position: 'fixed', top: 12, right: 12, zIndex: 150, background: 'var(--surface)', border: '1px solid var(--rule)', borderRadius: '50%', width: 40, height: 40, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', boxShadow: 'var(--shadow)' }}>
        <BellIcon size={20} />
        {unread > 0 && <span style={{ position: 'absolute', top: -4, right: -4, background: 'var(--accent)', color: '#fff', borderRadius: '50%', minWidth: 18, height: 18, fontSize: 11, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '0 4px' }}>{unread > 99 ? '99+' : unread}</span>}
      </button>
      <Suspense fallback={<Loading />}>
        {tab === 'notes' && <NotesPage onOpenNote={setEditingNoteId} />}
        {tab === 'favourites' && <FavouritesPage onOpenNote={setEditingNoteId} />}
        {tab === 'photos' && <PhotosPage />}
        {tab === 'chat' && <ChatPage />}
        {tab === 'settings' && <SettingsPage update={update} updateStatus={updateStatus} checkingUpdate={checkingUpdate} onCheckForUpdates={() => void manualCheckForUpdates()} onDismissUpdate={dismissUpdate} />}
        {tab === 'admin' && isAdmin && <AdminPage />}
      </Suspense>
      <BottomNav active={tab} onChange={setTab} isAdmin={isAdmin} />
    </>
  );
}

export default function App() {
  const { user, loading } = useAuth();
  if (loading) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100vh', background: 'var(--bg)', gap: 16 }}>
        <PetalIcon size={64} color="var(--accent)" />
        <span style={{ fontFamily: 'Caveat, cursive', fontSize: 32, color: 'var(--accent)' }}>Petals</span>
      </div>
    );
  }
  return (
    <AppProvider user={user}>
      <InnerApp />
    </AppProvider>
  );
}
