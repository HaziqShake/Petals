import { useEffect } from 'react';
import { DownloadIcon } from './Icons';
import { downloadImage } from '../utils/imageUtils';

interface Props {
  url: string;
  onClose: () => void;
}

export default function Lightbox({ url, onClose }: Props) {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose]);

  const handleDownload = (e: React.MouseEvent) => {
    e.stopPropagation();
    downloadImage(url);
  };

  return (
    <div className="lightbox" onClick={onClose}>
      <img src={url} alt="" onClick={(e) => e.stopPropagation()} />
      <button className="lightbox-download" onClick={handleDownload} aria-label="Download">
        <DownloadIcon size={24} color="#fff" />
      </button>
      <button className="lightbox-close" onClick={onClose} aria-label="Close">✕</button>
    </div>
  );
}

