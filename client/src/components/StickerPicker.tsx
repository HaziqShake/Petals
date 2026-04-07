import { useState } from 'react';
import { BUILT_IN_STICKERS } from '../assets/stickers/stickerData';
import type { StickerPlacement } from '../../../shared/types';

interface Props {
  onSelect: (s: Omit<StickerPlacement, 'id'>) => void;
  onClose: () => void;
}

export default function StickerPicker({ onSelect, onClose }: Props) {
  const [anyEmoji, setAnyEmoji] = useState('');

  const handleBuiltIn = (stickerId: string) => {
    onSelect({ stickerId, x: 30 + Math.random() * 40, y: 30 + Math.random() * 40, scale: 1, rotation: 0 });
  };

  const handleAddEmoji = () => {
    if (!anyEmoji.trim()) return;
    // We just take the first emoji/char they paste
    const char = [...anyEmoji.trim()][0]; 
    onSelect({ stickerId: char, x: 30 + Math.random() * 40, y: 30 + Math.random() * 40, scale: 1, rotation: 0 });
    setAnyEmoji('');
  };

  return (
    <div
      style={{
        position: 'fixed', inset: 0, zIndex: 200,
        display: 'flex', flexDirection: 'column', justifyContent: 'flex-end',
      }}
      onClick={onClose}
    >
      <div
        style={{
          background: 'var(--surface)', borderRadius: '20px 20px 0 0',
          padding: '16px', maxHeight: '75vh', overflowY: 'auto',
          boxShadow: '0 -4px 20px rgba(0,0,0,0.12)',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16, gap: 12 }}>
          <span style={{ fontFamily: 'Caveat, cursive', fontSize: 24, color: 'var(--ink)' }}>Pick a Sticker</span>
          <div style={{ display: 'flex', background: 'var(--tag-bg)', borderRadius: 20, padding: '2px 4px', alignItems: 'center' }}>
            <input 
              placeholder="Paste any emoji..." 
              value={anyEmoji}
              onChange={e => setAnyEmoji(e.target.value)}
              style={{ background: 'none', border: 'none', fontSize: 13, padding: '6px 10px', width: 120, outline: 'none' }}
              onKeyDown={e => e.key === 'Enter' && handleAddEmoji()}
            />
            <button 
              onClick={handleAddEmoji}
              style={{ background: 'var(--accent)', color: '#fff', border: 'none', borderRadius: 16, width: 28, height: 28, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
            >
              +
            </button>
          </div>
        </div>
        <div className="sticker-grid">
          {BUILT_IN_STICKERS.map((s) => (
            <button
              key={s.id}
              className="sticker-item"
              onClick={() => handleBuiltIn(s.content)}
              title={s.label}
            >
              {s.content}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
