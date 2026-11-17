// Room invite QR payload helpers.
// Payload format is petals://room/XXXXXX (6-char code). Scanners also
// accept a bare 6-char code and a URL with ?code=XXXXXX, so a QR made by
// another app still works.
export function buildInvitePayload(code: string): string {
  return `petals://room/${code.trim().toUpperCase()}`;
}

export function parseInvitePayload(raw: string): string | null {
  const text = raw.trim();
  if (!text) return null;
  const codeOnly = /^[A-Z0-9]{6}$/i.exec(text);
  if (codeOnly) return codeOnly[0].toUpperCase();
  const petals = /^petals:\/\/room\/([A-Z0-9]{6})$/i.exec(text);
  if (petals) return petals[1].toUpperCase();
  try {
    const url = new URL(text);
    const code = url.searchParams.get('code') ?? url.searchParams.get('room');
    if (code && /^[A-Z0-9]{6}$/i.test(code)) return code.toUpperCase();
  } catch {
    // Not a URL, fall through.
  }
  return null;
}

export function isValidRoomCode(code: string): boolean {
  return /^[A-Z0-9]{6}$/.test(code.trim().toUpperCase());
}
