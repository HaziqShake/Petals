// Chat input, rebuilt for mobile, Instagram-like.
// Own local state, so every keystroke re-renders only this component,
// never the message list. Typing is debounced: it tells the parent at
// most once per second while typing, and clears 3 seconds after the
// last keystroke.
//
// Layout on mobile: one clean row - attach (+), a rounded text pill
// that is the biggest thing in the row, and a round send button.
// The camera lives inside the + quick menu (Take a photo), not as
// its own button in the row, so the message bar gets the width.
// There is no WiFi-only checkbox
// and no view-once checkbox here: uploads work on WiFi and on mobile
// data alike, and view-once is chosen per photo in the preview sheet
// that opens after picking it, like Instagram, not as a sticky toggle.
// - Camera: a second hidden file input with capture="environment"
//   opens the phone camera directly on Android, no new plugin needed.
//   The gallery input has no capture attribute, so it opens the picker.
// - Picking a file does not send it: onPickMedia hands it to ChatPage,
//   which shows the preview sheet with Send / View once.
import { useState, useRef, useEffect, useCallback } from 'react';
import { hapticSuccess } from '../utils/haptics';

interface Props {
  onSendText: (text: string) => void;
  onPickMedia: (file: File) => void;
  onTyping: (typing: boolean) => void;
  uploadPct: number | null;
  onOpenPicker?: () => void;
}

export default function ChatInput({ onSendText, onPickMedia, onTyping, uploadPct, onOpenPicker }: Props) {
  const [text, setText] = useState('');
  const [showAttach, setShowAttach] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const cameraRef = useRef<HTMLInputElement>(null);
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

  const handleFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (e.target) e.target.value = '';
    setShowAttach(false);
    if (file) onPickMedia(file);
  };

  return (
    <div style={{ position: 'relative', background: 'var(--bg)' }}>
      {uploadPct !== null && (
        <div style={{ height: 3, background: 'var(--tag-bg)', borderRadius: 2, overflow: 'hidden', margin: '0 12px' }}>
          <div style={{ height: '100%', width: `${uploadPct}%`, background: 'var(--accent)', borderRadius: 2, transition: 'width 200ms ease-out' }} />
        </div>
      )}
      {showAttach && (
        <>
          <div style={{ position: 'fixed', inset: 0, zIndex: 40 }} onClick={() => setShowAttach(false)} />
          <div style={{ position: 'absolute', bottom: 'calc(100% + 8px)', left: 12, zIndex: 50, background: 'var(--surface)', border: '1px solid var(--rule)', borderRadius: 16, padding: 6, boxShadow: 'var(--shadow)', width: 220, display: 'flex', flexDirection: 'column' }}>
            {onOpenPicker && <button onClick={() => { setShowAttach(false); onOpenPicker(); }} style={{ background: 'none', border: 'none', textAlign: 'left', padding: '10px 12px', fontSize: 14, color: 'var(--ink)', cursor: 'pointer', borderRadius: 10 }}>Browse photos and videos</button>}
            <button onClick={() => fileRef.current?.click()} style={{ background: 'none', border: 'none', textAlign: 'left', padding: '10px 12px', fontSize: 14, color: 'var(--ink)', cursor: 'pointer', borderRadius: 10 }}>Photo or video from gallery</button>
            <button onClick={() => cameraRef.current?.click()} style={{ background: 'none', border: 'none', textAlign: 'left', padding: '10px 12px', fontSize: 14, color: 'var(--ink)', cursor: 'pointer', borderRadius: 10 }}>Take a photo</button>
          </div>
        </>
      )}
      <div style={{ display: 'flex', gap: 8, padding: '10px 12px calc(10px + env(safe-area-inset-bottom))', alignItems: 'flex-end' }}>
        <button className="toolbar-btn" onClick={() => setShowAttach((v) => !v)} aria-label="Attach photo, video or camera" style={{ flexShrink: 0, width: 36, height: 36, fontSize: 20, transition: 'transform 150ms ease-out' }}>{showAttach ? '×' : '+'}</button>
        <input ref={fileRef} type="file" accept="image/*,video/*" style={{ display: 'none' }} onChange={handleFile} />
        <input ref={cameraRef} type="file" accept="image/*" capture="environment" style={{ display: 'none' }} onChange={handleFile} />
        <input
          className="text-input"
          value={text}
          onChange={(e) => handleChange(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') submit(); }}
          placeholder="Message…"
          aria-label="Message"
          style={{ flex: '1 1 0', minWidth: 0, borderRadius: 24, padding: '12px 18px', fontSize: 16, lineHeight: 1.4 }}
        />
        <button
          className="send-pop"
          onClick={submit}
          disabled={!text.trim()}
          aria-label="Send message"
          style={{ flexShrink: 0, width: 40, height: 40, borderRadius: '50%', border: 'none', background: text.trim() ? 'var(--accent)' : 'var(--tag-bg)', color: text.trim() ? '#fff' : 'var(--ink-muted)', fontSize: 18, cursor: text.trim() ? 'pointer' : 'default', display: 'flex', alignItems: 'center', justifyContent: 'center', transition: 'transform 150ms ease-out, background 150ms ease-out' }}
        >↑</button>
      </div>
    </div>
  );
}
