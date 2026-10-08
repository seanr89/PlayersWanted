import { GoogleAuthProvider, sendSignInLinkToEmail, signInWithPopup } from 'firebase/auth';
import { useEffect, useState, type FormEvent } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { auth } from '../firebase';
import { errorMessage } from '../lib/errors';
import { safeNext } from '../lib/safeNext';
import { useAuth } from './AuthProvider';

export const EMAIL_KEY = 'pw.emailForSignIn';

export function SignIn() {
  const [params] = useSearchParams();
  const next = safeNext(params.get('next'));
  const { user } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (user) navigate(next, { replace: true });
  }, [user, next, navigate]);

  async function google() {
    setError(null);
    try {
      await signInWithPopup(auth, new GoogleAuthProvider());
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  async function sendLink(e: FormEvent) {
    e.preventDefault();
    setError(null);
    const address = email.trim();
    try {
      await sendSignInLinkToEmail(auth, address, {
        url: `${window.location.origin}/finish-sign-in?next=${encodeURIComponent(next)}`,
        handleCodeInApp: true,
      });
      try {
        localStorage.setItem(EMAIL_KEY, address);
      } catch {
        // Storage can be blocked; FinishSignIn asks for the email again.
      }
      setSent(true);
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  return (
    <section>
      <h1>Sign in</h1>
      <button onClick={google}>Continue with Google</button>
      <p className="muted">or get a sign-in link by email</p>
      {sent ? (
        <p>Check your inbox — we sent a sign-in link to {email.trim()}.</p>
      ) : (
        <form onSubmit={sendLink}>
          <label htmlFor="email">Email</label>
          <input id="email" type="email" required autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} />
          <p>
            <button type="submit">Email me a link</button>
          </p>
        </form>
      )}
      {error && <p className="error">{error}</p>}
    </section>
  );
}
