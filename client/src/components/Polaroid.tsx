import { useRef, useState, useEffect } from 'react';
import type { Photo } from '../../../shared/types';
import { getPhotoTilt } from '../utils/imageUtils';

interface Props {
  photo: Photo;
  onTap: () => void;
  onUpdate: (p: Photo) => void;
  onDelete: () => void;
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
    startPos.current = { x: e.clientX, y: e.clientY, px: localPhoto.x, py: localPhoto.y };
  };

  const onPointerMove = (e: React.PointerEvent) => {
    if (!dragging || !elRef.current) return;
    
    if (Math.abs(e.clientX - startPos.current.x) > 5 || Math.abs(e.clientY - startPos.current.y) > 5) {
      hasMoved.current = true;
    }
    
    const parent = elRef.current?.parentElement;
    const zoom = parent ? parseFloat(getComputedStyle(parent).getPropertyValue('--notebook-zoom') || '1') : 1;
    
    let nx = startPos.current.px;
    let ny = startPos.current.py;

    if (localPhoto.isPx) {
      const dx = (e.clientX - startPos.current.x) / zoom;
      const dy = (e.clientY - startPos.current.y) / zoom;
      nx += dx;
      ny += dy;
      elRef.current.style.left = `${nx}px`;
      elRef.current.style.top = `${ny}px`;
    } else {
      if (!parent) return;
      const { width: pw, height: ph } = parent.getBoundingClientRect();
      const dx = ((e.clientX - startPos.current.x) / pw) * 100;
      const dy = ((e.clientY - startPos.current.y) / ph) * 100;
      nx += dx;
      ny += dy;
      elRef.current.style.left = `${nx}%`;
      elRef.current.style.top = `${ny}%`;
    }

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
        onUpdate({ ...localPhoto, x: nx, y: ny });
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

  const onResizePointerMove = (e: React.PointerEvent) => {
    if (!startScale.current || !e.currentTarget.hasPointerCapture(e.pointerId) || !elRef.current) return;
    const { dist, scale } = startScale.current;
    const delta = (e.clientX - dist) / 100;
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
    onTap();
  };

  const baseSize = 140;

  return (
    <div
      ref={elRef}
      className="polaroid"
      style={{
        left: localPhoto.isPx ? `${localPhoto.x}px` : `${localPhoto.x}%`,
        top: localPhoto.isPx ? `${localPhoto.y}px` : `${localPhoto.y}%`,
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
      <img
        src={localPhoto.url}

        alt=""
        loading="lazy"
        draggable={false}
        style={{ width: '100%', height: 'auto', display: 'block', borderRadius: 2 }}
      />
      {selected && (
        <>
          <button className="delete-btn" onPointerDown={(e) => { e.stopPropagation(); onDelete(); }}>✕</button>
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
