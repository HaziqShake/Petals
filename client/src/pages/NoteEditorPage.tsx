import React, { useState, useEffect, useRef, useLayoutEffect } from 'react';
import { doc, getDoc } from 'firebase/firestore';
import { db } from '../firebase';
import { useNote } from '../hooks/useNote';
import { useAppContext } from '../context/AppContext';
import type { Photo, StickerPlacement } from '../../../shared/types';
import { compressToDataUrl, measureImage, uid } from '../utils/imageUtils';
import { compressPhoto } from '../utils/imageCompressor';
import { uploadStoredMediaResumable, isOnCellular } from '../utils/b2Storage';
import { saveLocalMedia, fetchBlobCached } from '../utils/localStore';
import { markMediaRedownloaded } from '../utils/mediaArchive';
import { saveHiddenMedia } from '../utils/mediaStore';
import { useRoomData } from '../hooks/useRoom';
import { usePhotos } from '../hooks/usePhotos';
import { centreOfVisibleCard } from '../utils/canvasCoords';
import { isAdminEmail } from '../utils/admin';
import type { StoredPhoto } from '../../../shared/types';
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
  const room = useRoomData(roomId);
  const { note, saveDebounced, setTyping, updateStickers, updatePhotos } = useNote(roomId, noteId);
  const { photos: storedPhotos, loading: storedLoading, hasMore: storedHasMore, loadMore: loadMoreStored, addPhoto, updatePhoto, markViewed, markCached, deletePhoto } = usePhotos(roomId, noteId);
  const [viewOnce, setViewOnce] = useState(false);
  const [wifiOnly, setWifiOnly] = useState(true);
  const [uploadPct, setUploadPct] = useState<number | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const isAdmin = isAdminEmail(user?.email);

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
  const [lightboxMeta, setLightboxMeta] = useState<{ mediaId: string; mediaType?: 'image' | 'video'; isViewOnce?: boolean; archived?: boolean; storagePath?: string } | null>(null);
  const openLightbox = (url: string, meta?: { mediaId: string; mediaType?: 'image' | 'video'; isViewOnce?: boolean; archived?: boolean; storagePath?: string }) => {
    setLightboxMeta(meta ?? null);
    setLightboxUrl(url);
  };
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



  // Storage-first insert. New photos go to B2 (via the signer Worker) +
  // the photos subcollection (paginated, thumbnails first), never into
  // the note doc, so the 1 MiB doc limit cannot break the note. Legacy
  // base64 photos are kept as a fallback only if the B2 upload fails.
  // Photos only in notes: videos stay in Chat only (2026-11-17).
  // Existing video docs in Firestore are NOT deleted, they are just
  // never uploaded or shown here any more.
  const insertPhotoFile = async (file: File) => {
    if (!roomId || !note) return;
    setUploadError(null);
    if (file.type.startsWith('video/')) { setUploadError('Videos stay in Chat. Notes are photos only.'); return; }
    if (wifiOnly && isOnCellular()) { setUploadError('WiFi-only upload is on. Connect to WiFi or turn it off in the toolbar.'); return; }
    setUploading(true);
    try {
      const centre = centreOfVisibleCard(wrapperRef.current);
      const id = uid();
      const { w, h } = await measureImage(file);
      const c = await compressPhoto(file);
      const { done } = uploadStoredMediaResumable(roomId, noteId, id, c.full, c.thumb, false, setUploadPct);
      const up = await done;
      // Client-side primary: the full compressed photo is stored on
      // this device first, in hidden app storage and IndexedDB.
      await saveLocalMedia(up.storageUrl, c.full, { kind: 'image', roomId, noteId, mediaId: id, storagePath: up.storagePath, mediaType: 'image', isViewOnce: viewOnce });
      await saveHiddenMedia(id, c.full, 'image/webp').catch(() => undefined);
      if (up.thumbUrl && c.thumb) await saveLocalMedia(up.thumbUrl, c.thumb, { kind: 'thumb' });
      const stored: StoredPhoto = { id, roomId, noteId, url: up.storageUrl, storageUrl: up.storageUrl, thumbUrl: up.thumbUrl, storagePath: up.storagePath, thumbPath: up.thumbPath, width: c.width, height: c.height, scale: 1, rotation: 0, x: centre.xPct, y: centre.yPx, coordVersion: 2, takenAt: file.lastModified, createdAt: Date.now(), mediaType: 'image', isViewOnce: viewOnce, viewedBy: [], cachedBy: user ? [user.uid] : [], relayDeleted: false };
      await addPhoto(stored);
      setViewOnce(false);
      void w; void h;
    } catch (err) {
      console.error('Photo import failed:', err);
      // Fallback: legacy base64, capped at 6 so the note doc cannot blow up.
      if ((note?.photos?.length ?? 0) >= 6) { setUploadError('Storage upload failed and this note already has 6 legacy photos. Try again when online.'); return; }
      try {
        const { w, h } = await measureImage(file);
        const dataUrl = await compressToDataUrl(file);
        const centre = centreOfVisibleCard(wrapperRef.current);
        const photo: Photo = { id: uid(), url: dataUrl, scale: 1, rotation: 0, width: w, height: h, x: centre.xPct, y: centre.yPx, coordVersion: 2, isPx: false, takenAt: file.lastModified, isViewOnce: viewOnce, viewedBy: [] };
        updatePhotos([...(note?.photos ?? []), photo]);
      } catch { setUploadError('Could not import photo. Please try again.'); }
    } finally { setUploading(false); setUploadPct(null); }
  };

  const handlePhotoInsert = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) { void insertPhotoFile(file);
      e.target.value = '';
    }
  };

  const handleStickerAdd = (sticker: Omit<StickerPlacement, 'id'>) => {
    const id = uid();
    const centre = centreOfVisibleCard(wrapperRef.current);
    const placement: StickerPlacement = { ...sticker, id, x: centre.xPct, y: centre.yPx, coordVersion: 2, isPx: false };
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

            {/* Polaroid photos (positioned absolutely on the canvas).
                Photos only: existing video docs are hidden here, they
                stay in Firestore and videos live in Chat only. */}
            {note.photos.filter((photo) => photo.mediaType !== 'video').map((photo) => (
              <Polaroid
                key={photo.id}
                photo={photo}
                currentUid={user?.uid ?? null}
                isAdmin={isAdmin}
                onTap={async () => { if (photo.isViewOnce && user && !(photo.viewedBy ?? []).includes(user.uid)) { const updated = { ...photo, viewedBy: [...(photo.viewedBy ?? []), user.uid] }; updatePhotos(note.photos.map((p) => p.id === photo.id ? updated : p)); } openLightbox(photo.url, { mediaId: photo.id, mediaType: photo.mediaType, isViewOnce: photo.isViewOnce }); }}
                onUpdate={(updated) => {
                  updatePhotos(note.photos.map((p) => p.id === photo.id ? updated : p));
                }}
                onDelete={() => updatePhotos(note.photos.filter((p) => p.id !== photo.id))}
              />
            ))}
            {storedPhotos.filter((s) => s.mediaType !== 'video').filter((s) => !note.photos.some((p) => p.id === s.id)).map((s) => {
              const asPhoto: Photo = { id: s.id, url: s.storageUrl, thumbUrl: s.thumbUrl, storageUrl: s.storageUrl, width: s.width, height: s.height, scale: s.scale, rotation: s.rotation, x: s.x, y: s.y, coordVersion: 2, takenAt: s.takenAt, mediaType: s.mediaType, isViewOnce: s.isViewOnce, viewedBy: s.viewedBy, serverStored: s.serverStored, localExpired: s.localExpired, archivedAt: s.archivedAt, archivedUrl: s.archivedUrl, archivedPath: s.archivedPath };
              return (
                <Polaroid
                  key={s.id}
                  photo={asPhoto}
                  currentUid={user?.uid ?? null}
                  isAdmin={isAdmin}
                  onTap={async () => {
                    // View-once: the first Lightbox open marks it viewed
                    // for everyone, including admin. The file stays in
                    // hidden app storage, it is not deleted.
                    if (s.isViewOnce && user && (s.viewedBy ?? []).length === 0) await markViewed(s.id, user.uid);
                    if (user) {
                      // Cache the full file locally first, then record
                      // it, so the relay can be cleaned up once both
                      // members have it.
                      await fetchBlobCached(s.storageUrl, { kind: s.mediaType === 'video' ? 'video' : 'image', roomId: roomId ?? undefined, noteId, mediaId: s.id, storagePath: s.storagePath, mediaType: s.mediaType, isViewOnce: s.isViewOnce }).catch(() => undefined);
                      // Archived item re-downloaded: clear localExpired
                      // and reset the 30-day clock. The server copy stays.
                      if (s.serverStored && s.localExpired && roomId) await markMediaRedownloaded({ roomId, noteId, mediaId: s.id, kind: 'note' });
                      await markCached(s, user.uid, room?.members);
                    }
                    openLightbox(s.storageUrl, { mediaId: s.id, mediaType: s.mediaType, isViewOnce: s.isViewOnce, archived: Boolean(s.serverStored && s.localExpired), storagePath: s.storagePath });
                  }}
                  onUpdate={(updated) => { void updatePhoto(s.id, { x: updated.x, y: updated.y, scale: updated.scale, rotation: updated.rotation }); }}
                  onDelete={() => void deletePhoto(s)}
                />
              );
            })}
            {storedHasMore && !storedLoading && <button className="btn-ghost" onClick={() => void loadMoreStored()} style={{ position: 'absolute', bottom: 12, left: '50%', transform: 'translateX(-50%)' }}>Load more photos</button>}

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
        <label style={{ fontSize: 11, display: 'flex', gap: 4, alignItems: 'center', color: 'var(--ink-muted)' }}><input type="checkbox" checked={viewOnce} onChange={(e) => setViewOnce(e.target.checked)} /> View once</label>
        <label style={{ fontSize: 11, display: 'flex', gap: 4, alignItems: 'center', color: 'var(--ink-muted)' }}><input type="checkbox" checked={wifiOnly} onChange={(e) => setWifiOnly(e.target.checked)} /> WiFi only</label>
        {uploadPct !== null && <span style={{ fontSize: 12, color: 'var(--ink-muted)' }}>{uploadPct}%</span>}
        {uploadError && <span style={{ fontSize: 12, color: 'var(--accent)' }}>{uploadError}</span>}
        <input ref={fileRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={handlePhotoInsert} />
      </div>

      {lightboxUrl && <Lightbox url={lightboxUrl} mediaId={lightboxMeta?.mediaId} mediaType={lightboxMeta?.mediaType} isViewOnce={lightboxMeta?.isViewOnce} archived={lightboxMeta?.archived} storagePath={lightboxMeta?.storagePath} onClose={() => { setLightboxUrl(null); setLightboxMeta(null); }} />}
      {showStickerPicker && (
        <StickerPicker
          onSelect={handleStickerAdd}
          onClose={() => setShowStickerPicker(false)}
        />
      )}
    </div>
  );
}

