import React, { useRef, useState, useEffect } from 'react';
import type { StickerPlacement } from '../../../shared/types';
import { BUILT_IN_STICKERS } from '../assets/stickers/stickerData';
import { normaliseSticker, getNotebookZoom, screenDeltaToLogical, moveNormalised } from '../utils/canvasCoords';
import { CloseIcon } from './Icons';

interface Props {
  stickers: StickerPlacement[];
  onChange: (s: StickerPlacement[]) => void;
}

const getStickerContent = (placement: StickerPlacement) => {
  const builtin = BUILT_IN_STICKERS.find((s) => s.id === placement.stickerId);
  if (builtin) return builtin.content;
  return placement.stickerId; // custom: data URL or emoji
};

function StickerItem({
  s,
  selected,
  onPointerDown,
  onResizeDown,
  onResizeMove,
  onRotateDown,
  onRotateMove,
  onPointerUp,
  onDelete,
}: {
  s: StickerPlacement;
  selected: boolean;
  onPointerDown: (e: React.PointerEvent, id: string) => void;
  onResizeDown: (e: React.PointerEvent, s: StickerPlacement) => void;
  onResizeMove: (e: React.PointerEvent) => void;
  onRotateDown: (e: React.PointerEvent, s: StickerPlacement) => void;
  onRotateMove: (e: React.PointerEvent) => void;
  onPointerUp: () => void;
  onDelete: () => void;
}) {
  const content = getStickerContent(s);
  const isImg = content.startsWith('data:') || content.startsWith('http');
  const elRef = useRef<HTMLDivElement>(null);

  // Apply initial transform and keep it updated
  useEffect(() => {
    if (elRef.current) {
      elRef.current.style.transform = `translate3d(-50%, -50%, 0) scale(${s.scale}) rotate(${s.rotation}deg)`;
    }
  }, [s.scale, s.rotation]);

  return (
    <div
      ref={elRef}
      className={`sticker-el ${selected ? 'selected' : ''}`}
      data-id={s.id}
      style={{
        left: `${normaliseSticker(s).xPct}%`,
        top: `${normaliseSticker(s).yPx}px`,
        fontSize: 40,
        width: 56,
        height: 56,
        willChange: 'transform',
        zIndex: selected ? 100 : 1,
      }}
      onPointerDown={(e) => onPointerDown(e, s.id)}
    >
      {isImg ? (
        <img src={content} alt="" style={{ width: '100%', height: '100%', objectFit: 'contain' }} draggable={false} />
      ) : (
        <span>{content}</span>
      )}
      {selected && (
        <>
          <button className="delete-btn" onPointerDown={(e) => { e.stopPropagation(); onDelete(); }}><CloseIcon size={14} /></button>
          <div className="resize-handle" onPointerDown={(e) => onResizeDown(e, s)} onPointerMove={onResizeMove} onPointerUp={onPointerUp} />
          <div className="rotate-handle" onPointerDown={(e) => onRotateDown(e, s)} onPointerMove={onRotateMove} onPointerUp={onPointerUp} />
        </>
      )}
    </div>
  );
}export default function StickerCanvas({ stickers, onChange }: Props) {
  const [selected, setSelected] = useState<string | null>(null);
  const [localStickers, setLocalStickers] = useState<StickerPlacement[]>(stickers);
  const dragRef = useRef<{ 
    id: string; 
    el: HTMLElement; 
    startX: number; 
    startY: number; 
    px: number; 
    py: number; 
    isPx?: boolean;
    scale: number;
    rotation: number;
  } | null>(null);
  const tapRef = useRef<{ id: string; time: number } | null>(null);
  const startScale = useRef<{ dist: number; scale: number; id: string; el: HTMLElement } | null>(null);
  const startRotate = useRef<{ cx: number; cy: number; startAngle: number; startRotation: number; id: string; el: HTMLElement } | null>(null);

  useEffect(() => {
    if (!dragRef.current && !startScale.current && !startRotate.current) {
      setLocalStickers(stickers);
    }
  }, [stickers]);

  useEffect(() => {
    const handleGlobalClick = (e: PointerEvent) => {
      const target = e.target as HTMLElement;
      if (!target.closest('.sticker-el')) {
        setSelected(null);
      }
    };
    document.addEventListener('pointerdown', handleGlobalClick);
    return () => document.removeEventListener('pointerdown', handleGlobalClick);
  }, []);

  const onPointerDown = (e: React.PointerEvent, id: string) => {
    e.stopPropagation();
    const el = (e.currentTarget as HTMLElement);
    el.setPointerCapture(e.pointerId);
    setSelected(id);

    const now = Date.now();
    if (tapRef.current?.id === id && now - tapRef.current.time < 350) {
      onChange(stickers.filter((s: StickerPlacement) => s.id !== id));
      tapRef.current = null;
      return;
    }
    tapRef.current = { id, time: now };

    if (selected !== id) {
      setSelected(id);
      return;
    }

    const s = localStickers.find((x: StickerPlacement) => x.id === id)!;
    const pos = normaliseSticker(s);
    dragRef.current = {
      id, el, startX: e.clientX, startY: e.clientY, px: pos.xPct, py: pos.yPx, isPx: false,
      scale: s.scale, rotation: s.rotation
    };
  };

  const onPointerMove = (e: React.PointerEvent) => {
    if (!dragRef.current) return;
    const { el, startX, startY, px, py, isPx, scale, rotation } = dragRef.current;
    
    void isPx;
    const parent = (e.currentTarget as HTMLElement).closest('.notebook-card') as HTMLElement | null;
    const zoom = getNotebookZoom(parent);
    const { dx, dy } = screenDeltaToLogical(e.clientX - startX, e.clientY - startY, zoom);
    const next = moveNormalised({ xPct: px, yPx: py }, dx, dy);
    el.style.left = `${next.xPct}%`;
    el.style.top = `${next.yPx}px`;

    requestAnimationFrame(() => {
      el.style.transform = `translate3d(-50%, -50%, 0) scale(${scale}) rotate(${rotation}deg)`;
    });
  };

  const onPointerUp = () => {
    if (dragRef.current) {
      const { id, el } = dragRef.current;
      const nx = parseFloat(el.style.left);
      const ny = parseFloat(el.style.top);
      onChange(localStickers.map((s: StickerPlacement) => s.id === id ? { ...s, x: nx, y: ny, coordVersion: 2, isPx: false } : s));
    }
    else if (startScale.current || startRotate.current) {
      onChange(localStickers);
    }
    dragRef.current = null;
    startScale.current = null;
    startRotate.current = null;
  };

  const onStickerResizeDown = (e: React.PointerEvent, s: StickerPlacement) => {
    e.stopPropagation();
    const el = (e.currentTarget.parentElement as HTMLElement);
    e.currentTarget.setPointerCapture(e.pointerId);
    startScale.current = { dist: e.clientX, scale: s.scale, id: s.id, el };
  };

  const onStickerResizeMove = (e: React.PointerEvent) => {
    if (!startScale.current || !e.currentTarget.hasPointerCapture(e.pointerId)) return;
    const { dist, scale, id, el } = startScale.current;
    const zoom = getNotebookZoom(el.closest('.notebook-card'));
    const delta = (e.clientX - dist) / zoom / 100;
    const newScale = Math.min(3.5, Math.max(0.4, scale + delta));
    
    const s = localStickers.find((x: StickerPlacement) => x.id === id)!;
    el.style.transform = `translate3d(-50%, -50%, 0) scale(${newScale}) rotate(${s.rotation}deg)`;
    
    setLocalStickers(curr => curr.map((x: StickerPlacement) => x.id === id ? { ...x, scale: newScale } : x));
  };

  const onStickerRotateDown = (e: React.PointerEvent, s: StickerPlacement) => {
    e.stopPropagation();
    const el = (e.currentTarget.parentElement as HTMLElement);
    e.currentTarget.setPointerCapture(e.pointerId);
    const rect = el.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    const angle = Math.atan2(e.clientY - cy, e.clientX - cx);
    startRotate.current = { cx, cy, startAngle: angle, startRotation: s.rotation, id: s.id, el };
  };

  const onStickerRotateMove = (e: React.PointerEvent) => {
    if (!startRotate.current || !e.currentTarget.hasPointerCapture(e.pointerId)) return;
    const { cx, cy, startAngle, startRotation, id, el } = startRotate.current;
    const angle = Math.atan2(e.clientY - cy, e.clientX - cx);
    const delta = (angle - startAngle) * (180 / Math.PI);
    const newRotation = startRotation + delta;
    
    const s = localStickers.find((x: StickerPlacement) => x.id === id)!;
    el.style.transform = `translate3d(-50%, -50%, 0) scale(${s.scale}) rotate(${newRotation}deg)`;
    
    setLocalStickers(curr => curr.map((x: StickerPlacement) => x.id === id ? { ...x, rotation: newRotation } : x));
  };

  return (
    <div className="sticker-canvas" onPointerMove={onPointerMove} onPointerUp={onPointerUp}>
      {localStickers.map((s) => (
        <StickerItem
          key={s.id}
          s={s}
          selected={selected === s.id}
          onPointerDown={onPointerDown}
          onResizeDown={onStickerResizeDown}
          onResizeMove={onStickerResizeMove}
          onRotateDown={onStickerRotateDown}
          onRotateMove={onStickerRotateMove}
          onPointerUp={onPointerUp}
          onDelete={() => onChange(stickers.filter((x) => x.id !== s.id))}
        />
      ))}
    </div>
  );
}
