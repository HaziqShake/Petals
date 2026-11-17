import { useState, useEffect } from 'react';
import { useAuth } from '../hooks/useAuth';
import { useRoom } from '../hooks/useRoom';
import { useAppContext } from '../context/AppContext';
import { PetalIcon } from '../components/Icons';
import { useUserRooms } from '../hooks/useUserRooms';
import type { Room } from '../../../shared/types';
import RoomQr from '../components/RoomQr';
import QrScanner from '../components/QrScanner';
import { isValidRoomCode } from '../utils/qr';

type Step = 'welcome' | 'choice' | 'create' | 'join';

export default function AuthPage() {
  const { user, signInWithGoogle, signUpWithEmail, signInWithEmail, resetPassword, authError: hookAuthError } = useAuth();
  const { setRoomId } = useAppContext();
  const { createRoom, joinRoom, loading, error } = useRoom(user?.uid ?? null);
  const [step, setStep] = useState<Step>(user ? 'choice' : 'welcome');
  const [code, setCode] = useState('');
  const [generatedCode, setGeneratedCode] = useState('');
  const [copied, setCopied] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);
  const [emailMode, setEmailMode] = useState<'login' | 'signup' | null>(null);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [emailBusy, setEmailBusy] = useState(false);
  const [resetSent, setResetSent] = useState(false);
  const [showScanner, setShowScanner] = useState(false);

  const { rooms, deleteRoom } = useUserRooms(user?.uid ?? null);

  useEffect(() => {
    if (user && step === 'welcome') {
      setStep('choice');
    }
  }, [user, step]);

  const handleSignIn = async () => {
    setAuthError(null);
    try {
      await signInWithGoogle();
    } catch (e: any) {
      console.error('Sign in error:', e);
      setAuthError(e.message || 'Failed to sign in. Please try again.');
    }
  };

  const handleCreate = async () => {
    const c = await createRoom();
    setGeneratedCode(c);
    setRoomId(c);
    setStep('create');
  };

  const handleJoin = async () => {
    const clean = code.trim().toUpperCase();
    if (!isValidRoomCode(clean)) { setAuthError('That code does not look right. It should be 6 letters or numbers.'); return; }
    setAuthError(null);
    await joinRoom(clean);
    setRoomId(clean);
  };

  const handleEmailAuth = async () => {
    const e = email.trim();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e)) { setAuthError('Enter a valid email address.'); return; }
    if (password.length < 6) { setAuthError('Password needs at least 6 characters.'); return; }
    setEmailBusy(true);
    setAuthError(null);
    try {
      if (emailMode === 'signup') await signUpWithEmail(e, password);
      else await signInWithEmail(e, password);
    } catch (err) {
      setAuthError(err instanceof Error ? err.message : 'Could not sign in.');
    } finally { setEmailBusy(false); }
  };

  const handleDeleteRoom = async (e: React.MouseEvent, rid: string) => {
    e.stopPropagation();
    if (confirm('Are you sure you want to delete or leave this room?')) {
      await deleteRoom(rid);
    }
  };

  const copyCode = () => {
    navigator.clipboard.writeText(generatedCode);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  if (step === 'welcome') {
    return (
      <div className="auth-screen">
        <div className="auth-logo" style={{ marginBottom: 40, display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
          <PetalIcon size={120} color="var(--accent)" fill="var(--accent)" />
          <h1 style={{ fontSize: 48, marginTop: 16, fontFamily: 'Caveat, cursive' }}>Petals</h1>
        </div>
        <div className="auth-card" style={{ padding: '32px 24px', textAlign: 'center' }}>
          <p className="auth-tagline" style={{ marginBottom: 32, fontSize: 18, opacity: 0.9, lineHeight: 1.4 }}>
            A private little notebook,<br />just for the two of you.
          </p>
          
          {authError ? (
            <div style={{ textAlign: 'center' }}>
              <p style={{ color: 'var(--accent)', fontSize: 14, marginBottom: 16 }}>{authError}</p>
              <button className="btn-primary" onClick={handleSignIn} style={{ width: '100%' }}>
                Try Again
              </button>
            </div>
          ) : (
            <>
              <button className="btn-primary" onClick={handleSignIn} style={{ width: '100%' }}>
                Continue with Google
              </button>
              <div style={{ textAlign: 'center', fontSize: 13, color: 'var(--ink-muted)', margin: '12px 0' }}>— or use email —</div>
              {emailMode === null ? (
                <div style={{ display: 'flex', gap: 8 }}>
                  <button className="btn-ghost" onClick={() => setEmailMode('login')} style={{ flex: 1 }}>Sign in with email</button>
                  <button className="btn-ghost" onClick={() => setEmailMode('signup')} style={{ flex: 1 }}>Sign up with email</button>
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8, textAlign: 'left' }}>
                  <input className="text-input" type="email" placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" />
                  <input className="text-input" type="password" placeholder="Password (6+ characters)" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete={emailMode === 'signup' ? 'new-password' : 'current-password'} onKeyDown={(e) => { if (e.key === 'Enter') void handleEmailAuth(); }} />
                  <button className="btn-primary" onClick={() => void handleEmailAuth()} disabled={emailBusy} style={{ width: '100%' }}>{emailBusy ? 'Please wait…' : emailMode === 'signup' ? 'Create account' : 'Sign in'}</button>
                  {emailMode === 'login' && <button className="btn-ghost" onClick={async () => { if (!email.trim()) { setAuthError('Enter your email first, then tap forgot password.'); return; } try { await resetPassword(email.trim()); setResetSent(true); } catch (err) { setAuthError(err instanceof Error ? err.message : 'Could not send reset email.'); } }} style={{ width: '100%' }}>Forgot password?</button>}
                  {resetSent && <p style={{ fontSize: 12, color: 'var(--ink-muted)', textAlign: 'center' }}>Reset email sent. Check your inbox.</p>}
                  <button className="btn-ghost" onClick={() => { setEmailMode(null); setAuthError(null); }} style={{ width: '100%' }}>Back to Google sign-in</button>
                  {(authError || hookAuthError) && <p style={{ color: 'var(--accent)', fontSize: 13, textAlign: 'center' }}>{authError || hookAuthError}</p>}
                </div>
              )}
            </>
          )}
        </div>
      </div>
    );
  }

  if (step === 'choice') {
    return (
      <div className="auth-screen">
        <div className="auth-logo">
          <PetalIcon size={48} color="var(--accent)" />
          <span>Petals</span>
        </div>
        <div className="auth-card">
          <p style={{ textAlign: 'center', color: 'var(--ink-muted)', fontSize: 14, marginBottom: 12 }}>
            Hi {user?.displayName?.split(' ')[0]}!
          </p>
          
          <button className="btn-primary" onClick={handleCreate} disabled={loading} style={{ width: '100%' }}>
            {loading ? 'Creating…' : 'Create a new room'}
          </button>
          <div style={{ textAlign: 'center', fontSize: 13, color: 'var(--ink-muted)', margin: '8px 0' }}>— or —</div>
          <button className="btn-ghost" onClick={() => setStep('join')} style={{ width: '100%' }}>
            Join with an invite code
          </button>

          {rooms.length > 0 && (
            <>
              <div style={{ height: 1, background: 'var(--rule)', margin: '16px -20px' }} />
              <p style={{ fontSize: 12, fontWeight: 600, color: 'var(--ink-muted)', marginBottom: 8, textTransform: 'uppercase', letterSpacing: 0.5 }}>
                Your Rooms
              </p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8, maxHeight: 200, overflowY: 'auto', paddingRight: 4 }}>
                {rooms.map((r: Room) => (
                  <div
                    key={r.id}
                    className="room-item"
                    onClick={() => setRoomId(r.id)}
                    style={{ 
                      display: 'flex', 
                      alignItems: 'center', 
                      justifyContent: 'space-between',
                      padding: '10px 14px',
                      background: 'var(--bg)',
                      borderRadius: 12,
                      cursor: 'pointer',
                      border: '1px solid var(--rule)'
                    }}
                  >
                    <div style={{ display: 'flex', flexDirection: 'column' }}>
                      <span style={{ fontFamily: 'monospace', fontWeight: 600, color: 'var(--ink)' }}>{r.id}</span>
                      <span style={{ fontSize: 10, color: 'var(--ink-muted)' }}>
                        Created {r.createdAt && !isNaN(Number(r.createdAt)) ? new Date(Number(r.createdAt)).toLocaleDateString() : 'Unknown'}
                      </span>
                    </div>
                    <button 
                      onClick={(e) => handleDeleteRoom(e, r.id)}
                      style={{ background: 'none', border: 'none', color: 'var(--accent)', fontSize: 18, cursor: 'pointer', padding: 4 }}
                      aria-label="Delete room"
                    >
                      ✕
                    </button>
                  </div>
                ))}
              </div>
            </>
          )}

          {error && <p style={{ color: 'var(--accent)', fontSize: 13, textAlign: 'center', marginTop: 12 }}>{error}</p>}
        </div>
      </div>
    );
  }

  if (step === 'create') {
    return (
      <div className="auth-screen">
        <div className="auth-logo">
          <PetalIcon size={64} color="var(--accent)" />
        </div>
        <p style={{ color: 'var(--ink)', fontFamily: 'Caveat, cursive', fontSize: 22, textAlign: 'center' }}>
          Share this code with your partner
        </p>
        <div className="auth-card" style={{ alignItems: 'center', gap: 20 }}>
          <div className="room-code">{generatedCode}</div>
          <RoomQr code={generatedCode} />
          <button className="btn-ghost" onClick={copyCode} style={{ width: '100%' }}>
            {copied ? '✓ Copied!' : 'Copy code'}
          </button>
          <p style={{ fontSize: 12, color: 'var(--ink-muted)', textAlign: 'center' }}>
            Once your partner joins, your shared notebook will open.
          </p>
        </div>
      </div>
    );
  }

  // Join step
  return (
    <div className="auth-screen">
      <div className="auth-logo">
        <PetalIcon size={64} color="var(--accent)" />
      </div>
      <p style={{ color: 'var(--ink)', fontFamily: 'Caveat, cursive', fontSize: 22, textAlign: 'center' }}>
        Enter your partner's invite code
      </p>
      <div className="auth-card" style={{ gap: 16 }}>
        {showScanner ? (
          <QrScanner onScanned={(c) => { setCode(c); setShowScanner(false); }} onClose={() => setShowScanner(false)} />
        ) : (
          <button className="btn-ghost" onClick={() => setShowScanner(true)} style={{ width: '100%' }}>Scan a QR code instead</button>
        )}
        <input
          className="text-input"
          placeholder="e.g. XKCD42"
          value={code}
          onChange={(e) => setCode(e.target.value.toUpperCase())}
          maxLength={6}
          style={{ textAlign: 'center', fontSize: 24, letterSpacing: 6, fontFamily: 'Caveat, cursive' }}
        />
        <button className="btn-primary" onClick={handleJoin} disabled={loading || code.length < 6} style={{ width: '100%' }}>
          {loading ? 'Joining…' : 'Join room'}
        </button>
        <button className="btn-ghost" onClick={() => setStep('choice')} style={{ width: '100%' }}>
          Back
        </button>
        {error && <p style={{ color: 'var(--accent)', fontSize: 13, textAlign: 'center' }}>{error}</p>}
      </div>
    </div>
  );
}
