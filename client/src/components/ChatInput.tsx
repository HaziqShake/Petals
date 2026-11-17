// Chat input with its own local state, so every keystroke re-renders
// only this component, never the message list. Typing is debounced:
// it tells the parent at most once per second while typing, and clears
// 3 seconds after the last keystroke.
import { useState, useRef, useEffect, useCallback } from 'react';
import { hapticSuccess } from '../utils/haptics';

interface Props {
  onSendText: (text: string) => void;
  onSendMedia: (file: File) => void;
  onTyping: (typing: boolean) => void;
  viewOnce: boolean;
  onViewOnceChange: (v: boolean) => void;
  wifiOnly: boolean;
  onWifiOnlyChange: (v: boolean) => void;
  uploadPct: number | null;
}

export default function ChatInput({ onSendText, onSendMedia, onTyping, viewOnce, onViewOnceChange, wifiOnly, onWifiOnlyChange, uploadPct }: Props) {
  const [text, setText] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);
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
    if (file) onSendMedia(file);
  };

  return (
    <div>
      {uploadPct !== null && <p style={{ fontSize: 12, textAlign: 'center', color: 'var(--ink-muted)', margin: '4px 0' }}>Uploading {uploadPct}%</p>}
      <div style={{ display: 'flex', gap: 8, padding: '10px 12px calc(10px + env(safe-area-inset-bottom))', borderTop: '1px solid var(--rule)', background: 'var(--bg)', alignItems: 'center' }}>
        <button className="toolbar-btn" onClick={() => fileRef.current?.click()} aria-label="Send photo or video" style={{ transition: 'transform 150ms ease-out' }}>+</button>
        <input ref={fileRef} type="file" accept="image/*,video/*" style={{ display: 'none' }} onChange={handleFile} />
        <label style={{ fontSize: 11, display: 'flex', gap: 4, alignItems: 'center', whiteSpace: 'nowrap' }}><input type="checkbox" checked={viewOnce} onChange={(e) => onViewOnceChange(e.target.checked)} /> View once</label>
        <label style={{ fontSize: 11, display: 'flex', gap: 4, alignItems: 'center', whiteSpace: 'nowrap' }}><input type="checkbox" checked={wifiOnly} onChange={(e) => onWifiOnlyChange(e.target.checked)} /> WiFi only</label>
        <input className="text-input" value={text} onChange={(e) => handleChange(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') submit(); }} placeholder="Message…" style={{ flex: 1 }} />
        <button className="btn-primary send-pop" onClick={submit} disabled={!text.trim()} style={{ padding: '10px 16px', transition: 'transform 150ms ease-out' }}>Send</button>
      </div>
    </div>
  );
}
