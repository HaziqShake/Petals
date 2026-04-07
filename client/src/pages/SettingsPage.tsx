import { useState } from 'react';
import { useAuth } from '../hooks/useAuth';
import { useAppContext } from '../context/AppContext';
import { useRoom } from '../hooks/useRoom';

export default function SettingsPage() {
  const { user, signOut } = useAuth();
  const { theme, setTheme, isDarkMode, setDarkMode, profile, updateProfile, roomId } = useAppContext();
  const [nameInput, setNameInput] = useState(profile?.displayName ?? user?.displayName ?? '');
  const [copied, setCopied] = useState(false);

  const { leaveRoom } = useRoom(user?.uid ?? null);

  const copyRoom = () => {
    if (roomId) {
      navigator.clipboard.writeText(roomId);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const saveName = async () => {
    if (nameInput.trim()) await updateProfile({ displayName: nameInput.trim() });
  };

  const handleSignOut = async () => {
    leaveRoom();
    await signOut();
  };

  return (
    <div className="page">
      <div className="page-header"><h1>Settings</h1></div>

      {/* Theme selection */}
      <div className="settings-section">
        <div className="settings-row">
          <span className="settings-row-label">Accent color</span>
          <div className="theme-toggle">
            <button className={`theme-btn ${theme === 'pink' ? 'active' : ''}`} onClick={() => setTheme('pink')}>
              🌸 Pink
            </button>
            <button className={`theme-btn ${theme === 'blue' ? 'active' : ''}`} onClick={() => setTheme('blue')}>
              💙 Blue
            </button>
          </div>
        </div>
        
        <div className="settings-row">
          <span className="settings-row-label">Appearance</span>
          <div className="theme-toggle">
            <button className={`theme-btn ${!isDarkMode ? 'active' : ''}`} onClick={() => setDarkMode(false)}>
              ☀️ Light
            </button>
            <button className={`theme-btn ${isDarkMode ? 'active' : ''}`} onClick={() => setDarkMode(true)}>
              🌙 Dark
            </button>
          </div>
        </div>
      </div>

      {/* Profile */}
      <div className="settings-section">
        <div className="settings-row" style={{ flexDirection: 'column', alignItems: 'flex-start', gap: 10 }}>
          <span className="settings-row-label">Display name</span>
          <div style={{ display: 'flex', gap: 8, width: '100%' }}>
            <input
              className="text-input"
              value={nameInput}
              onChange={(e) => setNameInput(e.target.value)}
              placeholder="Your name"
              style={{ flex: 1 }}
            />
            <button className="btn-ghost" style={{ padding: '10px 16px', flexShrink: 0 }} onClick={saveName}>
              Save
            </button>
          </div>
        </div>

      </div>

      {/* Room code */}
      {roomId && (
        <div className="settings-section">
          <div className="settings-row" style={{ flexDirection: 'column', gap: 12 }}>
            <span className="settings-row-label">Room invite code</span>
            <div className="room-code">{roomId}</div>
            <button className="btn-ghost" style={{ width: '100%' }} onClick={copyRoom}>
              {copied ? '✓ Copied!' : 'Copy code'}
            </button>
            <p style={{ fontSize: 12, color: 'var(--ink-muted)', textAlign: 'center' }}>
              Share this with your partner to invite them.
            </p>
          </div>
        </div>
      )}

      {/* Sign out */}
      <div className="settings-section">
        <div className="settings-row">
          <span className="settings-row-label" style={{ color: 'var(--accent)' }}>Sign out</span>
          <button className="btn-ghost" style={{ color: 'var(--accent)', borderColor: 'var(--primary)' }} onClick={handleSignOut}>
            Sign out
          </button>
        </div>
      </div>

      <div style={{ height: 32 }} />
    </div>
  );
}
