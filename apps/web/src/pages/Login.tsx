import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api, ApiRequestError, sessionStore } from '../lib/api';

const DEMO_ACCOUNTS = [
  { email: 'admin@proofchain.local', role: 'ADMIN', note: 'demo controls, full access' },
  { email: 'researcher@proofchain.local', role: 'RESEARCHER', note: 'register datasets/models' },
  { email: 'developer@proofchain.local', role: 'DEVELOPER', note: 'register software releases' },
  { email: 'auditor@proofchain.local', role: 'AUDITOR', note: 'read + verification review' },
  { email: 'viewer@proofchain.local', role: 'VIEWER', note: 'read-only' },
];

export function Login() {
  const [email, setEmail] = useState('admin@proofchain.local');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const navigate = useNavigate();

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const { token, user } = await api.login(email.trim().toLowerCase(), password);
      sessionStore.set(token, user);
      navigate('/app');
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : 'Login failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', padding: 24 }}>
      <div style={{ width: 'min(880px, 100%)', display: 'grid', gap: 32 }}>
        <div>
          <Link to="/" className="mono-xs dim">← PROOFCHAIN</Link>
          <h1 className="display" style={{ fontSize: 44, marginTop: 12 }}>
            Application <span className="accent">access</span>
          </h1>
          <p className="dim" style={{ maxWidth: 560, marginTop: 10, fontSize: 14 }}>
            Application roles authorize API operations (registering, demo controls). They are
            deliberately separate from blockchain ownership, which belongs to wallet addresses —
            a centralized login can never rewrite on-chain provenance.
          </p>
        </div>

        <div className="grid-2">
          <form className="panel panel-body stack" onSubmit={submit}>
            <div className="field">
              <label htmlFor="email">EMAIL</label>
              <input
                id="email"
                type="email"
                className="mono-input"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                autoComplete="username"
                required
              />
            </div>
            <div className="field">
              <label htmlFor="password">PASSWORD</label>
              <input
                id="password"
                type="password"
                className="mono-input"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="current-password"
                placeholder="proofchain-demo"
                required
              />
              <span className="hint">All seeded demo accounts use the password <span className="mono-xs">proofchain-demo</span>.</span>
            </div>
            {error && <div className="notice err">{error}</div>}
            <button className="btn primary" type="submit" disabled={busy}>
              {busy ? 'SIGNING IN…' : 'SIGN IN'}
            </button>
          </form>

          <div className="panel" style={{ overflow: 'hidden' }}>
            <div className="panel-head">
              <span className="chart-title">SEEDED ROLES</span>
            </div>
            <table className="ledger">
              <tbody>
                {DEMO_ACCOUNTS.map((acc) => (
                  <tr
                    key={acc.email}
                    className="click"
                    onClick={() => setEmail(acc.email)}
                    title="Click to fill the email field"
                  >
                    <td className="mono-xs">{acc.role}</td>
                    <td className="mono-xs dim">{acc.email}</td>
                    <td className="mono-xs faint">{acc.note}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
