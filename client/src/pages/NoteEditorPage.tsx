import React, { useState, useEffect, useRef, useLayoutEffect } from 'react';
import { doc, getDoc } from 'firebase/firestore';
import { db } from '../firebase';
import { useNote } from '../hooks/useNote';
import { useAppContext } from '../context/AppContext';
import type { Photo, StickerPlacement } from '../../../shared/types';
import { compressToDataUrl, measureImage, uid } from '../utils/imageUtils';
import { formatNoteTime } from '../utils/formatDate';
import StickerCanvas from '../components/StickerCanvas';
import Polaroid from '../components/Polaroid';
import Lightbox from '../components/Lightbox';
import StickerPicker from '../components/StickerPicker';

interface Props {
  noteId: string;
  onBack: () => void;
}

export default function NoteEditorPage({ noteId, onBack }: Props) {
  const { roomId, user, theme } = useAppContext();
  const { note, saveDebounced, setTyping, updateStickers, updatePhotos } = useNote(roomId, noteId);

  const titleRef = useRef<HTMLInputElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const typingTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const selectionRef = useRef<Range | null>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const el = wrapperRef.current;
    if (!el) return;
    const observer = new ResizeObserver((entries) => {
      const w = entries[0].contentRect.width;
      const zoom = w / 360;
      el.style.setProperty('--notebook-zoom', `${zoom}`);
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const saveSelection = () => {
    const sel = window.getSelection();
    if (sel && sel.rangeCount > 0) {
      selectionRef.current = sel.getRangeAt(0);

      if (sel.isCollapsed && user) {
        // Pick color based on theme and dark mode
        // LIGHT MODE: dark colors for ink-on-paper look
        // DARK MODE: light colors for high contrast
        // Always stamp the semantic hexes; CSS variables handle the dynamic swap
        const color = theme === 'pink' ? '#350e2b' : '#0b1a30';

        document.execCommand('styleWithCSS', false, 'true');
        document.execCommand('foreColor', false, color);

      }
    }
  };

  const [lightboxUrl, setLightboxUrl] = useState<string | null>(null);
  const [showStickerPicker, setShowStickerPicker] = useState(false);
  const [uploading, setUploading] = useState(false);

  // Sync note content to DOM
  useEffect(() => {
    if (!note) return;

    // Only update the DOM if the partner is the one editing (or if nobody is editing).
    // If we are currently editing, we don't want to clobber our own active cursor!
    if (note.editingBy !== user?.uid) {
      if (titleRef.current && titleRef.current.value !== note.title) {
        titleRef.current.value = note.title;
      }
      if (bodyRef.current && bodyRef.current.innerHTML !== note.bodyHtml) {
        bodyRef.current.innerHTML = note.bodyHtml;
      }
    }
  }, [note?.bodyHtml, note?.title, note?.editingBy, user?.uid]);

  const handleTitleChange = () => {
    const title = titleRef.current?.value ?? '';
    saveDebounced({ title });
  };

  const handleBodyInput = () => {
    const bodyHtml = bodyRef.current?.innerHTML ?? '';
    const body = bodyRef.current?.innerText ?? '';
    saveDebounced({ bodyHtml, body });

    // Typing indicator
    if (user) {
      setTyping(user.uid);
      if (typingTimer.current) clearTimeout(typingTimer.current);
      typingTimer.current = setTimeout(() => setTyping(null), 3000);
    }
  };

  // Clear typing indicator on unmount
  useEffect(() => {
    return () => {
      if (typingTimer.current) clearTimeout(typingTimer.current);
      setTyping(null);
    };
  }, []);



  const insertPhotoFile = async (file: File) => {
    if (!roomId) return;
    if ((note?.photos?.length ?? 0) >= 6) {
      alert('Max 6 photos per note');
      return;
    }
    setUploading(true);
    try {
      // 1. Measure dimensions locally
      const { w, h } = await measureImage(file);

      // 2. Compress to base64 data URL (no network, no Firebase Storage)
      const dataUrl = await compressToDataUrl(file);

      // 3. Calculate position on the notebook
      const card = document.querySelector('.notebook-card');
      let startX = 40;
      let startY = 40;
      if (card) {
        const rect = card.getBoundingClientRect();
        const zoom = parseFloat(getComputedStyle(card).getPropertyValue('--notebook-zoom') || '1');
        startX = ((window.innerWidth / 2) - rect.left) / zoom - 75;
        startY = ((window.innerHeight / 2) - rect.top) / zoom - 75;
      }

      const id = uid();
      const photo: Photo = {
        id,
        url: dataUrl,
        scale: 1,
        rotation: 0,
        width: w,
        height: h,
        x: startX,
        y: startY,
        isPx: true,
        takenAt: file.lastModified,
      };

      updatePhotos([...(note?.photos ?? []), photo]);
    } catch (err) {
      console.error('Photo import failed:', err);
      alert('Could not import photo. Please try again.');
    } finally {
      setUploading(false);
    }
  };


  const handlePhotoInsert = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      insertPhotoFile(file);
      e.target.value = '';
    }
  };

  const handleStickerAdd = (sticker: Omit<StickerPlacement, 'id'>) => {
    const id = uid();
    const card = document.querySelector('.notebook-card');
    let startX = 40;
    let startY = 40;
    if (card) {
      const rect = card.getBoundingClientRect();
      const zoom = parseFloat(getComputedStyle(card).getPropertyValue('--notebook-zoom') || '1');
      startX = ((window.innerWidth / 2) - rect.left) / zoom - 28;
      startY = ((window.innerHeight / 2) - rect.top) / zoom - 28;
    }
    const placement: StickerPlacement = { ...sticker, id, x: startX, y: startY, isPx: true };
    updateStickers([...(note?.stickers ?? []), placement]);
    setShowStickerPicker(false);
  };

  const handlePaste = (e: React.ClipboardEvent) => {
    const items = e.clipboardData.items;
    for (const item of Array.from(items)) {
      if (item.type.indexOf('image') !== -1) {
        const file = item.getAsFile();
        if (file) {
          e.preventDefault();
          insertPhotoFile(file);
          break;
        }
      }
    }
  };

  const partnerUid = note?.editingBy && note.editingBy !== user?.uid ? note.editingBy : null;
  const [partnerName, setPartnerName] = useState('Partner');

  useEffect(() => {
    if (!partnerUid) return;
    getDoc(doc(db, 'users', partnerUid)).then((snap) => {
      if (snap.exists()) {
        const name = snap.data().displayName?.split(' ')[0] || 'Partner';
        setPartnerName(name);
      }
    });
  }, [partnerUid]);

  if (!note) {
    return (
      <div className="page" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <span style={{ color: 'var(--ink-muted)' }}>Loading…</span>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: 'var(--bg)' }}>
      {/* Top bar */}
      <div className="page-header" style={{ borderBottom: '1px solid var(--rule)' }}>
        <button
          onClick={onBack}
          style={{ background: 'none', border: 'none', color: 'var(--accent)', fontSize: 22, cursor: 'pointer', padding: '4px 0' }}
          aria-label="Back"
        >
          ←
        </button>
        <span style={{ flex: 1, fontFamily: 'Caveat, cursive', fontSize: 18, color: 'var(--ink-muted)' }}>
          {formatNoteTime(note.updatedAt)}
        </span>
      </div>

      {/* Notebook card wrapper */}
      <div className="notebook-wrapper" ref={wrapperRef} style={{ flex: 1, overflowY: 'auto', overflowX: 'hidden', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
        <div
          className="notebook-scale-spacer"
          style={{
            width: '100%',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            height: 'calc((note?.photos?.length > 0 ? 5600 : 5600) * var(--notebook-zoom, 1))', // Needs to sync with min-height minus some padding
            minHeight: 'calc(5600px * var(--notebook-zoom, 1))'
          }}
        >
          <div
            className="notebook-card"
            style={{
              position: 'relative',
              width: 360,
              margin: '0 auto',
              transform: 'scale(var(--notebook-zoom, 1))',
              transformOrigin: 'top center',
            }}
          >


            <div className="spiral-top" />

            {/* Title */}
            <input
              ref={titleRef}
              className="note-title-input"
              defaultValue={note.title}
              placeholder="Title…"
              onChange={handleTitleChange}
            />

            {/* Body (contenteditable) */}
            <div
              ref={bodyRef}
              className="note-body"
              contentEditable
              suppressContentEditableWarning
              data-placeholder="Write something lovely…"
              onInput={handleBodyInput}
              onKeyUp={saveSelection}
              onMouseUp={saveSelection}
              onBlur={saveSelection}
              onPaste={handlePaste}
            />

            {/* Polaroid photos (positioned absolutely on the canvas) */}
            {note.photos.map((photo) => (
              <Polaroid
                key={photo.id}
                photo={photo}
                onTap={() => setLightboxUrl(photo.url)}
                onUpdate={(updated) => {
                  updatePhotos(note.photos.map((p) => p.id === photo.id ? updated : p));
                }}
                onDelete={() => updatePhotos(note.photos.filter((p) => p.id !== photo.id))}
              />
            ))}

            {/* Sticker layer */}
            <StickerCanvas
              stickers={note.stickers}
              onChange={updateStickers}
            />
          </div>
        </div>
      </div>


      <div className={`typing-pill ${partnerUid ? 'visible' : ''}`}>
        {partnerName} is typing<span className="dot-anim">...</span>
      </div>

      {/* Toolbar */}
      <div className="editor-toolbar">
        <button
          className="toolbar-btn"
          onClick={() => fileRef.current?.click()}
          aria-label="Add photo"
          disabled={uploading}
        >
          {uploading ? '…' : (
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="3" width="18" height="18" rx="2"/>
              <circle cx="8.5" cy="8.5" r="1.5"/>
              <polyline points="21 15 16 10 5 21"/>
            </svg>
          )}
        </button>
        <button
          className="toolbar-btn"
          onClick={() => setShowStickerPicker(true)}
          aria-label="Add sticker"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
          </svg>
        </button>
        <input ref={fileRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={handlePhotoInsert} />
      </div>

      {lightboxUrl && <Lightbox url={lightboxUrl} onClose={() => setLightboxUrl(null)} />}
      {showStickerPicker && (
        <StickerPicker
          onSelect={handleStickerAdd}
          onClose={() => setShowStickerPicker(false)}
        />
      )}
    </div>
  );
}

