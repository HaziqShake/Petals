// Chat page, built from scratch for the test release.
// Optimistic send: a message shows immediately with Sending, then
// confirms to Sent/Read when Firestore accepts it, or shows Retry on
// failure. The list is memoized bubbles, the input keeps its own state,
// so typing never re-renders the list. Pull down at the top loads older
// messages for real. Typing comes from room.chatTyping, read receipts
// from room.lastReadAt.
import { useState, useRef, useEffect, useCallback } from 'react';
import { useAppContext } from '../context/AppContext';
import { useMessages, type NewMessage } from '../hooks/useMessages';
import { useRoomData } from '../hooks/useRoom';
import { usePullToRefresh } from '../hooks/usePullToRefresh';
import { PullToRefreshIndicator } from '../components/PullToRefreshIndicator';
import { isAdminEmail } from '../utils/admin';
import { compressPhoto, getVideoInfo, makeVideoPoster, VIDEO_MAX_SECONDS, VIDEO_MAX_MB, VIDEO_MAX_WIDTH, VIDEO_MAX_HEIGHT } from '../utils/imageCompressor';
import { uploadStoredMediaResumable } from '../utils/b2Storage';
import { uid } from '../utils/imageUtils';
import { enqueueMedia, listQueuedJobs, getQueuedBlob, dequeueMedia, isOnline, onOnlineChange, saveLocalMedia, fetchBlobCached, fetchVideoCached } from '../utils/localStore';
import { saveHiddenMedia } from '../utils/mediaStore';
import { markMediaRedownloaded } from '../utils/mediaArchive';
import Lightbox from '../components/Lightbox';
import MessageBubble from '../components/MessageBubble';
import ChatInput from '../components/ChatInput';
import type { ChatMessage } from '../../../shared/types';

interface Optimistic extends ChatMessage { temp?: boolean; failed?: boolean }

