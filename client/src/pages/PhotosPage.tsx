// Media screen (Photos), rebuilt 2026-11-17.
// - Newest first, grouped by date: Today, Yesterday, This week, then
//   one section per month ("November 2026"), each with its item count.
// - Tabs separate Photos and Videos (plus All), with counts on each tab.
// - Sources: note photos (images only; videos stay in Chat only) and
//   chat photos/videos. Chat is the only place videos live now.
// - View-once media is hidden here ENTIRELY, even unviewed items:
//   view-once lives only in Chat / the note where it was sent.
// - Search runs on metadata only (note title, Chat, date, photo/video).
import { useState, useMemo } from 'react';
import { useAppContext } from '../context/AppContext';
import { useNotes } from '../hooks/useNote';
import { useRoomStoredPhotos } from '../hooks/usePhotos';
import { useMessages } from '../hooks/useMessages';
import { usePullToRefresh } from '../hooks/usePullToRefresh';
import { PullToRefreshIndicator } from '../components/PullToRefreshIndicator';
import { SkeletonPhotoCard } from '../components/SkeletonCard';
import { CameraIcon, DownloadIcon } from '../components/Icons';
import Lightbox from '../components/Lightbox';
import { useCachedUrl } from '../hooks/useCachedUrl';
import { saveUrlToGallery } from '../utils/mediaStore';
import { fetchBlobCached } from '../utils/localStore';
import { getDownloadUrl } from '../utils/b2Storage';
import { markMediaRedownloaded } from '../utils/mediaArchive';

function CachedImg({ src, alt, storagePath }: { src: string; alt?: string; storagePath?: string }) {
  const cached = useCachedUrl(src, storagePath);
  return <img src={cached} alt={alt ?? ''} loading="lazy" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />;
}

interface GridItem {
  id: string;
  url: string;
  thumbUrl?: string;
  // Durable B2 keys, used to mint a fresh presigned URL when the stored
  // URL has expired. Absent for legacy base64 photos.
  storagePath?: string;
  thumbPath?: string;
  mediaType: 'image' | 'video';
  takenAt?: number;
  sourceLabel: string;
  source: 'note' | 'chat';
  noteId?: string;
  messageId?: string;
  roomId?: string;
  serverStored?: boolean;
  localExpired?: boolean;
  durationSeconds?: number;
}

interface DateGroup {
  label: string;
  sort: number;
  items: GridItem[];
}

// Intermediate shape while building the grid: isViewOnce is used only
// to filter view-once out, it never reaches the rendered GridItem.
type RawItem = GridItem & { isViewOnce?: boolean };

