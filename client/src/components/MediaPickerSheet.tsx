// Custom media sender/picker, mobile first.
// A bottom sheet with the device's recent photos and videos as a
// 3-column grid with real thumbnails, tap one and it goes to the
// preview sheet (view-once choice there). Big touch targets, thumb
// reachable, safe-area padding, no tiny desktop controls.
// On web, or if the native plugin is missing or permission is denied
// and the user declines, the sheet offers the system gallery and
// camera instead, so picking never dead-ends.
import { useEffect, useState } from 'react';
import { listRecentMedia, pickMediaFile, requestMediaPermission, thumbSrc, isNativePickerAvailable, type PickerMediaItem } from '../utils/mediaPicker';

interface Props {
  onPick: (file: File) => void;
  onClose: () => void;
  onFallbackGallery: () => void;
  onTakePhoto: () => void;
}

function formatDuration(total: number): string {
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

export default function MediaPickerSheet({ onPick, onClose, onFallbackGallery, onTakePhoto }: Props) {
  const [items, setItems] = useState<PickerMediaItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [permissionDenied, setPermissionDenied] = useState(false);
  const [pickingId, setPickingId] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    setError(null);
    setPermissionDenied(false);
    try {
      setItems(await listRecentMedia(60));
    } catch (e) {
      const msg = e instanceof Error ? e.message : '';
      if (msg.includes('permission-denied')) setPermissionDenied(true);
      else setError('Could not load your photos. Use the gallery instead.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { if (isNativePickerAvailable()) void load(); else setLoading(false); }, []);

  const handlePick = async (item: PickerMediaItem) => {
    setPickingId(item.id);
    try {
      onPick(await pickMediaFile(item));
    } catch {
      setError('Could not read that file. Try another one.');
      setPickingId(null);
    }
  };

  const handleAllow = async () => {
    try {
      await requestMediaPermission();
      await load();
    } catch {
      setPermissionDenied(true);
    }
  };

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 250, display: 'flex', alignItems: 'flex-end', justifyContent: 'center' }} onClick={onClose}>
      <div
        role="dialog"
        aria-label="Pick a photo or video"
        style={{ background: 'var(--surface)', borderRadius: '24px 24px 0 0', width: '100%', maxWidth: 520, maxHeight: '84vh', display: 'flex', flexDirection: 'column', padding: '12px 16px calc(16px + env(safe-area-inset-bottom))' }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ width: 40, height: 4, borderRadius: 2, background: 'var(--rule)', margin: '0 auto 12px' }} />
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
          <div>
            <div style={{ fontSize: 17, fontWeight: 700 }}>Send a photo or video</div>
            <div style={{ fontSize: 12, color: 'var(--ink-muted)' }}>{items.length > 0 ? `${items.length} recent` : 'From your gallery'}</div>
          </div>
          <button onClick={onClose} aria-label="Close picker" style={{ background: 'var(--tag-bg)', border: 'none', borderRadius: '50%', width: 36, height: 36, fontSize: 16, cursor: 'pointer', color: 'var(--ink)' }}>✕</button>
        </div>

        <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
          <button onClick={onTakePhoto} style={{ flex: 1, background: 'var(--tag-bg)', border: 'none', borderRadius: 16, padding: '12px 8px', fontSize: 14, cursor: 'pointer', color: 'var(--ink)' }}>📷 Take photo</button>
          <button onClick={onFallbackGallery} style={{ flex: 1, background: 'var(--tag-bg)', border: 'none', borderRadius: 16, padding: '12px 8px', fontSize: 14, cursor: 'pointer', color: 'var(--ink)' }}>🖼 System gallery</button>
        </div>

        {loading ? (
          <div style={{ padding: '32px 0', textAlign: 'center', color: 'var(--ink-muted)', fontSize: 14 }}>Loading your photos…</div>
        ) : permissionDenied ? (
          <div style={{ padding: '16px 0', display: 'flex', flexDirection: 'column', gap: 12, alignItems: 'center', textAlign: 'center' }}>
            <span style={{ fontSize: 14 }}>Petals needs photo access to show your recent media here.</span>
            <button className="btn-primary" onClick={() => void handleAllow()} style={{ padding: '12px 24px' }}>Allow access</button>
            <span style={{ fontSize: 12, color: 'var(--ink-muted)' }}>Or use the system gallery above, it works without it.</span>
          </div>
        ) : error ? (
          <div style={{ padding: '16px 0', textAlign: 'center', color: 'var(--ink-muted)', fontSize: 14 }}>{error}</div>
        ) : items.length === 0 ? (
          <div style={{ padding: '32px 0', textAlign: 'center', color: 'var(--ink-muted)', fontSize: 14 }}>No photos or videos on this device yet. Take one, or use the system gallery.</div>
        ) : (
          <div style={{ overflowY: 'auto', display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 6 }}>
            {items.map((item) => {
              const src = thumbSrc(item);
              return (
                <button
                  key={item.id}
                  onClick={() => void handlePick(item)}
                  disabled={pickingId !== null}
                  aria-label={item.mediaType === 'video' ? `Video, ${formatDuration(item.durationSeconds)}` : 'Photo'}
                  style={{ position: 'relative', padding: 0, border: 'none', borderRadius: 12, overflow: 'hidden', aspectRatio: '1', cursor: 'pointer', background: 'var(--tag-bg)', opacity: pickingId !== null && pickingId !== item.id ? 0.5 : 1 }}
                >
                  {src ? (
                    <img src={src} alt="" loading="lazy" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
                  ) : (
                    <span style={{ fontSize: 28 }}>{item.mediaType === 'video' ? '🎬' : '🖼'}</span>
                  )}
                  {item.mediaType === 'video' && (
                    <span style={{ position: 'absolute', right: 6, bottom: 6, fontSize: 11, color: '#fff', background: 'rgba(0,0,0,0.6)', borderRadius: 8, padding: '1px 6px' }}>▶ {formatDuration(item.durationSeconds)}</span>
                  )}
                  {pickingId === item.id && (
                    <span style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.45)', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13 }}>Loading…</span>
                  )}
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
