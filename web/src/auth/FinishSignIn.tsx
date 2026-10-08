import { isSignInWithEmailLink, signInWithEmailLink } from 'firebase/auth';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { auth } from '../firebase';
import { errorMessage } from '../lib/errors';
import { safeNext } from '../lib/safeNext';
import { EMAIL_KEY } from './SignIn';

type Phase = 'working' | 'need-email' | 'invalid';

function storedEmail(): string | null {
  try {
    return localStorage.getItem(EMAIL_KEY);
  } catch {
    return null;
  }
}

export function FinishSignIn() {
  const [params] = useSearchParams();
  const next = safeNext(params.get('next'));
  const navigate = useNavigate();
  const [phase, setPhase] = useState<Phase>('working');
  const [email, setEmail] = useState('');
  const [error, setError] = useState<string | null>(null);
  const started = useRef(false);

  async function complete(address: string) {
    setPhase('working');
    try {
      await signInWithEmailLink(auth, address, window.location.href);
      try {
        localStorage.removeItem(EMAIL_KEY);
      } catch {
        // ignore
      }
      navigate(next, { replace: true });
    } catch (err) {
      setError(errorMessage(err));
      setPhase('need-email');
    }
  }

  useEffect(() => {
    if (started.current) return; // StrictMode runs effects twice; a link can only be used once.
    started.current = true;
    if (!isSignInWithEmailLink(auth, window.location.href)) {
      setPhase('invalid');
      return;
    }
    const saved = storedEmail();
    if (saved) void complete(saved);
    else setPhase('need-email');
  }, []);

  if (phase === 'invalid') return <p>This sign-in link isn't valid. Go back and request a new one.</p>;
  if (phase === 'working') return <p className="muted">Signing you in…</p>;
  return (
    <form
      onSubmit={(e: FormEvent) => {
        e.preventDefault();
        void complete(email.trim());
      }}
    >
      <h1>Confirm your email</h1>
      <p className="muted">You opened the link on a different device or browser. Enter the email you used.</p>
      <label htmlFor="email">Email</label>
      <input id="email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
      <p>
        <button type="submit">Sign in</button>
      </p>
      {error && <p className="error">{error}</p>}
    </form>
  );
}
