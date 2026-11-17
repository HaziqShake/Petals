// Memoized chat bubble content, Instagram-like, rebuilt for mobile.
// This renders INSIDE a Chatscope kit Message (Message.CustomContent):
// the kit owns the row, direction, grouping position and avatar, and
// this component owns the bubble chrome and every interaction.
// Memoized so typing in the input (which lives in ChatInput, with its
// own state) never re-renders the whole message list.
// - Double-tap to like: big heart burst in the centre, small heart on
//   the bubble, medium haptic. Single tap on media opens it (delayed
//   just enough to tell it apart from a double-tap).
// - Long-press (500ms, no move) opens the reaction picker: quick row
//   plus a grid plus a free any-emoji input. One reaction per user,
//   same emoji again removes it, a different one replaces it.
// - Swipe right (partner) / left (mine) over 60px to reply.
// - No disappearing messages in this app. View-once is photos and
//   videos: once the recipient has opened it, viewedBy is non-empty
//   and nobody in the app sees it again. An unviewed view-once item
//   shows only a placeholder tile, never its thumbnail, and it cannot
//   be saved.
// - Instagram bubbles: sent is the purple-pink-orange gradient with
//   white text, received is light grey (#EFEFEF, #262626 in dark).
//   Consecutive bubbles from one sender share flattened adjoining
//   corners via the `position` prop from the kit grouping. The kit
//   caps the row at 78% width; media is full-bleed inside the bubble.
//   Seen/Sent live in the chat footer under the last message, not in
//   the bubble; only Sending / Not sent / Retry show here.
import { memo, useRef, useState, useEffect, useCallback } from 'react';
import type { ChatMessage } from '../../../shared/types';
import { useCachedUrl } from '../hooks/useCachedUrl';
import { getDownloadUrl } from '../utils/b2Storage';
import { saveUrlToGallery } from '../utils/mediaStore';
import { getReactionCounts, getMyReaction, QUICK_REACTIONS, REACTION_GRID, firstEmoji } from '../utils/reactions';
import { hapticLight, hapticMedium, hapticSelection } from '../utils/haptics';
import { EyeIcon, HeartIcon } from './Icons';

export type BubblePosition = 'single' | 'first' | 'normal' | 'last';

export interface BubbleProps {
  message: ChatMessage;
  mine: boolean;
  isAdmin: boolean;
  currentUid: string | null;
  partnerName?: string;
  repliedTo?: ChatMessage;
  sending?: boolean;
  failed?: boolean;
  position?: BubblePosition;
  onOpenMedia: (m: ChatMessage) => void;
  onReply: (m: ChatMessage) => void;
  onDelete: (m: ChatMessage) => void;
  onToggleReaction: (m: ChatMessage, emoji: string) => void;
  onRetry?: (m: ChatMessage) => void;
}

const BURST_PARTICLES = [
  { left: '42%', delay: '0ms', size: 14 },
  { left: '50%', delay: '60ms', size: 18 },
  { left: '58%', delay: '30ms', size: 12 },
  { left: '35%', delay: '90ms', size: 12 },
  { left: '65%', delay: '120ms', size: 14 },
  { left: '47%', delay: '45ms', size: 10 },
  { left: '55%', delay: '100ms', size: 16 },
];

