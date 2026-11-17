// Chat input, Instagram-style, mobile first.
// Own local state, so every keystroke re-renders only this component,
// never the message list. Typing is debounced: it tells the parent at
// most once per second while typing, and clears 3 seconds after the
// last keystroke.
//
// Instagram input bar, left to right: a blue gradient circular camera
// button (opens the in-app camera), the Message... pill which is the
// biggest thing in the row, a gallery button (opens the media picker
// sheet), and a mic icon. The mic is decorative only: voice messages
// do not exist in Petals, so tapping it does nothing and there is no
// fake recording UI. When the pill has text, the mic is replaced by a
// send button (paper plane). Every touch target is at least 44px, with
// safe-area padding at the bottom.
// No WiFi-only checkbox and no view-once checkbox here: uploads work
// on WiFi and on mobile data alike, and view-once is chosen per photo
// in the preview sheet that opens after picking it, like Instagram,
// not as a sticky toggle.
import { useState, useEffect, useCallback, useRef } from 'react';
import { hapticSuccess } from '../utils/haptics';
import { CameraIcon, ImageIcon, MicIcon, SendIcon } from './Icons';

interface Props {
  onSendText: (text: string) => void;
  onTyping: (typing: boolean) => void;
  uploadPct: number | null;
  onOpenPicker?: () => void;
  onOpenCamera?: () => void;
}

export default function ChatInput({ onSendText, onTyping, uploadPct, onOpenPicker, onOpenCamera }: Props) {
  const [text, setText] = useState('');
  const lastTypingSent = useRef(0);
  const clearTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => { if (clearTimer.current) clearTimeout(clearTimer.current); }, []);

  const handleChange = useCallback((value: string) => {
    setText(value);
    const now = Date.now();
    if (value.trim() && now - lastTypingSent.current > 1000) {
      lastTypingSent.current = now;
      onTyping(true);
    }
    if (clearTimer.current) clearTimeout(clearTimer.current);
    clearTimer.current = setTimeout(() => onTyping(false), 3000);
  }, [onTyping]);

  const submit = useCallback(() => {
    const t = text.trim();
    // No global "sending" gate here: messages send optimistically and
    // each one tracks its own state, so fast consecutive sends work.
    if (!t) return;
    void hapticSuccess();
    onSendText(t);
    setText('');
    if (clearTimer.current) clearTimeout(clearTimer.current);
    onTyping(false);
  }, [text, onSendText, onTyping]);

  const hasText = text.trim().length > 0;

  return (
    <div style={{ position: 'relative', background: 'var(--bg)', borderTop: '1px solid var(--rule)' }}>
      {uploadPct !== null && (
        <div style={{ height: 3, background: 'var(--tag-bg)', borderRadius: 2, overflow: 'hidden', margin: '0 12px' }}>
          <div style={{ height: '100%', width: `${uploadPct}%`, background: 'var(--accent)', borderRadius: 2, transition: 'width 200ms ease-out' }} />
        </div>
      )}
      <div style={{ display: 'flex', gap: 6, padding: '10px 12px calc(10px + env(safe-area-inset-bottom))', alignItems: 'center' }}>
        <button
          onClick={() => onOpenCamera?.()}
          aria-label="Open camera"
          style={{ flexShrink: 0, width: 44, height: 44, borderRadius: '50%', border: 'none', background: 'linear-gradient(135deg, #3797F0 0%, #5851DB 100%)', color: '#fff', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
        ><CameraIcon size={22} color="#fff" /></button>
        <input
          className="text-input"
          value={text}
          onChange={(e) => handleChange(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') submit(); }}
          placeholder="Message..."
          aria-label="Message"
          style={{ flex: '1 1 0', minWidth: 0, borderRadius: 24, padding: '12px 18px', fontSize: 16, lineHeight: 1.4 }}
        />
        <button
          onClick={() => onOpenPicker?.()}
          aria-label="Send a photo or video"
          style={{ flexShrink: 0, width: 44, height: 44, borderRadius: '50%', border: 'none', background: 'none', color: 'var(--ink)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
        ><ImageIcon size={22} /></button>
        {hasText ? (
          <button
            className="send-pop"
            onClick={submit}
            aria-label="Send message"
            style={{ flexShrink: 0, width: 44, height: 44, borderRadius: '50%', border: 'none', background: 'linear-gradient(135deg, #833ab4 0%, #fd1d1d 50%, #fcb045 100%)', color: '#fff', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', transition: 'transform 150ms ease-out' }}
          ><SendIcon size={20} color="#fff" /></button>
        ) : (
          <button
            aria-label="Voice message (not available)"
            style={{ flexShrink: 0, width: 44, height: 44, borderRadius: '50%', border: 'none', background: 'none', color: 'var(--ink-muted)', cursor: 'default', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
          ><MicIcon size={20} /></button>
        )}
      </div>
    </div>
  );
}
