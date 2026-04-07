/** Format epoch ms → "Thursday, 3:22 pm" (no moment.js) */
export function formatNoteTime(ts: number): string {
  const d = new Date(ts);
  const day = d.toLocaleDateString('en-US', { weekday: 'long' });
  const time = d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true }).toLowerCase();
  return `${day}, ${time}`;
}

/** Relative time label: "just now", "2 min ago", etc. */
export function relativeTime(ts: number): string {
  const diff = (Date.now() - ts) / 1000;
  if (diff < 60)   return 'just now';
  if (diff < 3600) return `${Math.floor(diff / 60)} min ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)} hr ago`;
  return `${Math.floor(diff / 86400)} days ago`;
}
