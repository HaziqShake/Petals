import { useRef, useState, useEffect } from 'react';
import type { Photo } from '../../../shared/types';
import { getPhotoTilt } from '../utils/imageUtils';
import { normalisePhoto, getNotebookZoom, screenDeltaToLogical, moveNormalised } from '../utils/canvasCoords';
import { CloseIcon } from './Icons';

interface Props {
  photo: Photo;
  onTap: () => void;
  onUpdate: (p: Photo) => void;
  onDelete: () => void;
  // View-once (TEST ONLY): when set, a viewed photo is blurred for its viewer.
  currentUid?: string | null;
  isAdmin?: boolean;
}

export default function Polaroid({ photo, onTap, onUpdate, onDelete }: Props) {
  const [localPhoto, setLocalPhoto] = useState<Photo>(photo);
  const [selected, setSelected] = useState(false);
  const [dragging, setDragging] = useState(false);
  const elRef   = useRef<HTMLDivElement>(null);
  const startPos = useRef({ x: 0, y: 0, px: 0, py: 0 });
  const startScale = useRef({ dist: 0, scale: 1 });
  const startRotate = useRef({ cx: 0, cy: 0, startAngle: 0, startRotation: 0 });

  const wasSelected = useRef(false);
  const hasMoved = useRef(false);

  // Sync local state when external photo changes (but not while dragging)
  useEffect(() => {
    if (!dragging && !startScale.current.dist && !startRotate.current.cx) {
      setLocalPhoto(photo);
    }
  }, [photo, dragging]);

  const tilt = localPhoto.rotation !== undefined ? localPhoto.rotation : getPhotoTilt(localPhoto.id);

  useEffect(() => {
    if (elRef.current) {
      elRef.current.style.transform = `translate3d(-50%, -50%, 0) rotate(${tilt}deg) scale(${localPhoto.scale})`;
    }
  }, [tilt, localPhoto.scale]);

  useEffect(() => {
    const handleGlobalClick = (e: PointerEvent) => {
      if (elRef.current && !elRef.current.contains(e.target as Node)) {
        setSelected(false);
      }
    };
    if (selected) {
      document.addEventListener('pointerdown', handleGlobalClick);
    }
    return () => document.removeEventListener('pointerdown', handleGlobalClick);
  }, [selected]);

  // ── Drag (single pointer) ────────────────────────────────
  const onPointerDown = (e: React.PointerEvent) => {
    const isHandle = e.target instanceof Element && (
      e.target.closest('.resize-handle') || 
      e.target.closest('.rotate-handle') || 
      e.target.closest('.delete-btn')
    );
    if (isHandle) return;

    e.currentTarget.setPointerCapture(e.pointerId);
    
    wasSelected.current = selected;
    hasMoved.current = false;
    
    if (!selected) {
      setSelected(true);
      return;
    }
    
    setSelected(true);
    setDragging(true);
    const pos = normalisePhoto(localPhoto);
    startPos.current = { x: e.clientX, y: e.clientY, px: pos.xPct, py: pos.yPx };
  };

  const onPointerMove = (e: React.PointerEvent) => {
    if (!dragging || !elRef.current) return;
    
    if (Math.abs(e.clientX - startPos.current.x) > 5 || Math.abs(e.clientY - startPos.current.y) > 5) {
      hasMoved.current = true;
    }
    
    const parent = elRef.current?.parentElement;
    const zoom = getNotebookZoom(parent);
    const { dx, dy } = screenDeltaToLogical(e.clientX - startPos.current.x, e.clientY - startPos.current.y, zoom);
    const next = moveNormalised({ xPct: startPos.current.px, yPx: startPos.current.py }, dx, dy);
    elRef.current.style.left = `${next.xPct}%`;
    elRef.current.style.top = `${next.yPx}px`;

    requestAnimationFrame(() => {
      if (elRef.current) {
        elRef.current.style.transform = `translate3d(-50%, -50%, 0) rotate(${tilt}deg) scale(${localPhoto.scale})`;
      }
    });
  };

  const onPointerUp = () => {
    if (dragging || startScale.current.dist || startRotate.current.cx) {
      const el = elRef.current;
      if (el) {
        const nx = parseFloat(el.style.left);
        const ny = parseFloat(el.style.top);
        onUpdate({ ...localPhoto, x: nx, y: ny, coordVersion: 2, isPx: false });
      }
    }
    setDragging(false);
    startScale.current = { dist: 0, scale: 1 };
    startRotate.current = { cx: 0, cy: 0, startAngle: 0, startRotation: 0 };
  };

  // ── Resize (corner handle) ───────────────────────────────
  const onResizePointerDown = (e: React.PointerEvent) => {
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    startScale.current = { dist: e.clientX, scale: localPhoto.scale };
  };

  // Resize delta is in screen px, so divide by zoom to keep it consistent
  // on every device. Stored in a ref on the element for the move handler.
  const resizeZoom = () => getNotebookZoom(elRef.current?.parentElement ?? null);

  const onResizePointerMove = (e: React.PointerEvent) => {
    if (!startScale.current || !e.currentTarget.hasPointerCapture(e.pointerId) || !elRef.current) return;
    const { dist, scale } = startScale.current;
    const delta = (e.clientX - dist) / resizeZoom() / 100;
    const newScale = Math.min(2, Math.max(0.5, scale + delta));
    
    requestAnimationFrame(() => {
      if (elRef.current) {
        elRef.current.style.transform = `translate3d(-50%, -50%, 0) rotate(${tilt}deg) scale(${newScale})`;
      }
    });
    setLocalPhoto(prev => ({ ...prev, scale: newScale }));
  };

  // ── Rotate (top handle) ──────────────────────────────────
  const onRotatePointerDown = (e: React.PointerEvent) => {
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    const rect = elRef.current!.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    const angle = Math.atan2(e.clientY - cy, e.clientX - cx);
    startRotate.current = { cx, cy, startAngle: angle, startRotation: tilt };
  };

  const onRotatePointerMove = (e: React.PointerEvent) => {
    if (!startRotate.current || !e.currentTarget.hasPointerCapture(e.pointerId) || !elRef.current) return;
    const { cx, cy, startAngle, startRotation } = startRotate.current;
    const angle = Math.atan2(e.clientY - cy, e.clientX - cx);
    const delta = (angle - startAngle) * (180 / Math.PI);
    const newRotation = startRotation + delta;
    
    requestAnimationFrame(() => {
      if (elRef.current) {
        elRef.current.style.transform = `translate3d(-50%, -50%, 0) rotate(${newRotation}deg) scale(${localPhoto.scale})`;
      }
    });
    setLocalPhoto(prev => ({ ...prev, rotation: newRotation }));
  };

  // ── Tap to lightbox ──────────────────────────────────────
  const handleClick = (_e: React.MouseEvent) => {
    if (hasMoved.current) return;
    if (!wasSelected.current) return;
    if (viewedOnce) return;
    onTap();
  };

  const baseSize = 140;
  const pos = normalisePhoto(localPhoto);
  const isVideo = localPhoto.mediaType === 'video' || localPhoto.url.endsWith('.mp4');
  // View-once for everyone, including admin: once anyone has opened
  // it, viewedBy is non-empty and the app shows only a placeholder for
  // every user. The file itself is not deleted; it stays in hidden
  // app storage (Android/data/com.hi.petals/files/Petals/), findable
  // by path in a file manager, just not in the app or Gallery.
  const viewedOnce = Boolean(localPhoto.isViewOnce && (localPhoto.viewedBy ?? []).length > 0);
  // 30-day archive: the local copy is gone, the full file lives on the
  // server. Tapping still opens it; it re-downloads from the archived
  // copy. The thumbnail stays visible in the meantime.
  const archived = Boolean(localPhoto.serverStored && localPhoto.localExpired);

  return (
    <div
      ref={elRef}
      className="polaroid"
      style={{
        left: `${pos.xPct}%`,
        top: `${pos.yPx}px`,
        width: baseSize,
        zIndex: dragging ? 100 : 10,
        willChange: 'transform',
        '--tilt': `${tilt}deg`,
      } as any}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onClick={handleClick}
    >
      {viewedOnce ? (
        <div style={{ width: '100%', height: 120, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--bg)', color: 'var(--ink-muted)', fontSize: 12, textAlign: 'center', borderRadius: 2 }}>
          Viewed once
        </div>
      ) : isVideo ? (
        <video
          src={localPhoto.url}
          poster={localPhoto.thumbUrl}
          preload="metadata"
          muted
          playsInline
          draggable={false}
          style={{ width: '100%', height: 'auto', display: 'block', borderRadius: 2 }}
        />
      ) : (
        <img
          src={localPhoto.thumbUrl ?? localPhoto.url}
          alt=""
          loading="lazy"
          draggable={false}
          style={{ width: '100%', height: 'auto', display: 'block', borderRadius: 2 }}
        />
      )}
      {archived && !viewedOnce && (
        <div style={{ fontSize: 10, color: 'var(--ink-muted)', textAlign: 'center', padding: '2px 4px' }}>Stored on server - tap to download again</div>
      )}
      {selected && (
        <>
          <button className="delete-btn" onPointerDown={(e) => { e.stopPropagation(); onDelete(); }}><CloseIcon size={14} /></button>
          <div
            className="resize-handle"
            onPointerDown={onResizePointerDown}
            onPointerMove={onResizePointerMove}
            onPointerUp={onPointerUp}
          />
          <div
            className="rotate-handle"
            onPointerDown={onRotatePointerDown}
            onPointerMove={onRotatePointerMove}
            onPointerUp={onPointerUp}
          />
        </>
      )}
    </div>
  );
}