function startOfDay(ts: number): number {
  const d = new Date(ts);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

function groupFor(ts: number, now: number): { label: string; sort: number } {
  const today = startOfDay(now);
  const day = 24 * 60 * 60 * 1000;
  const itemDay = startOfDay(ts);
  if (itemDay === today) return { label: 'Today', sort: today };
  if (itemDay === today - day) return { label: 'Yesterday', sort: today - day };
  if (today - itemDay < 7 * day) return { label: 'This week', sort: today - 2 * day };
  const d = new Date(ts);
  const monthStart = new Date(d.getFullYear(), d.getMonth(), 1).getTime();
  return {
    label: d.toLocaleDateString([], { month: 'long', year: 'numeric' }),
    sort: monthStart,
  };
}

function groupItems(items: GridItem[], now: number): DateGroup[] {
  const byLabel = new Map<string, DateGroup>();
  for (const item of items) {
    const ts = item.takenAt ?? 0;
    const g = ts ? groupFor(ts, now) : { label: 'No date', sort: 0 };
    const existing = byLabel.get(g.label);
    if (existing) existing.items.push(item);
    else byLabel.set(g.label, { label: g.label, sort: g.sort, items: [item] });
  }
  return [...byLabel.values()].sort((a, b) => b.sort - a.sort);
}

const formatDuration = (s?: number) => {
  if (!s) return '';
  const m = Math.floor(s / 60);
  const sec = Math.round(s % 60);
  return `${m}:${sec.toString().padStart(2, '0')}`;
};

export default function PhotosPage() {
  const { roomId } = useAppContext();
  const { notes, loading } = useNotes(roomId);
  const { photos: storedPhotos } = useRoomStoredPhotos(roomId);
  const { messages } = useMessages(roomId);
  const [lightbox, setLightbox] = useState<{ url: string; mediaId: string; mediaType: 'image' | 'video'; archived?: boolean; storagePath?: string } | null>(null);
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState<'all' | 'image' | 'video'>('all');
  const [toast, setToast] = useState<string | null>(null);
  const { pullDist, isRefreshing, handlers } = usePullToRefresh(async () => {
    return new Promise((resolve) => setTimeout(resolve, 800));
  });

  // All media, newest first. View-once is excluded here completely,
  // viewed or not: it lives only where it was sent (Chat / the note).
  // Note videos are excluded too: videos stay in Chat only, so the
  // Videos tab is chat clips. Legacy base64 note photos and stored
  // note photos are deduped by id.
  const allMedia: GridItem[] = useMemo(() => {
    const noteItems: RawItem[] = [
      ...notes.flatMap((n) => (n.photos ?? []).map((p) => ({
        id: p.id,
        url: p.storageUrl ?? p.url,
        thumbUrl: p.thumbUrl,
        storagePath: p.storagePath,
        thumbPath: p.thumbPath,
        mediaType: (p.mediaType ?? 'image') as 'image' | 'video',
        takenAt: p.takenAt,
        sourceLabel: n.title?.trim() || 'Untitled',
        source: 'note' as const,
        noteId: n.id,
        roomId: n.roomId,
        isViewOnce: p.isViewOnce,
        serverStored: p.serverStored,
        localExpired: p.localExpired,
      }))),
      ...storedPhotos.map((s) => ({
        id: s.id,
        url: s.storageUrl,
        thumbUrl: s.thumbUrl,
        storagePath: s.storagePath,
        thumbPath: s.thumbPath,
        mediaType: (s.mediaType ?? 'image') as 'image' | 'video',
        takenAt: s.takenAt,
        sourceLabel: notes.find((n) => n.id === s.noteId)?.title?.trim() || 'Untitled',
        source: 'note' as const,
        noteId: s.noteId,
        roomId: s.roomId,
        isViewOnce: s.isViewOnce,
        serverStored: s.serverStored,
        localExpired: s.localExpired,
      })),
    ];
    const chatItems: RawItem[] = messages
      .filter((m) => !m.deletedAt && m.mediaUrl && (m.type === 'photo' || m.type === 'video' || m.type === 'view-once'))
      .map((m) => ({
        id: m.id,
        url: m.mediaUrl ?? '',
        thumbUrl: m.thumbUrl,
        storagePath: m.storagePath,
        thumbPath: m.thumbPath,
        mediaType: (m.mediaType ?? 'image') as 'image' | 'video',
        takenAt: m.createdAt,
        sourceLabel: 'Chat',
        source: 'chat' as const,
        messageId: m.id,
        roomId: m.roomId,
        isViewOnce: m.isViewOnce,
        serverStored: m.serverStored,
        localExpired: m.localExpired,
        durationSeconds: m.durationSeconds,
      }));
    const merged = [...noteItems, ...chatItems]
      .filter((p) => !p.isViewOnce)
      .filter((p) => !(p.source === 'note' && p.mediaType === 'video'))
      .filter((p, i, arr) => arr.findIndex((x) => x.id === p.id) === i)
      .sort((a, b) => (b.takenAt ?? 0) - (a.takenAt ?? 0));
    return merged.map(({ isViewOnce: _vo, ...rest }) => rest);
  }, [notes, storedPhotos, messages]);

  const photoCount = allMedia.filter((p) => p.mediaType === 'image').length;
  const videoCount = allMedia.filter((p) => p.mediaType === 'video').length;

  const q = search.trim().toLowerCase();
  const visible = useMemo(() => allMedia.filter((p) => {
    if (typeFilter !== 'all' && p.mediaType !== typeFilter) return false;
    if (q === '') return true;
    const date = p.takenAt ? new Date(p.takenAt).toLocaleDateString([], { day: 'numeric', month: 'short', year: 'numeric' }) : '';
    const type = p.mediaType === 'video' ? 'video clip' : 'photo';
    return `${p.sourceLabel} ${date} ${type}`.toLowerCase().includes(q);
  }), [allMedia, typeFilter, q]);

  const groups = useMemo(() => groupItems(visible, Date.now()), [visible]);

  const handleSaveClick = async (e: React.MouseEvent, p: GridItem) => {
    e.stopPropagation();
    try {
      let saveUrl = p.url;
      if (p.storagePath) {
        try { saveUrl = await getDownloadUrl(p.storagePath); } catch { /* use the stored URL */ }
      }
      await saveUrlToGallery(saveUrl, p.id, p.mediaType === 'video' ? 'video/mp4' : 'image/webp');
      setToast('Saved to gallery');
      setTimeout(() => setToast(null), 3000);
    } catch {
      setToast('Save failed, try again');
      setTimeout(() => setToast(null), 3000);
    }
  };

  const openItem = async (p: GridItem) => {
    // Archived item: re-download the full file into nomedia storage
    // first, then clear localExpired so the 30-day clock restarts.
    // The server copy stays as the long-term backup.
    if (p.serverStored && p.localExpired && p.roomId) {
      if (p.source === 'chat' && p.messageId) {
        await fetchBlobCached(p.url, { kind: p.mediaType === 'video' ? 'video' : 'image', roomId: p.roomId, mediaId: p.messageId, storagePath: p.storagePath, mediaType: p.mediaType }).catch(() => undefined);
        await markMediaRedownloaded({ roomId: p.roomId, mediaId: p.messageId, kind: 'chat' });
      } else if (p.source === 'note' && p.noteId) {
        await fetchBlobCached(p.url, { kind: 'image', roomId: p.roomId, noteId: p.noteId, mediaId: p.id, storagePath: p.storagePath, mediaType: 'image' }).catch(() => undefined);
        await markMediaRedownloaded({ roomId: p.roomId, noteId: p.noteId, mediaId: p.id, kind: 'note' });
      }
    }
    setLightbox({ url: p.url, mediaId: p.id, mediaType: p.mediaType, archived: Boolean(p.serverStored && p.localExpired), storagePath: p.storagePath });
  };

  if (loading) {
    return (
      <div className="page" style={{ overflowY: 'auto' }}>
        <div className="page-header"><h1>Photos</h1></div>
        <div className="photo-gallery">
          <div>{[1, 2, 3].map((i) => <SkeletonPhotoCard key={i} />)}</div>
          <div>{[4, 5, 6].map((i) => <SkeletonPhotoCard key={i} />)}</div>
        </div>
      </div>
    );
  }

  if (allMedia.length === 0) {
    return (
      <div className="page" {...handlers} style={{ overflowY: 'auto' }}>
        <PullToRefreshIndicator pullDist={pullDist} isRefreshing={isRefreshing} threshold={70} />
        <div className="page-header"><h1>Photos</h1></div>
        <div className="empty-state">
          <div className="empty-icon"><CameraIcon size={56} color="var(--rule)" /></div>
          <p>No memories captured yet.</p>
          <p style={{ fontSize: 13, color: 'var(--ink-muted)' }}>Photos from notes and chat will show up here, newest first.</p>
        </div>
      </div>
    );
  }

  const renderTile = (p: GridItem) => {
    const archived = Boolean(p.serverStored && p.localExpired);
    return (
      <div
        key={p.id}
        onClick={() => void openItem(p)}
        style={{ position: 'relative', aspectRatio: '1', borderRadius: 10, overflow: 'hidden', background: 'var(--surface)', cursor: 'pointer', boxShadow: 'var(--shadow)' }}
      >
        {p.mediaType === 'video' ? (
          <>
            <CachedImg src={p.thumbUrl ?? p.url} alt="Video" storagePath={p.thumbPath ?? p.storagePath} />
            <span style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 22, color: '#fff', textShadow: '0 1px 4px rgba(0,0,0,0.6)' }}>▶</span>
            {p.durationSeconds ? (
              <span style={{ position: 'absolute', right: 6, bottom: 6, fontSize: 11, color: '#fff', background: 'rgba(0,0,0,0.6)', borderRadius: 8, padding: '1px 6px' }}>{formatDuration(p.durationSeconds)}</span>
            ) : null}
          </>
        ) : (
          <CachedImg src={p.thumbUrl ?? p.url} alt={p.sourceLabel} storagePath={p.thumbPath ?? p.storagePath} />
        )}
        {archived && (
          <span style={{ position: 'absolute', left: 6, top: 6, fontSize: 10, color: '#fff', background: 'rgba(0,0,0,0.6)', borderRadius: 8, padding: '1px 6px' }}>On server</span>
        )}
        <button
          className="photo-download-btn"
          onClick={(e) => void handleSaveClick(e, p)}
          aria-label="Save to Gallery"
          title="Save to Gallery"
          style={{ position: 'absolute', right: 6, top: 6, background: 'rgba(0,0,0,0.55)', border: 'none', borderRadius: '50%', width: 28, height: 28, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', cursor: 'pointer' }}
        >
          <DownloadIcon size={14} />
        </button>
        <span style={{ position: 'absolute', left: 6, bottom: 6, fontSize: 10, color: '#fff', background: 'rgba(0,0,0,0.55)', borderRadius: 8, padding: '1px 6px', maxWidth: '70%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.sourceLabel}</span>
      </div>
    );
  };

  return (
    <div className="page" {...handlers} style={{ overflowY: 'auto' }}>
      <PullToRefreshIndicator pullDist={pullDist} isRefreshing={isRefreshing} threshold={70} />
      <div className="page-header"><h1>Photos</h1></div>
      <div style={{ padding: '0 16px 8px', display: 'flex', flexDirection: 'column', gap: 8 }}>
        <input className="text-input" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search by note title, Chat, date, photo or video…" aria-label="Search photos" />
        <div style={{ display: 'flex', gap: 8 }} role="tablist" aria-label="Media type">
          {(['all', 'image', 'video'] as const).map((t) => {
            const count = t === 'all' ? allMedia.length : t === 'image' ? photoCount : videoCount;
            return (
              <button
                key={t}
                role="tab"
                aria-selected={typeFilter === t}
                className="btn-ghost"
                onClick={() => setTypeFilter(t)}
                style={{ padding: '6px 14px', opacity: typeFilter === t ? 1 : 0.6, fontWeight: typeFilter === t ? 700 : 400 }}
              >
                {t === 'all' ? `All (${count})` : t === 'image' ? `Photos (${count})` : `Videos (${count})`}
              </button>
            );
          })}
        </div>
        {q !== '' && <div style={{ fontSize: 12, color: 'var(--ink-muted)' }}>{visible.length} match{visible.length === 1 ? '' : 'es'}</div>}
        <p style={{ fontSize: 12, color: 'var(--ink-muted)', margin: 0 }}>Hidden from Gallery, not from Petals. View-once media never appears here, it lives only where it was sent. Videos here are chat clips, notes are photos only.</p>
      </div>

      {visible.length === 0 ? (
        <div className="empty-state"><p>No matches for “{search}”.</p><p style={{ fontSize: 13, color: 'var(--ink-muted)' }}>Try a note title, Chat, a date like 17 Nov 2026, or photo / video.</p></div>
      ) : (
        <div style={{ padding: '0 16px 24px', display: 'flex', flexDirection: 'column', gap: 20 }}>
          {groups.map((g) => (
            <section key={g.label}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 8 }}>
                <h2 style={{ fontSize: 15, margin: 0 }}>{g.label}</h2>
                <span style={{ fontSize: 12, color: 'var(--ink-muted)' }}>{g.items.length} item{g.items.length === 1 ? '' : 's'}</span>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8 }}>
                {g.items.map(renderTile)}
              </div>
            </section>
          ))}
        </div>
      )}

      {toast && <div style={{ position: 'fixed', bottom: 90, left: '50%', transform: 'translateX(-50%)', background: 'var(--ink)', color: '#fff', padding: '8px 16px', borderRadius: 16, fontSize: 13, zIndex: 200 }}>{toast}</div>}
      {lightbox && <Lightbox url={lightbox.url} mediaId={lightbox.mediaId} mediaType={lightbox.mediaType} archived={lightbox.archived} storagePath={lightbox.storagePath} onClose={() => setLightbox(null)} />}
    </div>
  );
}