function MessageBubbleInner({ message: m, mine, currentUid, partnerName, repliedTo, sending, failed, position = 'single', onOpenMedia, onReply, onDelete, onToggleReaction, onRetry }: BubbleProps) {
  const cachedThumb = useCachedUrl(m.thumbUrl ?? m.mediaUrl, m.thumbPath ?? m.storagePath);
  const [saved, setSaved] = useState(false);
  const [saveError, setSaveError] = useState(false);
  // Inline video plays from the stored URL, which is a presigned B2 URL
  // that expires. On error, mint a fresh one from the B2 key once.
  const [videoSrc, setVideoSrc] = useState<string | undefined>(m.mediaUrl);
  const videoRefreshed = useRef(false);
  useEffect(() => { setVideoSrc(m.mediaUrl); videoRefreshed.current = false; }, [m.mediaUrl]);
  const handleVideoError = useCallback(() => {
    if (!m.storagePath || videoRefreshed.current) return;
    videoRefreshed.current = true;
    void getDownloadUrl(m.storagePath).then((fresh) => setVideoSrc(fresh)).catch(() => undefined);
  }, [m.storagePath]);
  const [burstKey, setBurstKey] = useState(0);
  const [showPicker, setShowPicker] = useState(false);
  const [showReactors, setShowReactors] = useState(false);
  const [customEmoji, setCustomEmoji] = useState('');
  const [swiped, setSwiped] = useState(false);

  const lastTapRef = useRef(0);
  const singleTapTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const longPressedRef = useRef(false);
  const dragStartRef = useRef<{ x: number; y: number } | null>(null);
  const dragDxRef = useRef(0);
  const swipedRef = useRef(false);

  // View-once for everyone, including admin and the sender: once the
  // recipient has opened it, viewedBy is non-empty and nobody in the
  // app sees the image again. The file stays in hidden app storage.
  const viewed = Boolean(m.isViewOnce && (m.viewedBy ?? []).length > 0);
  const blocked = viewed;
  const counts = getReactionCounts(m.reactions);
  // Instagram grouped corners: the corners facing the next bubble in
  // the group flatten, the tail corner on the sender side stays small.
  const bubbleRadius = mine
    ? (position === 'single' || position === 'first' ? '22px 22px 4px 22px' : '22px 4px 4px 22px')
    : (position === 'single' || position === 'first' ? '22px 22px 22px 4px' : '4px 22px 22px 4px');
  const myReaction = getMyReaction(m.reactions, currentUid);
  const isTemp = m.id.startsWith('temp-');
  const canReact = !m.deletedAt && !isTemp && !sending;
  const isMedia = m.type !== 'text' && Boolean(m.mediaUrl);

  useEffect(() => () => {
    if (singleTapTimer.current) clearTimeout(singleTapTimer.current);
    if (longPressTimer.current) clearTimeout(longPressTimer.current);
  }, []);

  const clearLongPress = useCallback(() => {
    if (longPressTimer.current) { clearTimeout(longPressTimer.current); longPressTimer.current = null; }
  }, []);

  const doLike = useCallback(() => {
    if (!canReact || !currentUid) return;
    // Only burst when liking. Double-tapping an already-liked message
    // unlikes it, and showing a heart burst for an unlike is wrong.
    if (myReaction !== '❤️') setBurstKey((k) => k + 1);
    void hapticMedium();
    onToggleReaction(m, '❤️');
  }, [canReact, currentUid, m, myReaction, onToggleReaction]);

  // Double-tap detection on the bubble itself. A single tap on media
  // is delayed 260ms so a double-tap does not also open the lightbox.
  const handleTap = useCallback(() => {
    // A swipe-to-reply fires a click right after the pointer-up; that
    // click must not also open the lightbox or like the message.
    if (swipedRef.current) { swipedRef.current = false; return; }
    if (longPressedRef.current) { longPressedRef.current = false; return; }
    const now = Date.now();
    if (now - lastTapRef.current < 300) {
      lastTapRef.current = 0;
      if (singleTapTimer.current) { clearTimeout(singleTapTimer.current); singleTapTimer.current = null; }
      doLike();
      return;
    }
    lastTapRef.current = now;
    // Images open in the lightbox on a single tap. Videos keep their
    // native controls, so a single tap on a video must not open it.
    if (m.mediaUrl && m.mediaType !== 'video' && !blocked && !m.deletedAt) {
      if (singleTapTimer.current) clearTimeout(singleTapTimer.current);
      singleTapTimer.current = setTimeout(() => { onOpenMedia(m); }, 260);
    }
  }, [blocked, doLike, m, onOpenMedia]);

  const handlePointerDown = useCallback((e: React.PointerEvent) => {
    if ((e.target as HTMLElement).closest('button, input, a, video')) return;
    dragStartRef.current = { x: e.clientX, y: e.clientY };
    dragDxRef.current = 0;
    longPressedRef.current = false;
    longPressTimer.current = setTimeout(() => {
      longPressedRef.current = true;
      setShowPicker(true);
      void hapticSelection();
    }, 500);
  }, []);

  const handlePointerMove = useCallback((e: React.PointerEvent) => {
    const start = dragStartRef.current;
    if (!start) return;
    const dx = e.clientX - start.x;
    const dy = e.clientY - start.y;
    dragDxRef.current = dx;
    if (Math.abs(dx) > 10 || Math.abs(dy) > 10) clearLongPress();
    // Swipe to reply: right for partner bubbles, left for mine, like Instagram.
    const threshold = mine ? -60 : 60;
    if (!swiped && ((mine && dx < threshold) || (!mine && dx > threshold)) && Math.abs(dy) < 30) {
      setSwiped(true);
      swipedRef.current = true;
      void hapticLight();
      onReply(m);
      setTimeout(() => setSwiped(false), 600);
    }
  }, [clearLongPress, mine, onReply, m, swiped]);

  const handlePointerUp = useCallback(() => {
    clearLongPress();
    dragStartRef.current = null;
    dragDxRef.current = 0;
  }, [clearLongPress]);

  const pickReaction = useCallback((emoji: string) => {
    if (!canReact) return;
    setShowPicker(false);
    void hapticLight();
    onToggleReaction(m, emoji);
  }, [canReact, m, onToggleReaction]);

  const submitCustomEmoji = useCallback(() => {
    const emoji = firstEmoji(customEmoji);
    if (!emoji) return;
    setCustomEmoji('');
    pickReaction(emoji);
  }, [customEmoji, pickReaction]);

  const reactorName = useCallback((uid: string) => {
    if (uid === currentUid) return 'You';
    if (m.senderUid === uid) return m.senderName ?? 'Partner';
    return partnerName ?? 'Partner';
  }, [currentUid, m.senderUid, m.senderName, partnerName]);

  const handleSave = async () => {
    if (!m.mediaUrl || m.isViewOnce) return;
    setSaveError(false);
    try {
      // Prefer a fresh presigned URL: the stored URL may have expired.
      let saveUrl = m.mediaUrl;
      if (m.storagePath) {
        try { saveUrl = await getDownloadUrl(m.storagePath); } catch { /* use the stored URL */ }
      }
      await saveUrlToGallery(saveUrl, m.id, m.mediaType === 'video' ? 'video/mp4' : 'image/webp');
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } catch {
      setSaveError(true);
    }
  };

  return (
    <div
      className="msg-pop"
      style={{ width: isMedia ? 260 : undefined, maxWidth: '100%', position: 'relative', touchAction: 'pan-y' }}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
      onPointerLeave={handlePointerUp}
      onContextMenu={(e) => e.preventDefault()}
    >
      <div
        onClick={handleTap}
        style={{
          background: isMedia ? 'transparent' : mine ? 'linear-gradient(135deg, #833ab4 0%, #fd1d1d 50%, #fcb045 100%)' : 'var(--ig-received)',
          color: mine ? '#fff' : 'var(--ink)',
          borderRadius: bubbleRadius,
          padding: isMedia ? 0 : '10px 12px',
          boxShadow: 'none',
          opacity: sending ? 0.7 : 1,
          transition: 'opacity 150ms ease-out, transform 150ms ease-out',
          cursor: 'pointer',
          position: 'relative',
          overflow: isMedia ? 'hidden' : 'visible',
        }}
      >
        {repliedTo && !isMedia && <div style={{ fontSize: 11, opacity: 0.7, marginBottom: 4 }}>Replying to: {repliedTo.text || repliedTo.type}</div>}
        {m.deletedAt ? <span style={{ fontSize: 14, opacity: 0.6 }}>Message deleted</span> : m.type === 'text' ? (
          <span style={{ fontSize: 15, lineHeight: 1.45, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{m.text}</span>
        ) : blocked ? (
          <span style={{ fontSize: 13, color: 'var(--ink-muted)' }}>Viewed once</span>
        ) : m.isViewOnce ? (
          <div style={{ width: '100%', aspectRatio: '4 / 3', borderRadius: 16, background: 'var(--tag-bg)', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 6, border: '1px dashed var(--rule)' }}>
            <EyeIcon size={28} color="var(--ink-muted)" />
            <span style={{ fontSize: 13, fontWeight: 600 }}>View once {m.mediaType === 'video' ? 'video' : 'photo'}</span>
            <span style={{ fontSize: 11, color: 'var(--ink-muted)' }}>Tap to view, it disappears after</span>
          </div>
        ) : m.mediaUrl ? m.mediaType === 'video' ? (
          <video src={videoSrc} poster={cachedThumb} preload="metadata" controls playsInline onError={handleVideoError} style={{ width: '100%', borderRadius: 16, display: 'block', background: '#000' }} />
        ) : (
          <img src={cachedThumb} alt="" loading="lazy" style={{ width: '100%', borderRadius: 16, cursor: 'pointer', display: 'block' }} />
        ) : null}
        {m.isViewOnce && !blocked && !m.deletedAt && <div style={{ fontSize: 11, marginTop: 4, opacity: 0.8 }}>View once</div>}
        {m.serverStored && m.localExpired && !blocked && !m.deletedAt && <div style={{ fontSize: 11, marginTop: 4, opacity: 0.8 }}>Stored on server - tap to download again</div>}
        {m.mediaUrl && !blocked && !m.deletedAt && !m.isViewOnce && (
          <button onClick={(e) => { e.stopPropagation(); void handleSave(); }} style={{ background: 'var(--surface)', border: '1px solid var(--rule)', borderRadius: 12, color: 'var(--accent)', cursor: 'pointer', fontSize: 11, padding: '3px 10px', marginTop: 6 }}>
            {saved ? 'Saved to gallery' : saveError ? 'Save failed, try again' : 'Save'}
          </button>
        )}
        {(sending || failed) && (
          <div style={{ display: 'flex', gap: 6, marginTop: isMedia ? 4 : 6, fontSize: 11, color: mine ? 'rgba(255,255,255,0.85)' : 'var(--ink-muted)', alignItems: 'center', justifyContent: mine ? 'flex-end' : 'flex-start' }}>
            {sending && <span>Sending…</span>}
            {failed && <span>Not sent</span>}
            {failed && onRetry && <button onClick={(e) => { e.stopPropagation(); onRetry(m); }} style={{ background: 'none', border: 'none', color: mine ? '#fff' : 'var(--accent)', cursor: 'pointer', fontSize: 11, textDecoration: 'underline' }}>Retry</button>}
          </div>
        )}

        {/* Double-tap heart burst, centre of the bubble. */}
        {burstKey > 0 && (
          <div key={burstKey} aria-hidden style={{ position: 'absolute', inset: 0, pointerEvents: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 5 }}>
            <span className="heart-burst" style={{ lineHeight: 1, display: 'flex' }}><HeartIcon size={56} color="#EA596E" fill="#EA596E" /></span>
            {BURST_PARTICLES.map((p, i) => (
              <span key={i} className="heart-float" style={{ left: p.left, animationDelay: p.delay, display: 'flex' }}><HeartIcon size={p.size} color="#EA596E" fill="#EA596E" /></span>
            ))}
          </div>
        )}
      </div>

      {/* Small heart + reaction badge under the bubble. */}
      {counts.length > 0 && (
        <button
          onClick={() => setShowReactors((v) => !v)}
          aria-label="See who reacted"
          style={{ display: 'flex', gap: 4, alignItems: 'center', marginTop: 4, marginLeft: mine ? 'auto' : 0, marginRight: mine ? 0 : 'auto', background: 'var(--surface)', border: '1px solid var(--rule)', borderRadius: 12, padding: '2px 8px', cursor: 'pointer', fontSize: 12, boxShadow: 'var(--shadow)', width: 'fit-content' }}
        >
          {counts.map((c) => (
            <span key={c.emoji} style={{ opacity: c.uids.includes(currentUid ?? '') ? 1 : 0.85 }}>{c.emoji} {c.count > 1 ? c.count : ''}</span>
          ))}
        </button>
      )}
      {showReactors && counts.length > 0 && (
        <div style={{ marginTop: 4, background: 'var(--surface)', border: '1px solid var(--rule)', borderRadius: 12, padding: '8px 10px', fontSize: 12, boxShadow: 'var(--shadow)' }}>
          {counts.flatMap((c) => c.uids.map((uid) => (
            <div key={`${c.emoji}-${uid}`}>{c.emoji} {reactorName(uid)}</div>
          )))}
        </div>
      )}

      {/* Long-press reaction picker. */}
      {showPicker && (
        <>
          <div style={{ position: 'fixed', inset: 0, zIndex: 40 }} onClick={() => setShowPicker(false)} onPointerDown={(e) => e.stopPropagation()} />
          <div className="reaction-picker-pop" style={{ position: 'absolute', bottom: 'calc(100% + 8px)', left: mine ? 'auto' : 0, right: mine ? 0 : 'auto', zIndex: 50, background: 'var(--surface)', border: '1px solid var(--rule)', borderRadius: 16, padding: 10, boxShadow: 'var(--shadow)', width: 248, maxWidth: '82vw' }}>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 8 }}>
              {QUICK_REACTIONS.map((emoji) => (
                <button
                  key={emoji}
                  onClick={() => pickReaction(emoji)}
                  aria-label={`React ${emoji}`}
                  style={{ background: myReaction === emoji ? 'var(--tag-bg)' : 'none', border: myReaction === emoji ? '1px solid var(--accent)' : '1px solid transparent', borderRadius: 12, fontSize: 22, padding: '4px 6px', cursor: 'pointer', lineHeight: 1 }}
                >{emoji}</button>
              ))}
            </div>
            <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginBottom: 8 }}>
              {REACTION_GRID.map((emoji) => (
                <button key={emoji} onClick={() => pickReaction(emoji)} aria-label={`React ${emoji}`} style={{ background: myReaction === emoji ? 'var(--tag-bg)' : 'none', border: 'none', borderRadius: 8, fontSize: 18, padding: 2, cursor: 'pointer', lineHeight: 1 }}>{emoji}</button>
              ))}
            </div>
            <div style={{ display: 'flex', gap: 6 }}>
              <input
                className="text-input"
                value={customEmoji}
                onChange={(e) => setCustomEmoji(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') submitCustomEmoji(); }}
                placeholder="Any emoji…"
                aria-label="React with any emoji"
                style={{ flex: 1, padding: '6px 10px', fontSize: 14 }}
              />
              <button onClick={submitCustomEmoji} disabled={!customEmoji.trim()} style={{ background: 'var(--primary)', border: 'none', borderRadius: 12, padding: '6px 12px', cursor: 'pointer', fontSize: 13 }}>React</button>
            </div>
            <div style={{ display: 'flex', gap: 12, marginTop: 8, fontSize: 12 }}>
              <button onClick={() => { setShowPicker(false); onReply(m); }} style={{ background: 'none', border: 'none', color: 'var(--accent)', cursor: 'pointer' }}>Reply</button>
              {mine && <button onClick={() => { setShowPicker(false); onDelete(m); }} style={{ background: 'none', border: 'none', color: 'var(--accent)', cursor: 'pointer' }}>Delete</button>}
              <button onClick={() => setShowPicker(false)} style={{ background: 'none', border: 'none', color: 'var(--ink-muted)', cursor: 'pointer', marginLeft: 'auto' }}>Close</button>
            </div>
            {myReaction && <div style={{ fontSize: 11, color: 'var(--ink-muted)', marginTop: 6 }}>Your reaction: {myReaction} - tap it again to remove it.</div>}
          </div>
        </>
      )}
    </div>
  );
}

const MessageBubble = memo(MessageBubbleInner);
export default MessageBubble;
