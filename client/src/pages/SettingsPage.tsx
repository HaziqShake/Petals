import { useState, useEffect } from 'react';
import RoomQr from '../components/RoomQr';
import { clearLocalCache, isOnline, onOnlineChange, queueCount, getCacheSize, type CacheSize } from '../utils/localStore';
import { getMediaSettings, setMediaSettings, HIDDEN_FOLDER_PATH, GALLERY_FOLDER, openHiddenFolder, isNative, type MediaSettings } from '../utils/mediaStore';
import { archiveExpiredBlobs, getArchiveStats, ARCHIVE_RETENTION_DAYS, ARCHIVE_RETENTION_MS, type ArchiveStats } from '../utils/mediaArchive';
import { currentVersion, type UpdateInfo } from '../utils/updateCheck';
import UpdateBanner from '../components/UpdateBanner';
import { formatBytes } from '../utils/imageCompressor';
import { useAuth } from '../hooks/useAuth';
import { useAppContext } from '../context/AppContext';
import { useRoom } from '../hooks/useRoom';

export default function SettingsPage({
  update,
  updateStatus,
  checkingUpdate,
  onCheckForUpdates,
  onDismissUpdate,
}: {
  update?: UpdateInfo | null;
  updateStatus?: string | null;
  checkingUpdate?: boolean;
  onCheckForUpdates?: () => void;
  onDismissUpdate?: () => void;
}) {
  const { user, signOut } = useAuth();
  const { theme, setTheme, isDarkMode, setDarkMode, profile, updateProfile, roomId } = useAppContext();
  const [nameInput, setNameInput] = useState(profile?.displayName ?? user?.displayName ?? '');
  const [copied, setCopied] = useState(false);
  const [saved, setSaved] = useState(false);
  const [online, setOnline] = useState(isOnline());
  const [pending, setPending] = useState(0);
  const [cacheCleared, setCacheCleared] = useState(false);
  const [cacheSize, setCacheSize] = useState<CacheSize | null>(null);
  const [media, setMedia] = useState<MediaSettings>(() => getMediaSettings());
  const [filesMsg, setFilesMsg] = useState<string | null>(null);
  const [archiveStats, setArchiveStats] = useState<ArchiveStats | null>(null);
  const [archiveMsg, setArchiveMsg] = useState<string | null>(null);
  const [archiving, setArchiving] = useState(false);
  const [appVersion, setAppVersion] = useState('');
  useEffect(() => { void currentVersion().then(setAppVersion); }, []);
  useEffect(() => { void getArchiveStats().then(setArchiveStats); }, []);
  const runArchiveNow = async () => {
    setArchiving(true);
    setArchiveMsg(null);
    try {
      const r = await archiveExpiredBlobs(ARCHIVE_RETENTION_MS);
      setArchiveMsg(r.archived > 0 ? `Archived ${r.archived} item${r.archived === 1 ? '' : 's'} to the server${r.skipped > 0 ? `, ${r.skipped} skipped` : ''}${r.failed > 0 ? `, ${r.failed} failed and kept locally` : ''}` : r.failed > 0 ? `${r.failed} could not be archived and were kept locally` : 'Nothing to archive right now');
    } catch {
      setArchiveMsg('Archive failed, your files were kept locally');
    } finally {
      setArchiving(false);
      void getArchiveStats().then(setArchiveStats);
      setTimeout(() => setArchiveMsg(null), 5000);
    }
  };
  const updateMedia = (next: Partial<MediaSettings>) => setMedia(setMediaSettings(next));
  useEffect(() => { void getCacheSize().then(setCacheSize); }, [cacheCleared]);
  useEffect(() => {
    const off = onOnlineChange(setOnline);
    const refresh = () => { void queueCount().then(setPending); };
    refresh();
    const id = setInterval(refresh, 10000);
    return () => { off(); clearInterval(id); };
  }, []);

  // Sync the input when the profile loads async; the initial useState
  // alone stays empty because the profile is not loaded yet on mount.
  useEffect(() => {
    const name = profile?.displayName ?? user?.displayName ?? '';
    if (name) setNameInput(name);
  }, [profile, user]);

  const { leaveRoom } = useRoom(user?.uid ?? null);

  const copyRoom = () => {
    if (roomId) {
      navigator.clipboard.writeText(roomId);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const saveName = async () => {
    if (nameInput.trim()) { await updateProfile({ displayName: nameInput.trim() }); setSaved(true); setTimeout(() => setSaved(false), 2000); }
  };

  const handleSignOut = async () => {
    leaveRoom();
    await signOut();
  };

  return (
    <div className="page">
      <div className="page-header"><h1>Settings</h1></div>

      {/* Theme selection */}
      <div className="settings-section">
        <div className="settings-row">
          <span className="settings-row-label">Accent color</span>
          <div className="theme-toggle">
            <button className={`theme-btn ${theme === 'pink' ? 'active' : ''}`} onClick={() => setTheme('pink')}>
              🌸 Pink
            </button>
            <button className={`theme-btn ${theme === 'blue' ? 'active' : ''}`} onClick={() => setTheme('blue')}>
              💙 Blue
            </button>
          </div>
        </div>
        
        <div className="settings-row">
          <span className="settings-row-label">Appearance</span>
          <div className="theme-toggle">
            <button className={`theme-btn ${!isDarkMode ? 'active' : ''}`} onClick={() => setDarkMode(false)}>
              ☀️ Light
            </button>
            <button className={`theme-btn ${isDarkMode ? 'active' : ''}`} onClick={() => setDarkMode(true)}>
              🌙 Dark
            </button>
          </div>
        </div>
      </div>

      {/* Profile */}
      <div className="settings-section">
        <div className="settings-row" style={{ flexDirection: 'column', alignItems: 'flex-start', gap: 10 }}>
          <span className="settings-row-label">Display name</span>
          <div style={{ display: 'flex', gap: 8, width: '100%' }}>
            <input
              className="text-input"
              value={nameInput}
              onChange={(e) => setNameInput(e.target.value)}
              placeholder="Your name"
              style={{ flex: 1 }}
            />
            <button className="btn-ghost" style={{ padding: '10px 16px', flexShrink: 0 }} onClick={saveName}>
              {saved ? 'Saved' : 'Save'}
            </button>
          </div>
        </div>

      </div>

      {/* Room code */}
      {roomId && (
        <div className="settings-section">
          <div className="settings-row" style={{ flexDirection: 'column', gap: 12 }}>
            <span className="settings-row-label">Room invite code</span>
            <div className="room-code">{roomId}</div>
            <RoomQr code={roomId} />
            <button className="btn-ghost" style={{ width: '100%' }} onClick={copyRoom}>
              {copied ? '✓ Copied!' : 'Copy code'}
            </button>
            <p style={{ fontSize: 12, color: 'var(--ink-muted)', textAlign: 'center' }}>
              Share this with your partner to invite them.
            </p>
          </div>
        </div>
      )}

      {/* Hidden media: where photos live, and how to find them */}
      <div className="settings-section">
        <div className="settings-row" style={{ flexDirection: 'column', alignItems: 'flex-start', gap: 8 }}>
          <span className="settings-row-label">Photos and videos</span>
          <span style={{ fontSize: 13, color: 'var(--ink-muted)' }}>Hidden means hidden from Gallery, not from Petals. Photos and videos are stored in app storage, so Gallery and Files search will not find them, but you can still search for them inside Petals, in Photos and Chat, by note title, date, sender and photo or video. Save to Gallery is what makes a photo appear in Gallery search.</span>
          {isNative() ? (
            <>
              <span style={{ fontSize: 13, color: 'var(--ink-muted)' }}>On this device: <span style={{ fontFamily: 'monospace', wordBreak: 'break-all' }}>{HIDDEN_FOLDER_PATH}</span> A file manager opened to that exact path can see the files. Gallery cannot, because the folder has a .nomedia file and MediaStore does not scan it.</span>
              <button className="btn-ghost" style={{ padding: '10px 16px' }} onClick={async () => { const r = await openHiddenFolder(); setFilesMsg(r === 'opened' ? 'Opened in Files' : 'Path copied. Paste it in your file manager to open the folder.'); setTimeout(() => setFilesMsg(null), 4000); }}>
                Show in Files
              </button>
              {filesMsg && <span style={{ fontSize: 12, color: 'var(--ink-muted)' }}>{filesMsg}</span>}
            </>
          ) : (
            <span style={{ fontSize: 13, color: 'var(--ink-muted)' }}>On web, photos live in IndexedDB blobs, which have no file path. Use Save to Gallery on a photo or video to get a real file you can keep.</span>
          )}
          <span style={{ fontSize: 13, color: 'var(--ink-muted)' }}>Save to Gallery copies to {GALLERY_FOLDER}. The hidden Petals copy stays, unless Move is on below.</span>
          <label style={{ fontSize: 13, display: 'flex', gap: 8, alignItems: 'center' }}>
            <input type="checkbox" checked={media.autoDownload} onChange={(e) => updateMedia({ autoDownload: e.target.checked })} /> Auto-download media
          </label>
          <span style={{ fontSize: 13, color: 'var(--ink-muted)' }}>Auto-download works on WiFi and mobile data.</span>
          <label style={{ fontSize: 13, display: 'flex', gap: 8, alignItems: 'center' }}>
            <input type="checkbox" checked={media.saveAsMove} onChange={(e) => updateMedia({ saveAsMove: e.target.checked })} /> Move instead of copy when saving to Gallery (removes the hidden Petals copy after saving)
          </label>
          <span style={{ fontSize: 13, color: 'var(--ink-muted)' }}>After {ARCHIVE_RETENTION_DAYS} days without being opened, a photo or video in hidden storage is stored on the server instead of being wiped: it is uploaded to Storage first, the upload is checked, and only then is the local copy removed. Tapping it later downloads it again from the server. Favourites are never archived, and Saved to Gallery copies are untouched. Archived files stay on the server, about 700KB per photo, so server storage grows over time.</span>
          <span style={{ fontSize: 13, color: 'var(--ink-muted)' }}>{archiveStats ? `${archiveStats.count} item${archiveStats.count === 1 ? '' : 's'} archived to the server so far${archiveStats.lastRunAt ? `, last check ${new Date(archiveStats.lastRunAt).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' })}` : ''}` : 'Checking archive status…'}</span>
          <button className="btn-ghost" style={{ padding: '10px 16px' }} disabled={archiving} onClick={() => void runArchiveNow()}>
            {archiving ? 'Archiving…' : 'Archive expired media now'}
          </button>
          {archiveMsg && <span style={{ fontSize: 12, color: 'var(--ink-muted)' }}>{archiveMsg}</span>}
        </div>
      </div>

      {/* App updates: check, download and install inside the app */}
      <div className="settings-section">
        <div className="settings-row" style={{ flexDirection: 'column', alignItems: 'flex-start', gap: 8 }}>
          <span className="settings-row-label">App updates</span>
          <span style={{ fontSize: 13, color: 'var(--ink-muted)' }}>
            {appVersion ? `You are on Petals ${appVersion}.` : 'Checking your version…'} Updates download and install inside the app, no browser. On Android the installer asks you to allow Petals to install apps first.
          </span>
          <button className="btn-ghost" style={{ padding: '10px 16px' }} disabled={checkingUpdate} onClick={onCheckForUpdates}>
            {checkingUpdate ? 'Checking…' : 'Check for updates'}
          </button>
          {updateStatus && <span style={{ fontSize: 12, color: 'var(--ink-muted)' }}>{updateStatus}</span>}
          {update && onDismissUpdate && (
            <div style={{ width: '100%', border: '1px solid var(--rule)', borderRadius: 12, overflow: 'hidden' }}>
              <UpdateBanner info={update} onDismiss={onDismissUpdate} />
            </div>
          )}
        </div>
      </div>

      {/* Local cache and sync status */}
      <div className="settings-section">
        <div className="settings-row" style={{ flexDirection: 'column', alignItems: 'flex-start', gap: 8 }}>
          <span className="settings-row-label">On this device</span>
          <span style={{ fontSize: 13, color: 'var(--ink-muted)' }}>{online ? 'Online' : 'Offline'} - {pending} queued upload{pending === 1 ? '' : 's'}. Notes, messages and thumbnails are cached on this device first, then synced to the server. The server stays the source of truth for sharing.</span>
          <span style={{ fontSize: 13, color: 'var(--ink-muted)' }}>Local cache: {cacheSize ? `${formatBytes(cacheSize.bytes)} of ${formatBytes(cacheSize.budgetBytes)} used, ${cacheSize.items} items${cacheSize.pinnedItems ? `, ${cacheSize.pinnedItems} pinned` : ''}${cacheSize.quotaBytes ? `, device quota ${formatBytes(cacheSize.quotaBytes)}` : ''}` : 'Measuring cache…'}. Short video clips up to 50MB are cached too, bigger clips keep only a thumbnail. Oldest viewed media is removed first, pinned media is kept.</span>
          <button className="btn-ghost" style={{ padding: '10px 16px' }} onClick={async () => { await clearLocalCache(); setCacheCleared(true); void getCacheSize().then(setCacheSize); setTimeout(() => setCacheCleared(false), 2000); }}>
            {cacheCleared ? 'Cache cleared' : 'Clear local cache'}
          </button>
          <p style={{ fontSize: 12, color: 'var(--ink-muted)' }}>Clearing the cache never deletes server data. Notes and messages will re-download next time you open them.</p>
        </div>
      </div>

      {/* Sign out */}
      <div className="settings-section">
        <div className="settings-row">
          <span className="settings-row-label" style={{ color: 'var(--accent)' }}>Sign out</span>
          <button className="btn-ghost" style={{ color: 'var(--accent)', borderColor: 'var(--primary)' }} onClick={handleSignOut}>
            Sign out
          </button>
        </div>
      </div>

      <div style={{ height: 32 }} />
    </div>
  );
}
