// In-app update popup. Shown as a modal on app launch when a newer
// release exists, and from Settings on a manual check. The whole
// update happens inside the app:
// Download downloads the APK asset inside the app with a progress
// bar, then Install fires the Android install intent for the
// downloaded file. No browser is opened for the download. On
// Android 8+ the app needs "install unknown apps" allowed for
// Petals first; when it is off, the banner opens that settings
// screen instead of failing. On web there is no install intent,
// so Download just saves the APK file.
import { useState } from 'react';
import type { UpdateInfo } from '../utils/updateCheck';
import {
  downloadUpdate,
  installUpdate,
  openInstallSettings,
  isNative,
} from '../utils/updateCheck';

type Phase = 'idle' | 'downloading' | 'downloaded' | 'installing' | 'needs-permission' | 'error';

export default function UpdateBanner({ info, onDismiss }: { info: UpdateInfo; onDismiss: () => void }) {
  const [hidden, setHidden] = useState(false);
  const [phase, setPhase] = useState<Phase>('idle');
  const [progress, setProgress] = useState(0);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [downloadedPath, setDownloadedPath] = useState<string | null>(null);
  if (hidden) return null;
  const native = isNative();

  const dismiss = () => {
    setHidden(true);
    onDismiss();
  };

  const startDownload = async () => {
    setErrorMsg(null);
    setProgress(0);
    setPhase('downloading');
    try {
      const out = await downloadUpdate(info, setProgress);
      setDownloadedPath(out.path);
      setPhase('downloaded');
    } catch (e) {
      setErrorMsg(e instanceof Error ? e.message : 'Download failed. Try again.');
      setPhase('error');
    }
  };

  const startInstall = async () => {
    if (!downloadedPath) return;
    setErrorMsg(null);
    try {
      const r = await installUpdate(downloadedPath);
      if (r.needsPermission) setPhase('needs-permission');
      else setPhase('installing');
    } catch (e) {
      setErrorMsg(e instanceof Error ? e.message : 'Could not open the installer. Try again.');
      setPhase('error');
    }
  };

  const openSettings = async () => {
    await openInstallSettings();
    // The user comes back from Settings and taps Install again.
  };

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.5)',
        zIndex: 300,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 20,
      }}
      onClick={dismiss}
    >
      <div
        role="dialog"
        aria-label="Update available"
        style={{
          background: 'var(--surface)',
          color: 'var(--ink)',
          padding: 20,
          display: 'flex',
          flexDirection: 'column',
          gap: 12,
          fontSize: 14,
          borderRadius: 20,
          boxShadow: 'var(--shadow)',
          width: '100%',
          maxWidth: 360,
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 17, fontWeight: 700, marginBottom: 4 }}>Update available</div>
            <span>
              Petals {info.latestVersion} is out. You are on {info.currentVersion}.
            </span>
          </div>
          <button onClick={dismiss} aria-label="Dismiss update" style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 16, color: 'var(--ink-muted)' }}>
            ✕
          </button>
        </div>

      {phase === 'idle' && !info.downloadUrl && (
        <span style={{ color: 'var(--ink-muted)' }}>This release has no APK file attached yet, so there is nothing to download.</span>
      )}
      {phase === 'idle' && info.downloadUrl && (
        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={() => void startDownload()} className="btn-ghost" style={{ padding: '6px 12px', whiteSpace: 'nowrap' }}>
            Download in app
          </button>
        </div>
      )}

      {phase === 'downloading' && (
        <div>
          <div style={{ marginBottom: 6 }}>Downloading… {progress}%</div>
          <div style={{ height: 6, borderRadius: 3, background: 'var(--rule)', overflow: 'hidden' }}>
            <div style={{ width: `${progress}%`, height: '100%', background: 'var(--accent)', transition: 'width 200ms' }} />
          </div>
        </div>
      )}

      {phase === 'downloaded' && (
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <span>{native ? 'Downloaded. Tap Install to update.' : 'Downloaded. Open the APK file to install it.'}</span>
          {native && (
            <button onClick={() => void startInstall()} className="btn-ghost" style={{ padding: '6px 12px', whiteSpace: 'nowrap' }}>
              Install
            </button>
          )}
        </div>
      )}

      {phase === 'needs-permission' && (
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <span>Petals needs permission to install apps. Allow it, then tap Install again.</span>
          <button onClick={() => void openSettings()} className="btn-ghost" style={{ padding: '6px 12px', whiteSpace: 'nowrap' }}>
            Open settings
          </button>
          <button onClick={() => void startInstall()} className="btn-ghost" style={{ padding: '6px 12px', whiteSpace: 'nowrap' }}>
            Install
          </button>
        </div>
      )}

      {phase === 'installing' && (
        <span>Opening the installer… The app will go to the background while you install.</span>
      )}

      {phase === 'error' && (
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <span>{errorMsg ?? 'Something went wrong.'}</span>
          <button onClick={() => void startDownload()} className="btn-ghost" style={{ padding: '6px 12px', whiteSpace: 'nowrap' }}>
            Try again
          </button>
        </div>
      )}
      {phase === 'idle' && (
        <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
          <button onClick={dismiss} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 14, color: 'var(--ink-muted)', padding: '6px 10px' }}>
            Later
          </button>
        </div>
      )}
      </div>
    </div>
  );
}
