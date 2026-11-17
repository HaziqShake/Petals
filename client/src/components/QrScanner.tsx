// QR scanner for joining a room. Uses html5-qrcode, loaded dynamically so
// it is not in the main bundle. Works on web and in Capacitor where the
// browser camera (getUserMedia) is available. If the camera is denied or
// unavailable, the caller must fall back to manual code entry, which
// AuthPage always shows underneath this scanner.
import { useEffect, useRef, useState } from 'react';
import { parseInvitePayload } from '../utils/qr';

interface Props {
  onScanned: (code: string) => void;
  onClose: () => void;
}

export default function QrScanner({ onScanned, onClose }: Props) {
  const [error, setError] = useState<string | null>(null);
  const [starting, setStarting] = useState(true);
  const handledRef = useRef(false);

  useEffect(() => {
    let scanner: { clear: () => Promise<void> } | null = null;
    let alive = true;
    (async () => {
      try {
        if (!navigator.mediaDevices?.getUserMedia) {
          throw new Error('Camera is not available on this device or browser.');
        }
        const { Html5QrcodeScanner } = await import('html5-qrcode');
        if (!alive) return;
        const s = new Html5QrcodeScanner(
          'petals-qr-reader',
          { fps: 10, qrbox: { width: 250, height: 250 } },
          false,
        );
        scanner = s as unknown as { clear: () => Promise<void> };
        s.render(
          (text: string) => {
            if (handledRef.current) return;
            const code = parseInvitePayload(text);
            if (!code) {
              setError('That QR code is not a Petals invite. Try another one.');
              return;
            }
            handledRef.current = true;
            void s.clear().catch(() => undefined);
            onScanned(code);
          },
          () => {
            // Scan errors while looking for a code are normal, ignore them.
          },
        );
        setStarting(false);
      } catch (e) {
        if (!alive) return;
        setStarting(false);
        setError(
          e instanceof Error ? e.message : 'Camera could not be started. Use the code below instead.',
        );
      }
    })();
    return () => {
      alive = false;
      if (scanner) void scanner.clear().catch(() => undefined);
    };
  }, [onScanned]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12, alignItems: 'stretch' }}>
      {starting && <p style={{ fontSize: 13, color: 'var(--ink-muted)', textAlign: 'center' }}>Starting camera…</p>}
      <div id="petals-qr-reader" style={{ width: '100%' }} />
      {error && <p style={{ fontSize: 13, color: 'var(--accent)', textAlign: 'center' }}>{error}</p>}
      <button className="btn-ghost" onClick={onClose} style={{ width: '100%' }}>
        Cancel scan, enter code instead
      </button>
    </div>
  );
}