export default function ChatPage() {
  const { roomId, user } = useAppContext();
  const { messages, loading, hasMore, loadMore, sendMessage, markViewed, markCached, deleteMessage, markRoomRead, setTyping, toggleReaction } = useMessages(roomId);
  const room = useRoomData(roomId);
  const [optimistic, setOptimistic] = useState<Optimistic[]>([]);
  const [replyTo, setReplyTo] = useState<ChatMessage | null>(null);
  const [lightbox, setLightbox] = useState<{ url: string; mediaType?: 'image' | 'video'; isViewOnce?: boolean; mediaId?: string; archived?: boolean; storagePath?: string } | null>(null);
  const [search, setSearch] = useState('');
  const [showSearch, setShowSearch] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [uploadPct, setUploadPct] = useState<number | null>(null);
  // Instagram-style view-once: no sticky checkbox. Picking a photo
  // opens a preview sheet where that one photo can be sent as view
  // once. Videos never get the option (images only).
  const [pendingMedia, setPendingMedia] = useState<{ file: File; previewUrl: string; isVideo: boolean } | null>(null);
  const [pendingViewOnce, setPendingViewOnce] = useState(false);
  const [showNewPill, setShowNewPill] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);
  const nearBottomRef = useRef(true);
  const isAdmin = isAdminEmail(user?.email);
  const partnerUid = room?.members?.find((m) => m !== user?.uid) ?? null;
  const partnerTypingAt = partnerUid && room?.chatTyping ? room.chatTyping[partnerUid] ?? 0 : 0;
  // Re-render every 2s so the typing indicator expires even when no
  // new snapshot arrives (otherwise it could stick on screen).
  const [nowTick, setNowTick] = useState(Date.now());
  useEffect(() => {
    const id = setInterval(() => setNowTick(Date.now()), 2000);
    return () => clearInterval(id);
  }, []);
  const partnerTyping = partnerTypingAt > 0 && nowTick - partnerTypingAt < 5000;
  const partnerReadAt = partnerUid && room?.lastReadAt ? room.lastReadAt[partnerUid] ?? null : null;

  const { pullDist, isRefreshing, handlers } = usePullToRefresh(async () => { await loadMore(); });

  const scrollToBottom = useCallback((smooth = true) => {
    const el = listRef.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: smooth ? 'smooth' : 'auto' });
  }, []);

  const handleScroll = () => {
    const el = listRef.current;
    if (!el) return;
    nearBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 120;
    if (nearBottomRef.current) setShowNewPill(false);
  };

  useEffect(() => {
    if (nearBottomRef.current) scrollToBottom(false);
    else setShowNewPill(true);
  }, [messages.length, optimistic.length, scrollToBottom]);

  useEffect(() => {
    if (!roomId || !user) return;
    void markRoomRead(user.uid);
  }, [roomId, user, messages.length, markRoomRead]);

  const confirmSend = useCallback(async (tempId: string, data: NewMessage) => {
    try {
      const id = await sendMessage(data);
      setOptimistic((prev) => prev.filter((m) => m.id !== tempId));
      void id;
    } catch (e) {
      console.error(e);
      setOptimistic((prev) => prev.map((m) => (m.id === tempId ? { ...m, failed: true } : m)));
      setError('Message did not send. Tap Retry on it.');
    }
  }, [sendMessage]);

  const sendOptimistic = useCallback((data: NewMessage) => {
    if (!user) return;
    const temp: Optimistic = { ...data, id: `temp-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`, roomId: roomId ?? '', createdAt: Date.now(), deletedAt: null, temp: true };
    setOptimistic((prev) => [...prev, temp]);
    void confirmSend(temp.id, data);
  }, [user, roomId, confirmSend]);

  const handleSendText = useCallback((text: string) => {
    if (!user) return;
    setError(null);
    // Haptic is already fired by ChatInput on submit; do not double it.
    sendOptimistic({ senderUid: user.uid, senderName: user.displayName ?? 'Petal', text, type: 'text', replyTo: replyTo?.id ?? null });
    setReplyTo(null);
  }, [user, replyTo, sendOptimistic]);

  const handleToggleReaction = useCallback((msg: ChatMessage, emoji: string) => {
    if (!user || msg.id.startsWith('temp-')) return;
    void toggleReaction(msg.id, user.uid, emoji);
  }, [user, toggleReaction]);

  // Partner display name for the "who reacted" list. Fall back to the
  // sender name stored on a message from that uid.
  const partnerName = room?.members && partnerUid
    ? messages.find((mm) => mm.senderUid === partnerUid)?.senderName ?? 'Partner'
    : 'Partner';

  const dayLabel = useCallback((ts: number) => {
    const d = new Date(ts);
    const today = new Date();
    const yesterday = new Date();
    yesterday.setDate(today.getDate() - 1);
    const sameDay = (a: Date, b: Date) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
    if (sameDay(d, today)) return 'Today';
    if (sameDay(d, yesterday)) return 'Yesterday';
    return d.toLocaleDateString([], { day: 'numeric', month: 'long', year: 'numeric' });
  }, []);

  const handleTyping = useCallback((typing: boolean) => {
    if (user) void setTyping(user.uid, typing);
  }, [user, setTyping]);

  const handleRetry = useCallback((m: ChatMessage) => {
    if (!user) return;
    setOptimistic((prev) => prev.map((x) => (x.id === m.id ? { ...x, failed: false } : x)));
    // Build a clean payload: the optimistic copy carries temp/failed
    // flags, and spreading it into Firestore would write those flags
    // onto the real message doc. Only real message fields go out.
    const clean: NewMessage = {
      senderUid: m.senderUid,
      senderName: m.senderName,
      text: m.text,
      type: m.type,
      mediaUrl: m.mediaUrl,
      thumbUrl: m.thumbUrl,
      storagePath: m.storagePath,
      thumbPath: m.thumbPath,
      mediaType: m.mediaType,
      durationSeconds: m.durationSeconds,
      isViewOnce: m.isViewOnce,
      viewedBy: m.viewedBy ?? [],
      replyTo: m.replyTo ?? null,
    };
    void confirmSend(m.id, clean);
  }, [user, confirmSend]);

  // Flush queued media uploads when back online.
  useEffect(() => {
    if (!roomId || !user) return;
    const flush = async () => {
      const jobs = await listQueuedJobs();
      for (const job of jobs) {
        if (job.roomId !== roomId) continue;
        const blob = await getQueuedBlob(job.id);
        if (!blob) { await dequeueMedia(job.id); continue; }
        try {
          const thumb = job.isVideo ? null : null;
          const { done } = uploadStoredMediaResumable(job.roomId, '__chat__', job.id, blob, thumb, job.isVideo, () => undefined);
          const up = await done;
          // View-once is images only: a queued video never becomes view-once.
          const queuedViewOnce = job.isViewOnce && !job.isVideo;
          await sendMessage({ senderUid: user.uid, senderName: user.displayName ?? 'Petal', type: queuedViewOnce ? 'view-once' : job.isVideo ? 'video' : 'photo', mediaUrl: up.storageUrl, thumbUrl: up.thumbUrl, storagePath: up.storagePath, thumbPath: up.thumbPath, mediaType: job.isVideo ? 'video' : 'image', isViewOnce: queuedViewOnce, viewedBy: [], replyTo: null });
          await dequeueMedia(job.id);
        } catch { /* stays queued, retries next time online */ }
      }
    };
    void flush();
    return onOnlineChange((online) => { if (online) void flush(); });
  }, [roomId, user, sendMessage]);

  // Picking a file opens the preview sheet; it is only sent when the
  // user taps Send there, choosing view-once per photo if they want.
  const handlePickMedia = useCallback((file: File) => {
    const isVideo = file.type.startsWith('video/');
    setPendingViewOnce(false);
    setPendingMedia({ file, previewUrl: URL.createObjectURL(file), isVideo });
  }, []);

  const handleSendMedia = useCallback(async (file: File, viewOnceFlag = false) => {
    if (!roomId || !user) return;
    // Offline: compress/validate, then queue the media for later instead
    // of failing. Firestore queues text writes itself; Storage does not.
    if (!isOnline()) {
      try {
        const blob = file.type.startsWith('video/') ? file : (await compressPhoto(file)).full;
        await enqueueMedia({ id: uid(), kind: 'chat-media', roomId, fileName: file.name, fileType: file.type, isVideo: file.type.startsWith('video/'), isViewOnce: viewOnceFlag && !file.type.startsWith('video/'), createdAt: Date.now() }, blob);
        setError('You are offline. This will send when you are back online.');
        return;
      } catch { setError('Could not queue that file. Try again when online.'); return; }
    }
    const isVideo = file.type.startsWith('video/');
    // View-once is images only, and any photo is compressed in-app
    // until it fits, so no photo is ever rejected for size. Uploads
    // work on WiFi and on mobile data alike, no WiFi-only gate.
    const viewOncePhoto = viewOnceFlag && !isVideo;
    setError(null);
    setUploadPct(0);
    try {
      if (isVideo) {
        const info = await getVideoInfo(file);
        if (info.durationSeconds > VIDEO_MAX_SECONDS) { setError(`Video is too long. Keep clips to ${VIDEO_MAX_SECONDS} seconds.`); return; }
        if (file.size > VIDEO_MAX_MB * 1024 * 1024) { setError(`Video is too big. Max ${VIDEO_MAX_MB}MB.`); return; }
        if (info.width > VIDEO_MAX_WIDTH || info.height > VIDEO_MAX_HEIGHT) { setError('Video is over 720p. Pick a smaller clip.'); return; }
        const poster = await makeVideoPoster(file);
        const id = uid();
        const { done } = uploadStoredMediaResumable(roomId, '__chat__', id, file, poster, true, setUploadPct);
        const up = await done;
        await saveLocalMedia(up.storageUrl, file, { kind: 'video', roomId, mediaId: id, storagePath: up.storagePath, mediaType: 'video', isViewOnce: false });
        await saveHiddenMedia(id, file, 'video/mp4').catch(() => undefined);
        if (up.thumbUrl && poster) await saveLocalMedia(up.thumbUrl, poster, { kind: 'thumb' });
        sendOptimistic({ senderUid: user.uid, senderName: user.displayName ?? 'Petal', type: 'video', mediaUrl: up.storageUrl, thumbUrl: up.thumbUrl, storagePath: up.storagePath, thumbPath: up.thumbPath, mediaType: 'video', durationSeconds: Math.round(info.durationSeconds), isViewOnce: false, viewedBy: [], cachedBy: [user.uid], relayDeleted: false, replyTo: replyTo?.id ?? null });
      } else {
        const c = await compressPhoto(file);
        const id = uid();
        const { done } = uploadStoredMediaResumable(roomId, '__chat__', id, c.full, c.thumb, false, setUploadPct);
        const up = await done;
        await saveLocalMedia(up.storageUrl, c.full, { kind: 'image', roomId, mediaId: id, storagePath: up.storagePath, mediaType: 'image', isViewOnce: viewOncePhoto });
        await saveHiddenMedia(id, c.full, 'image/webp').catch(() => undefined);
        if (up.thumbUrl && c.thumb) await saveLocalMedia(up.thumbUrl, c.thumb, { kind: 'thumb' });
        sendOptimistic({ senderUid: user.uid, senderName: user.displayName ?? 'Petal', type: viewOncePhoto ? 'view-once' : 'photo', mediaUrl: up.storageUrl, thumbUrl: up.thumbUrl, storagePath: up.storagePath, thumbPath: up.thumbPath, mediaType: 'image', isViewOnce: viewOncePhoto, viewedBy: [], cachedBy: [user.uid], relayDeleted: false, replyTo: replyTo?.id ?? null });
      }
      setReplyTo(null);
    } catch (err) {
      console.error(err);
      // Show the real reason, not a generic "smaller photo" hint:
      // the compressor now guarantees any photo fits, so a failure
      // here is a network / signer / upload problem, not size.
      const msg = err instanceof Error ? err.message : 'Unknown error';
      setError(`Could not send that file: ${msg}`);
    }
    finally { setUploadPct(null); }
  }, [roomId, user, replyTo, sendOptimistic]);

  const openMedia = useCallback(async (m: ChatMessage) => {
    if (!m.mediaUrl) return;
    // View-once for everyone including admin: once the recipient has
    // opened it, it is hidden for both users. Only the recipient's
    // open counts; the sender opening their own message does not burn it.
    if (m.isViewOnce && (m.viewedBy ?? []).length > 0) return;
    const isRecipient = user && m.senderUid !== user.uid;
    if (m.isViewOnce && isRecipient && user) await markViewed(m.id, user.uid);
    if (user && m.mediaUrl) {
      // Cache the full file locally, then record it for relay cleanup.
      if (m.mediaType === 'video') await fetchVideoCached(m.mediaUrl, m.thumbUrl, { roomId: roomId ?? undefined, mediaId: m.id, storagePath: m.storagePath, isViewOnce: m.isViewOnce }).catch(() => undefined);
      else await fetchBlobCached(m.mediaUrl, { kind: 'image', roomId: roomId ?? undefined, mediaId: m.id, storagePath: m.storagePath, mediaType: 'image', isViewOnce: m.isViewOnce }).catch(() => undefined);
      // Archived item re-downloaded: clear localExpired and reset the
      // 30-day clock. The server copy stays as the long-term backup.
      if (m.serverStored && m.localExpired && roomId) await markMediaRedownloaded({ roomId, mediaId: m.id, kind: 'chat' });
      await markCached(m, user.uid, room?.members);
    }
    setLightbox({ url: m.mediaUrl, mediaType: m.mediaType, isViewOnce: m.isViewOnce, mediaId: m.id, archived: Boolean(m.serverStored && m.localExpired), storagePath: m.storagePath });
  }, [user, markViewed, markCached, room]);

  const all = [...messages, ...optimistic].sort((a, b) => a.createdAt - b.createdAt);

  // In-app search over metadata, not the file system: text, sender,
  // date and media type. The hidden files themselves are never scanned;
  // Firestore/local metadata is the index. A view-once item that was
  // already viewed stays hidden even if it matches the search.
  const q = search.trim().toLowerCase();
  const visible = q === '' ? all : all.filter((m) => {
    const date = new Date(m.createdAt).toLocaleDateString([], { day: 'numeric', month: 'short', year: 'numeric' });
    const type = m.type === 'text' ? 'text' : m.mediaType === 'video' ? 'video clip' : 'photo';
    const hay = `${m.text ?? ''} ${m.senderName ?? ''} ${date} ${type} ${m.isViewOnce ? 'view once' : ''}`.toLowerCase();
    return hay.includes(q);
  });

  return (
    <div className="page" style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '12px 12px 8px', borderBottom: '1px solid var(--rule)', background: 'var(--bg)', position: 'sticky', top: 0, zIndex: 10 }}>
        <div style={{ width: 38, height: 38, borderRadius: '50%', background: 'var(--primary)', color: 'var(--ink)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18, fontWeight: 600, flexShrink: 0, fontFamily: 'Caveat, cursive' }}>{partnerName.charAt(0).toUpperCase()}</div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 16, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{partnerName}</div>
          <div style={{ fontSize: 11, color: 'var(--ink-muted)' }}>{partnerTyping ? 'typing…' : 'Petals chat'}</div>
        </div>
        <button onClick={() => setShowSearch((v) => !v)} aria-label="Search chat" style={{ background: 'var(--tag-bg)', border: 'none', borderRadius: '50%', width: 36, height: 36, fontSize: 16, cursor: 'pointer', flexShrink: 0 }}>⌕</button>
      </div>
      {showSearch && (
        <div style={{ padding: '8px 12px 4px' }}>
          <input className="text-input" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search messages, sender, date, photo or video…" aria-label="Search chat" autoFocus style={{ borderRadius: 20 }} />
          {q !== '' && <div style={{ fontSize: 12, color: 'var(--ink-muted)', marginTop: 4 }}>{visible.length} match{visible.length === 1 ? '' : 'es'}{visible.length === 0 ? ' - try a sender name, a date like 17 Nov 2026, or photo / video' : ''}</div>}
        </div>
      )}
      <div ref={listRef} onScroll={handleScroll} {...handlers} style={{ flex: 1, overflowY: 'auto', padding: '12px', display: 'flex', flexDirection: 'column', gap: 6, position: 'relative' }}>
        <PullToRefreshIndicator pullDist={pullDist} isRefreshing={isRefreshing} threshold={70} />
        {loading ? <p style={{ color: 'var(--ink-muted)', textAlign: 'center' }}>Loading…</p> : all.length === 0 ? (
          <div className="empty-state"><p>Say hi to your partner.</p><p style={{ fontSize: 13, color: 'var(--ink-muted)' }}>Messages, photos and short clips live here. Notes stay in the notebook.</p></div>
        ) : visible.length === 0 ? (
          <div className="empty-state"><p>No matches for “{search}”.</p><p style={{ fontSize: 13, color: 'var(--ink-muted)' }}>Search matches message text, sender, date and photo or video. Viewed view-once items stay hidden.</p></div>
        ) : (
          <>
            {hasMore && q === '' && <button className="btn-ghost" onClick={() => void loadMore()} style={{ alignSelf: 'center' }}>Load older messages</button>}
            {visible.map((m, i) => {
              const prev = visible[i - 1];
              const showDay = !prev || dayLabel(prev.createdAt) !== dayLabel(m.createdAt);
              return (
                <div key={m.id} style={{ display: 'flex', flexDirection: 'column' }}>
                  {showDay && <div style={{ alignSelf: 'center', fontSize: 11, color: 'var(--ink-muted)', background: 'var(--tag-bg)', borderRadius: 12, padding: '3px 10px', margin: '6px 0' }}>{dayLabel(m.createdAt)}</div>}
                  <MessageBubble message={m} mine={m.senderUid === user?.uid} isAdmin={isAdmin} currentUid={user?.uid ?? null} partnerReadAt={partnerReadAt} partnerName={partnerName} repliedTo={m.replyTo ? messages.find((x) => x.id === m.replyTo) : undefined} sending={Boolean((m as Optimistic).temp && !(m as Optimistic).failed)} failed={Boolean((m as Optimistic).failed)} onOpenMedia={(msg) => void openMedia(msg)} onReply={setReplyTo} onDelete={(msg) => void deleteMessage(msg.id)} onToggleReaction={handleToggleReaction} onRetry={(msg) => handleRetry(msg)} />
                </div>
              );
            })}
            {partnerTyping && (
              <div style={{ alignSelf: 'flex-start', background: 'var(--surface)', borderRadius: '18px 18px 18px 4px', padding: '10px 14px', boxShadow: 'var(--shadow)', display: 'flex', gap: 4, alignItems: 'center' }}>
                <span className="typing-dot" /><span className="typing-dot" /><span className="typing-dot" />
              </div>
            )}
          </>
        )}
      </div>
      {showNewPill && <button onClick={() => scrollToBottom(true)} style={{ position: 'absolute', bottom: 170, left: '50%', transform: 'translateX(-50%)', background: 'var(--primary)', border: 'none', borderRadius: 16, padding: '6px 14px', cursor: 'pointer', fontSize: 12 }}>New messages ↓</button>}
      {replyTo && <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px', fontSize: 12, background: 'var(--tag-bg)', borderTop: '1px solid var(--rule)' }}><span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>Replying to {replyTo.text || replyTo.type}</span><button onClick={() => setReplyTo(null)} style={{ background: 'none', border: 'none', color: 'var(--accent)', cursor: 'pointer', flexShrink: 0 }}>Cancel</button></div>}
      {error && <p style={{ color: 'var(--accent)', fontSize: 13, textAlign: 'center', padding: '4px 16px' }}>{error}</p>}
      {pendingMedia && (
        <div style={{ borderTop: '1px solid var(--rule)', background: 'var(--surface)', padding: 12, display: 'flex', flexDirection: 'column', gap: 10, alignItems: 'center' }}>
          {pendingMedia.isVideo ? (
            <video src={pendingMedia.previewUrl} controls playsInline style={{ maxWidth: '100%', maxHeight: 240, borderRadius: 16, background: '#000' }} />
          ) : (
            <img src={pendingMedia.previewUrl} alt="Preview" style={{ maxWidth: '100%', maxHeight: 240, borderRadius: 16, objectFit: 'contain' }} />
          )}
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', width: '100%' }}>
            <button onClick={() => { URL.revokeObjectURL(pendingMedia.previewUrl); setPendingMedia(null); setPendingViewOnce(false); }} style={{ background: 'var(--tag-bg)', border: 'none', borderRadius: 20, padding: '10px 16px', fontSize: 14, cursor: 'pointer', color: 'var(--ink)' }}>Cancel</button>
            {!pendingMedia.isVideo && (
              <button
                onClick={() => setPendingViewOnce((v) => !v)}
                aria-pressed={pendingViewOnce}
                style={{ background: pendingViewOnce ? 'var(--accent)' : 'var(--tag-bg)', color: pendingViewOnce ? '#fff' : 'var(--ink)', border: 'none', borderRadius: 20, padding: '10px 16px', fontSize: 14, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6 }}
              >
                <span style={{ width: 20, height: 20, borderRadius: '50%', border: `1.5px solid ${pendingViewOnce ? '#fff' : 'var(--ink)'}`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 700 }}>1</span>
                View once
              </button>
            )}
            <button
              className="btn-primary"
              onClick={() => { const { file } = pendingMedia; const vo = pendingViewOnce; URL.revokeObjectURL(pendingMedia.previewUrl); setPendingMedia(null); setPendingViewOnce(false); void handleSendMedia(file, vo); }}
              style={{ flex: 1, padding: '10px 16px' }}
            >Send{pendingViewOnce ? ' view once' : ''}</button>
          </div>
        </div>
      )}
      <ChatInput onSendText={handleSendText} onPickMedia={handlePickMedia} onTyping={handleTyping} uploadPct={uploadPct} />
      {lightbox && <Lightbox url={lightbox.url} mediaId={lightbox.mediaId} mediaType={lightbox.mediaType} isViewOnce={lightbox.isViewOnce} archived={lightbox.archived} storagePath={lightbox.storagePath} onClose={() => setLightbox(null)} />}
    </div>
  );
}
