// Room invite QR code (display only). Generates a data URL with the
// lightweight `qrcode` library. Payload is petals://room/XXXXXX.
import { useEffect, useState } from 'react';
import QRCode from 'qrcode';
import { buildInvitePayload } from '../utils/qr';

export default function RoomQr({ code }: { code: string }) {
  const [src, setSrc] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    QRCode.toDataURL(buildInvitePayload(code), { width: 220, margin: 2 })
      .then((url) => {
        if (alive) setSrc(url);
      })
      .catch(() => {
        if (alive) setError('Could not make a QR code. Use the code above instead.');
      });
    return () => {
      alive = false;
    };
  }, [code]);

  if (error) return <p style={{ fontSize: 13, color: 'var(--ink-muted)', textAlign: 'center' }}>{error}</p>;
  if (!src) return <p style={{ fontSize: 13, color: 'var(--ink-muted)', textAlign: 'center' }}>Making QR code…</p>;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8 }}>
      <img src={src} alt={`QR code for room ${code}`} style={{ width: 180, height: 180, borderRadius: 12, background: '#fff', padding: 8 }} />
      <p style={{ fontSize: 12, color: 'var(--ink-muted)', textAlign: 'center' }}>
        Scan this with your partner&apos;s phone to join room {code}.
      </p>
    </div>
  );
}
