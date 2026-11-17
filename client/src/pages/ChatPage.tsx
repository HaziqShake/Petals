// Chat page, rebuilt on the open-source Chatscope Chat UI Kit (MIT),
// styled to look like Instagram, mobile first.
//
// What the kit owns: MainContainer / ChatContainer layout, the
// ConversationHeader, the MessageList (scroll, sticky auto-scroll to
// the bottom, load-more on reaching the top, typing indicator slot),
// Message rows (direction, grouping position, avatar slot) and the
// date separators. What Petals still owns: the data. Firebase
// (hooks/useMessages.ts) is the source of truth; Firestore messages
// are mapped into the kit's message models for display, and sending
// still goes through the existing path (optimistic send, offline
// queue, typing, read receipts, reactions, view-once).
//
// Instagram thread: gradient sent bubbles, grey received bubbles,
// tight grouped corners with an avatar on the last received bubble
// of a group, centered date pills, Seen under the last message only,
// and the Instagram input bar (blue camera circle, Message... pill,
// gallery, mic) below the list. The custom input bar is NOT the
// kit's MessageInput: ChatContainer only renders the kit's own
// input, so the Petals input bar sits below the kit container in
// the page column, which is also where the reply bar, error line
// and media preview sheet live.
import { useState, useRef, useEffect, useCallback, Fragment } from 'react';
import '@chatscope/chat-ui-kit-styles/dist/default/styles.min.css';
import '../styles/chatscope-ig.css';
import {
  MainContainer,
  ChatContainer,
  ConversationHeader,
  MessageList,
  Message,
  MessageSeparator,
  TypingIndicator,
  Avatar,
} from '@chatscope/chat-ui-kit-react';
import { useAppContext } from '../context/AppContext';
import { useMessages, type NewMessage } from '../hooks/useMessages';
import { useRoomData } from '../hooks/useRoom';
import { isAdminEmail } from '../utils/admin';
import { compressPhoto, getVideoInfo, makeVideoPoster, VIDEO_MAX_SECONDS, VIDEO_MAX_MB, VIDEO_MAX_WIDTH, VIDEO_MAX_HEIGHT } from '../utils/imageCompressor';
import { uploadStoredMediaResumable } from '../utils/b2Storage';
import { uid } from '../utils/imageUtils';
import { enqueueMedia, listQueuedJobs, getQueuedBlob, dequeueMedia, isOnline, onOnlineChange, saveLocalMedia, fetchBlobCached, fetchVideoCached } from '../utils/localStore';
import { saveHiddenMedia } from '../utils/mediaStore';
import { markMediaRedownloaded } from '../utils/mediaArchive';
import Lightbox from '../components/Lightbox';
import MessageBubble, { type BubblePosition } from '../components/MessageBubble';
import ChatInput from '../components/ChatInput';
import MediaPickerSheet from '../components/MediaPickerSheet';
import CameraScreen from '../components/CameraScreen';
import { ArrowLeftIcon, SearchIcon } from '../components/Icons';
import type { ChatMessage } from '../../../shared/types';

interface Optimistic extends ChatMessage { temp?: boolean; failed?: boolean }

interface Props {
  onBack?: () => void;
}

function relativeActive(ts: number, now: number): string {
  const diffMin = Math.max(0, Math.round((now - ts) / 60000));
  if (diffMin < 1) return 'Active now';
  if (diffMin < 60) return `Active ${diffMin}m ago`;
  const diffH = Math.round(diffMin / 60);
  if (diffH < 24) return `Active ${diffH}h ago`;
  return `Active ${Math.round(diffH / 24)}d ago`;
}

