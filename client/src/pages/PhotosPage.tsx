import { useState } from 'react';
import { useAppContext } from '../context/AppContext';
import { useNotes } from '../hooks/useNote';
import { usePullToRefresh } from '../hooks/usePullToRefresh';
import { PullToRefreshIndicator } from '../components/PullToRefreshIndicator';
import { SkeletonPhotoCard } from '../components/SkeletonCard';
import { CameraIcon, DownloadIcon } from '../components/Icons';
import Lightbox from '../components/Lightbox';
import { getPhotoTilt, downloadImage } from '../utils/imageUtils';

export default function PhotosPage() {
  const { roomId } = useAppContext();
  const { notes, loading } = useNotes(roomId);
  const [lightboxUrl, setLightboxUrl] = useState<string | null>(null);
  const { pullDist, isRefreshing, handlers } = usePullToRefresh(async () => {
    return new Promise(resolve => setTimeout(resolve, 800));
  });

  // Flatten all photos from all notes
  const allPhotos = notes.flatMap((n) => n.photos ?? [])
    .sort((a, b) => (b.takenAt ?? 0) - (a.takenAt ?? 0));

  const formatTime = (ts?: number) => {
    if (!ts) return '';
    return new Date(ts).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' });
  };

  const handleDownloadClick = (e: React.MouseEvent, url: string) => {
    e.stopPropagation(); // Don't open lightbox
    downloadImage(url);
  };

  if (loading) {
// ... loading skeleton matches original
    return (
      <div className="page" style={{ overflowY: 'auto' }}>
        <div className="page-header"><h1>Photos</h1></div>
        <div className="photo-gallery">
          <div>{[1, 2, 3].map(i => <SkeletonPhotoCard key={i} />)}</div>
          <div>{[4, 5, 6].map(i => <SkeletonPhotoCard key={i} />)}</div>
        </div>
      </div>
    );
  }

  if (allPhotos.length === 0) {
    return (
      <div className="page" {...handlers} style={{ overflowY: 'auto' }}>
        <PullToRefreshIndicator pullDist={pullDist} isRefreshing={isRefreshing} threshold={70} />
        <div className="page-header"><h1>Photos</h1></div>
        <div className="empty-state">
          <div className="empty-icon"><CameraIcon size={56} color="var(--rule)" /></div>
          <p>No memories captured yet.</p>
        </div>
      </div>
    );
  }

  const col1 = allPhotos.filter((_, i) => i % 2 === 0);
  const col2 = allPhotos.filter((_, i) => i % 2 === 1);

  return (
    <div className="page" {...handlers} style={{ overflowY: 'auto' }}>
      <PullToRefreshIndicator pullDist={pullDist} isRefreshing={isRefreshing} threshold={70} />
      <div className="page-header"><h1>Photos</h1></div>

      <div className="photo-gallery">
        <div>
          {col1.map((p) => (
            <div
              key={p.id}
              className="gallery-polaroid"
              style={{ transform: `rotate(${getPhotoTilt(p.id)}deg)` }}
              onClick={() => setLightboxUrl(p.url)}
            >
              <img src={p.url} alt="" loading="lazy" />
              <div className="photo-footer">
                {p.takenAt && <div className="photo-info">{formatTime(p.takenAt)}</div>}
                <button
                  className="photo-download-btn"
                  onClick={(e) => handleDownloadClick(e, p.url)}
                  aria-label="Download"
                >
                  <DownloadIcon size={16} />
                </button>
              </div>
            </div>
          ))}
        </div>
        <div>
          {col2.map((p) => (
            <div
              key={p.id}
              className="gallery-polaroid"
              style={{ transform: `rotate(${getPhotoTilt(p.id)}deg)` }}
              onClick={() => setLightboxUrl(p.url)}
            >
              <img src={p.url} alt="" loading="lazy" />
              <div className="photo-footer">
                {p.takenAt && <div className="photo-info">{formatTime(p.takenAt)}</div>}
                <button
                  className="photo-download-btn"
                  onClick={(e) => handleDownloadClick(e, p.url)}
                  aria-label="Download"
                >
                  <DownloadIcon size={16} />
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>

      {lightboxUrl && <Lightbox url={lightboxUrl} onClose={() => setLightboxUrl(null)} />}
    </div>
  );
}

