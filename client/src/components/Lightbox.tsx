import { useEffect, useState } from 'react';
import { fetchVideoCached, fetchBlobCached } from '../utils/localStore';
import { getDownloadUrl } from '../utils/b2Storage';
import { shouldAutoDownload } from '../utils/mediaStore';
import { saveUrlToGallery } from '../utils/mediaStore';
import { DownloadIcon } from './Icons';

interface Props {
  url: string;
  onClose: () => void;
  mediaType?: 'image' | 'video';
  isViewOnce?: boolean;
  // Id used for the hidden file name and the Gallery copy. Defaults to
  // a timestamped name when the caller does not know the media id.
  mediaId?: string;
  // Durable B2 key for this file. When the stored presigned URL has
  // expired, the download below mints a fresh one from it.
  storagePath?: string;
  // 30-day archive: the local copy was removed after the file was
  // stored on the server. Tapping it re-downloads it; show a badge so
  // the user knows why it took a moment to appear.
  archived?: boolean;
  // View-once for everyone, including admin: when true the caller has
  // already decided this item was viewed, and the Lightbox must not
  // show the image again.
  blocked?: boolean;
}

export default function Lightbox({ url, onClose, mediaType, isViewOnce, mediaId, storagePath, blocked, archived }: Props) {
  const [src, setSrc] = useState(url);
  const [saved, setSaved] = useState(false);
  const [saveError, setSaveError] = useState(false);
  const isVideo = mediaType === 'video' || url.includes('.mp4');
  useEffect(() => {
    setSrc(url);
    // Short clips only: cache the compressed 720p file locally so it
    // plays offline next time. Clips over 50MB keep only a thumbnail.
    // Skipped when auto-download is off or on mobile data with
    // WiFi-only on; the remote URL still plays.
    if (!shouldAutoDownload()) return;
    if (isVideo) void fetchVideoCached(url, undefined, { storagePath }).then((cached) => setSrc(cached)).catch(() => undefined);
    else void fetchBlobCached(url, { storagePath }).then((cached) => setSrc(cached)).catch(() => undefined);
  }, [url, isVideo, storagePath]);
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose]);

  const handleSave = async (e: React.MouseEvent) => {
    e.stopPropagation();
    setSaveError(false);
    try {
      // Prefer a fresh presigned URL: the stored URL may have expired
      // since the doc was written. Fall back to the displayed src
      // (a cached object URL when the file is already local).
      let saveUrl = src;
      if (storagePath) {
        try { saveUrl = await getDownloadUrl(storagePath); } catch { /* use src */ }
      }
      await saveUrlToGallery(saveUrl, mediaId ?? `petals-${Date.now()}`, isVideo ? 'video/mp4' : 'image/webp');
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } catch {
      setSaveError(true);
    }
  };

  return (
    <div className="lightbox" onClick={onClose}>
      {blocked ? (
        <div style={{ color: '#fff', fontSize: 15, textAlign: 'center', padding: 24 }}>Viewed once</div>
      ) : isVideo ? (
        <video src={src} controls preload="metadata" onClick={(e) => e.stopPropagation()} style={{ maxWidth: '90vw', maxHeight: '80vh' }} />
      ) : (
        <img src={src} alt="" onClick={(e) => e.stopPropagation()} />
      )}
      {archived && (
        <span style={{ position: 'absolute', top: 16, right: 56, background: 'rgba(0,0,0,0.6)', color: '#fff', padding: '4px 10px', borderRadius: 12, fontSize: 12 }}>
          Stored on server
        </span>
      )}
      {isViewOnce && (
        <span style={{ position: 'absolute', top: 16, left: 16, background: 'rgba(0,0,0,0.6)', color: '#fff', padding: '4px 10px', borderRadius: 12, fontSize: 12 }}>
          View once
        </span>
      )}
      {!blocked && (
        <button className="lightbox-download" onClick={(e) => void handleSave(e)} aria-label="Save to Gallery" title="Save to Gallery">
          <DownloadIcon size={24} color="#fff" />
        </button>
      )}
      {(saved || saveError) && (
        <span style={{ position: 'absolute', bottom: 16, left: '50%', transform: 'translateX(-50%)', background: 'rgba(0,0,0,0.7)', color: '#fff', padding: '6px 14px', borderRadius: 12, fontSize: 12 }}>
          {saved ? 'Saved to gallery' : 'Save failed, try again'}
        </span>
      )}
      <button className="lightbox-close" onClick={onClose} aria-label="Close">✕</button>
    </div>
  );
}