export default function ChatPage({ onBack }: Props) {
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
  // or video opens a preview sheet where that one item can be sent
  // as view once. Photos and videos both get the option.
  const [pendingMedia, setPendingMedia] = useState<{ file: File; previewUrl: string; isVideo: boolean } | null>(null);
  const [pendingViewOnce, setPendingViewOnce] = useState(false);
  const [showPicker, setShowPicker] = useState(false);
  const [showCamera, setShowCamera] = useState(false);
  const fallbackFileRef = useRef<HTMLInputElement>(null);
  const [showNewPill, setShowNewPill] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const nearBottomRef = useRef(true);
  const kitRootRef = useRef<HTMLDivElement>(null);
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

  const scrollListToBottom = useCallback(() => {
    const el = kitRootRef.current?.querySelector('.cs-message-list__scroll-wrapper') as HTMLElement | null;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
    setShowNewPill(false);
  }, []);

  useEffect(() => {
    if (nearBottomRef.current) setShowNewPill(false);
    else setShowNewPill(true);
  }, [messages.length, optimistic.length]);

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

  const handleLoadMore = useCallback(() => {
    if (!hasMore || loadingMore) return;
    setLoadingMore(true);
    void loadMore().finally(() => setLoadingMore(false));
  }, [hasMore, loadingMore, loadMore]);

  const handleReachEnd = useCallback(() => {
    nearBottomRef.current = true;
    setShowNewPill(false);
  }, []);

  const handleReachStart = useCallback(() => {
    nearBottomRef.current = false;
    handleLoadMore();
  }, [handleLoadMore]);

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
          const videoType = job.isVideo ? (job.fileType || 'video/mp4') : undefined;
          const { done } = uploadStoredMediaResumable(job.roomId, '__chat__', job.id, blob, thumb, job.isVideo, () => undefined, videoType);
          const up = await done;
          // View-once applies to photos and videos alike.
          const queuedViewOnce = job.isViewOnce;
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
        await enqueueMedia({ id: uid(), kind: 'chat-media', roomId, fileName: file.name, fileType: file.type, isVideo: file.type.startsWith('video/'), isViewOnce: viewOnceFlag, createdAt: Date.now() }, blob);
        setError('You are offline. This will send when you are back online.');
        return;
      } catch { setError('Could not queue that file. Try again when online.'); return; }
    }
    const isVideo = file.type.startsWith('video/');
    // View-once applies to photos and videos alike, chosen per item
    // in the preview sheet. Any photo is compressed in-app until it
    // fits, so no photo is ever rejected for size. Uploads work on
    // WiFi and on mobile data alike, no WiFi-only gate.
    const viewOncePhoto = viewOnceFlag;
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
        // Thread the real mime type: camera clips are often webm,
        // gallery clips usually mp4. The key extension follows it.
        const videoType = file.type || 'video/mp4';
        const { done } = uploadStoredMediaResumable(roomId, '__chat__', id, file, poster, true, setUploadPct, videoType);
        const up = await done;
        await saveLocalMedia(up.storageUrl, file, { kind: 'video', roomId, mediaId: id, storagePath: up.storagePath, mediaType: 'video', isViewOnce: viewOncePhoto });
        await saveHiddenMedia(id, file, videoType).catch(() => undefined);
        if (up.thumbUrl && poster) await saveLocalMedia(up.thumbUrl, poster, { kind: 'thumb' });
        sendOptimistic({ senderUid: user.uid, senderName: user.displayName ?? 'Petal', type: viewOncePhoto ? 'view-once' : 'video', mediaUrl: up.storageUrl, thumbUrl: up.thumbUrl, storagePath: up.storagePath, thumbPath: up.thumbPath, mediaType: 'video', durationSeconds: Math.round(info.durationSeconds), isViewOnce: viewOncePhoto, viewedBy: [], cachedBy: [user.uid], relayDeleted: false, replyTo: replyTo?.id ?? null });
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

  const headerInfo = partnerTyping
    ? 'typing…'
    : partnerReadAt !== null
      ? relativeActive(partnerReadAt, nowTick)
      : 'Petals chat';

  const lastVisible = visible.length > 0 ? visible[visible.length - 1] : null;
  const lastSeen = Boolean(
    lastVisible && user && lastVisible.senderUid === user.uid && !lastVisible.deletedAt
    && partnerReadAt !== null && partnerReadAt >= lastVisible.createdAt,
  );

  // Group position for Instagram's stacked corners: a group is a run
  // of messages from one sender on one day.
  const positionFor = (i: number): BubblePosition => {
    const m = visible[i];
    const prev = visible[i - 1];
    const next = visible[i + 1];
    const samePrev = Boolean(prev && prev.senderUid === m.senderUid && dayLabel(prev.createdAt) === dayLabel(m.createdAt));
    const sameNext = Boolean(next && next.senderUid === m.senderUid && dayLabel(next.createdAt) === dayLabel(m.createdAt));
    if (!samePrev && !sameNext) return 'single';
    if (!samePrev) return 'first';
    if (!sameNext) return 'last';
    return 'normal';
  };

  return (
    <div className="page" style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {showSearch && (
        <div style={{ padding: '8px 12px 4px', background: 'var(--bg)' }}>
          <input className="text-input" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search messages, sender, date, photo or video…" aria-label="Search chat" autoFocus style={{ borderRadius: 20 }} />
          {q !== '' && <div style={{ fontSize: 12, color: 'var(--ink-muted)', marginTop: 4 }}>{visible.length} match{visible.length === 1 ? '' : 'es'}{visible.length === 0 ? ' - try a sender name, a date like 17 Nov 2026, or photo / video' : ''}</div>}
        </div>
      )}
      <div ref={kitRootRef} className="petals-chat-kit" style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
        <MainContainer>
          <ChatContainer>
            <ConversationHeader>
              {onBack && (
                <ConversationHeader.Back>
                  <button onClick={onBack} aria-label="Back to notes" style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--ink)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <ArrowLeftIcon size={24} />
                  </button>
                </ConversationHeader.Back>
              )}
              <Avatar name={partnerName}>
                <span className="petals-avatar-initial">{partnerName.charAt(0).toUpperCase()}</span>
              </Avatar>
              <ConversationHeader.Content userName={partnerName} info={headerInfo} />
              <ConversationHeader.Actions>
                <button onClick={() => setShowSearch((v) => !v)} aria-label="Search chat" style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--ink)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <SearchIcon size={20} />
                </button>
              </ConversationHeader.Actions>
            </ConversationHeader>
            <MessageList
              autoScrollToBottom
              autoScrollToBottomOnMount
              loading={loading}
              loadingMore={loadingMore}
              disableOnYReachWhenNoScroll
              onYReachStart={handleReachStart}
              onYReachEnd={handleReachEnd}
              typingIndicator={partnerTyping ? <TypingIndicator content={`${partnerName} is typing`} /> : undefined}
            >
              {loading && all.length === 0 ? null : all.length === 0 ? (
                <div style={{ padding: '32px 16px', textAlign: 'center', color: 'var(--ink-muted)' }}>
                  <p style={{ fontSize: 15, color: 'var(--ink)' }}>Say hi to your partner.</p>
                  <p style={{ fontSize: 13, marginTop: 4 }}>Messages, photos and short clips live here. Notes stay in the notebook.</p>
                </div>
              ) : visible.length === 0 ? (
                <div style={{ padding: '32px 16px', textAlign: 'center', color: 'var(--ink-muted)' }}>
                  <p style={{ fontSize: 15, color: 'var(--ink)' }}>No matches for &ldquo;{search}&rdquo;.</p>
                  <p style={{ fontSize: 13, marginTop: 4 }}>Search matches message text, sender, date and photo or video. Viewed view-once items stay hidden.</p>
                </div>
              ) : (
                visible.map((m, i) => {
                  const prev = visible[i - 1];
                  const showDay = !prev || dayLabel(prev.createdAt) !== dayLabel(m.createdAt);
                  const mine = m.senderUid === user?.uid;
                  const position = positionFor(i);
                  const isGroupStart = position === 'single' || position === 'first';
                  const showAvatar = !mine && (position === 'last' || position === 'single');
                  const isLast = i === visible.length - 1;
                  // Fragment, not a div: the kit finds the last message
                  // with a direct-child DOM selector, so no wrapper
                  // element may sit between the list and the Message.
                  return (
                    <Fragment key={m.id}>
                      {showDay && (
                        <MessageSeparator>
                          <span style={{ fontSize: 11, color: 'var(--ink-muted)', background: 'var(--tag-bg)', borderRadius: 12, padding: '3px 10px' }}>{dayLabel(m.createdAt)}</span>
                        </MessageSeparator>
                      )}
                      <Message
                        model={{
                          direction: mine ? 'outgoing' : 'incoming',
                          position,
                          sender: m.senderName,
                          sentTime: new Date(m.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
                        }}
                        avatarSpacer={!mine && !showAvatar}
                        avatarPosition="bl"
                        className={isGroupStart ? 'petals-group-start' : undefined}
                      >
                        {showAvatar && (
                          <Avatar name={partnerName} size="sm">
                            <span className="petals-avatar-initial">{partnerName.charAt(0).toUpperCase()}</span>
                          </Avatar>
                        )}
                        <Message.CustomContent>
                          <MessageBubble
                            message={m}
                            mine={mine}
                            isAdmin={isAdmin}
                            currentUid={user?.uid ?? null}
                            partnerName={partnerName}
                            repliedTo={m.replyTo ? messages.find((x) => x.id === m.replyTo) : undefined}
                            sending={Boolean((m as Optimistic).temp && !(m as Optimistic).failed)}
                            failed={Boolean((m as Optimistic).failed)}
                            position={position}
                            onOpenMedia={(msg) => void openMedia(msg)}
                            onReply={setReplyTo}
                            onDelete={(msg) => void deleteMessage(msg.id)}
                            onToggleReaction={handleToggleReaction}
                            onRetry={(msg) => handleRetry(msg)}
                          />
                        </Message.CustomContent>
                        {isLast && lastSeen && (
                          <Message.Footer>
                            <span>Seen</span>
                          </Message.Footer>
                        )}
                      </Message>
                    </Fragment>
                  );
                })
              )}
            </MessageList>
          </ChatContainer>
        </MainContainer>
      </div>
      {showNewPill && <button onClick={scrollListToBottom} style={{ position: 'absolute', bottom: 170, left: '50%', transform: 'translateX(-50%)', background: 'var(--primary)', border: 'none', borderRadius: 16, padding: '6px 14px', cursor: 'pointer', fontSize: 12, zIndex: 20 }}>New messages</button>}
      {replyTo && <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px', fontSize: 12, background: 'var(--tag-bg)', borderTop: '1px solid var(--rule)' }}><span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>Replying to {replyTo.text || replyTo.type}</span><button onClick={() => setReplyTo(null)} style={{ background: 'none', border: 'none', color: 'var(--accent)', cursor: 'pointer', flexShrink: 0 }}>Cancel</button></div>}
      {error && <p style={{ color: 'var(--accent)', fontSize: 13, textAlign: 'center', padding: '4px 16px', background: 'var(--bg)' }}>{error}</p>}
      {pendingMedia && (
        <div style={{ borderTop: '1px solid var(--rule)', background: 'var(--surface)', padding: 12, display: 'flex', flexDirection: 'column', gap: 10, alignItems: 'center' }}>
          {pendingMedia.isVideo ? (
            <video src={pendingMedia.previewUrl} controls playsInline style={{ maxWidth: '100%', maxHeight: 240, borderRadius: 16, background: '#000' }} />
          ) : (
            <img src={pendingMedia.previewUrl} alt="Preview" style={{ maxWidth: '100%', maxHeight: 240, borderRadius: 16, objectFit: 'contain' }} />
          )}
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', width: '100%' }}>
            <button onClick={() => { URL.revokeObjectURL(pendingMedia.previewUrl); setPendingMedia(null); setPendingViewOnce(false); }} style={{ background: 'var(--tag-bg)', border: 'none', borderRadius: 20, padding: '10px 16px', fontSize: 14, cursor: 'pointer', color: 'var(--ink)' }}>Cancel</button>
            <button
              onClick={() => setPendingViewOnce((v) => !v)}
              aria-pressed={pendingViewOnce}
              style={{ background: pendingViewOnce ? 'var(--accent)' : 'var(--tag-bg)', color: pendingViewOnce ? '#fff' : 'var(--ink)', border: 'none', borderRadius: 20, padding: '10px 16px', fontSize: 14, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6 }}
            >
              <span style={{ width: 20, height: 20, borderRadius: '50%', border: `1.5px solid ${pendingViewOnce ? '#fff' : 'var(--ink)'}`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 700 }}>1</span>
              View once
            </button>
            <button
              className="btn-primary"
              onClick={() => { const { file } = pendingMedia; const vo = pendingViewOnce; URL.revokeObjectURL(pendingMedia.previewUrl); setPendingMedia(null); setPendingViewOnce(false); void handleSendMedia(file, vo); }}
              style={{ flex: 1, padding: '10px 16px' }}
            >Send{pendingViewOnce ? ' view once' : ''}</button>
          </div>
        </div>
      )}
      {showPicker && (
        <MediaPickerSheet
          onPick={(file) => { setShowPicker(false); handlePickMedia(file); }}
          onClose={() => setShowPicker(false)}
          onFallbackGallery={() => { setShowPicker(false); fallbackFileRef.current?.click(); }}
          onTakePhoto={() => { setShowPicker(false); setShowCamera(true); }}
        />
      )}
      <input ref={fallbackFileRef} type="file" accept="image/*,video/*" style={{ display: 'none' }} onChange={(e) => { const f = e.target.files?.[0]; if (e.target) e.target.value = ''; if (f) handlePickMedia(f); }} />
      {showCamera && (
        <CameraScreen
          onCapture={(file) => { setShowCamera(false); handlePickMedia(file); }}
          onClose={() => setShowCamera(false)}
          onOpenGallery={() => { setShowCamera(false); setShowPicker(true); }}
        />
      )}
      <ChatInput onSendText={handleSendText} onTyping={handleTyping} uploadPct={uploadPct} onOpenPicker={() => setShowPicker(true)} onOpenCamera={() => setShowCamera(true)} />
      {lightbox && <Lightbox url={lightbox.url} mediaId={lightbox.mediaId} mediaType={lightbox.mediaType} isViewOnce={lightbox.isViewOnce} archived={lightbox.archived} storagePath={lightbox.storagePath} onClose={() => setLightbox(null)} />}
    </div>
  );
}
