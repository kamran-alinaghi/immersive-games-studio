import { useEffect, useState, type FormEvent } from 'react';
import {
  onAuthStateChanged,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  signOut,
  type User,
} from 'firebase/auth';
import { doc, getDoc } from 'firebase/firestore';
import { ArrowLeft, LogOut, ShieldCheck } from 'lucide-react';
import { auth, db } from './firebase';

type PlayerProfile = {
  fullName?: string;
  email?: string;
  playerId?: string;
  status?: string;
};

function PlayerPortal() {
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<PlayerProfile | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [profileLoading, setProfileLoading] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => onAuthStateChanged(auth, current => {
    setUser(current);
    setAuthReady(true);
  }), []);

  useEffect(() => {
    if (!user) {
      setProfile(null);
      return;
    }
    let active = true;
    setProfileLoading(true);
    getDoc(doc(db, 'players', user.uid))
      .then(snapshot => {
        if (active) setProfile(snapshot.exists() ? snapshot.data() as PlayerProfile : null);
      })
      .catch(() => {
        if (active) setError('We could not load your player profile. Please try again.');
      })
      .finally(() => {
        if (active) setProfileLoading(false);
      });
    return () => { active = false; };
  }, [user]);

  const login = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError('');
    setMessage('');
    try {
      await signInWithEmailAndPassword(auth, email.trim(), password);
      setPassword('');
    } catch {
      setError('Sign-in failed. Check your email and password, or use the password reset option.');
    } finally {
      setBusy(false);
    }
  };

  const resetPassword = async () => {
    if (!email.trim()) {
      setError('Enter your email address first.');
      return;
    }
    setBusy(true);
    setError('');
    setMessage('');
    try {
      await sendPasswordResetEmail(auth, email.trim(), {
        url: 'https://immersive-games.com/#/player',
      });
      setMessage('If an account exists for that email, a password reset link will be sent.');
    } catch {
      setError('We could not send a password reset email. Please check the address and try again.');
    } finally {
      setBusy(false);
    }
  };

  if (!authReady) return <main className="admin-page"><p>Checking session…</p></main>;

  if (!user) return (
    <main className="admin-page">
      <section className="admin-login">
        <a className="admin-back" href="#top"><ArrowLeft size={15} /> Public website</a>
        <div className="admin-mark"><ShieldCheck size={25} /></div>
        <p className="admin-eyebrow">IMMERSIVE GAMES STUDIO</p>
        <h1>Player portal</h1>
        <p className="admin-muted">Sign in to access your personal player space.</p>
        <form onSubmit={login}>
          <label>Email<input type="email" autoComplete="username" required value={email} onChange={event => setEmail(event.target.value)} /></label>
          <label>Password<input type="password" autoComplete="current-password" required value={password} onChange={event => setPassword(event.target.value)} /></label>
          {error && <p className="admin-error" role="alert">{error}</p>}
          {message && <p className="admin-success" role="status">{message}</p>}
          <button className="admin-primary" type="submit" disabled={busy}>{busy ? 'Please wait…' : 'Sign in'}</button>
        </form>
        <button className="admin-link" type="button" onClick={() => void resetPassword()} disabled={busy}>Forgot your password?</button>
      </section>
    </main>
  );

  return (
    <main className="admin-page">
      <header className="admin-header">
        <a href="#top" className="admin-brand">IMMERSIVE GAMES <em>STUDIO</em></a>
        <div><span>{user.email}</span><button className="admin-quiet" onClick={() => void signOut(auth)}><LogOut size={15} /> Sign out</button></div>
      </header>
      <section className="admin-content">
        <div className="admin-heading">
          <div><p className="admin-eyebrow">PLAYER PORTAL</p><h1>Welcome{profile?.fullName ? `, ${profile.fullName.split(' ')[0]}` : ''}</h1><p className="admin-muted">Your personal space for the next steps in the experience.</p></div>
        </div>
        {profileLoading && <p className="admin-muted">Loading your player profile…</p>}
        {!profileLoading && profile && (
          <div className="admin-player-id">
            <strong>Your Player ID</strong>
            <p>{profile.playerId || '—'}</p>
            <small>Please keep this ID safe. It will be used to identify you throughout the process.</small>
          </div>
        )}
        {!profileLoading && !profile && <p className="admin-error" role="alert">We could not find a player profile linked to this account. Please contact Immersive Games Studio.</p>}
        <p className="admin-muted">Further information and instructions will be shared with you as the process moves forward.</p>
      </section>
    </main>
  );
}

export default PlayerPortal;
