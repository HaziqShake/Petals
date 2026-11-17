// Notifications centre (test-release). In-app only, backed by
// users/{uid}/notifications. Push is a separate prototype layer.
import { useAppContext } from '../context/AppContext';
import { useNotifications } from '../hooks/useNotifications';

export default function NotificationsPage({ onClose, onOpenChat, onOpenNote }: { onClose: () => void; onOpenChat?: () => void; onOpenNote?: (id: string) => void }) {
  const { user } = useAppContext();
  const { notifications, loading, markRead, markAllRead } = useNotifications(user?.uid ?? null);
  return (
    <div className="page" style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div className="page-header">
        <button onClick={onClose} style={{ background: 'none', border: 'none', color: 'var(--accent)', fontSize: 22, cursor: 'pointer' }} aria-label="Back">←</button>
        <h1 style={{ flex: 1 }}>Notifications</h1>
        <button className="btn-ghost" onClick={() => void markAllRead()} style={{ padding: '6px 12px' }}>Mark all read</button>
      </div>
      <p style={{ padding: '0 16px', fontSize: 12, color: 'var(--ink-muted)' }}>In-app only in this test build. Push notifications are a prototype, see TEST_RELEASE_NOTES.md. Typing is shown live in chat and notes, not stored here.</p>
      {loading ? <p style={{ padding: 16, color: 'var(--ink-muted)' }}>Loading…</p> : notifications.length === 0 ? (
        <div className="empty-state"><p>No notifications yet.</p></div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: '0 16px 16px' }}>
          {notifications.map((n) => (
            <button key={n.id} onClick={() => { void markRead(n.id); if (n.kind === 'message' && onOpenChat) onOpenChat(); else if (n.noteId && onOpenNote) onOpenNote(n.noteId); }} style={{ textAlign: 'left', background: n.read ? 'var(--surface)' : 'var(--tag-bg)', border: '1px solid var(--rule)', borderRadius: 12, padding: '12px 14px', cursor: 'pointer', color: 'var(--ink)' }}>
              <div style={{ fontWeight: 600, fontSize: 14 }}>{n.title}</div>
              <div style={{ fontSize: 13, color: 'var(--ink-muted)', marginTop: 2 }}>{n.body}</div>
              <div style={{ fontSize: 11, color: 'var(--ink-muted)', marginTop: 6 }}>{new Date(n.createdAt).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' })} - {n.kind}{n.read ? '' : ' - unread'}</div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
