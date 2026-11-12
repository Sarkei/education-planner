import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';

export function LoginPage() {
  const { login, register } = useAuth();
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [needsSetup, setNeedsSetup] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void api<{ needsSetup: boolean }>('/auth/config')
      .then((d) => {
        setNeedsSetup(d.needsSetup);
        if (d.needsSetup) setMode('register');
      })
      .catch(() => undefined);
  }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      if (mode === 'login') await login(email.trim(), password);
      else await register(email.trim(), password, name.trim());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Anmeldung fehlgeschlagen.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-full items-center justify-center p-4">
      <div className="card w-full max-w-sm p-6">
        <h1 className="text-xl font-semibold">Education Planner</h1>
        <p className="mt-1 mb-5 text-sm text-muted">
          {needsSetup
            ? 'Erster Start: Das erste Konto wird Administrator.'
            : 'Deine Dokumente, Ordner und Freigaben an einem Ort.'}
        </p>

        <div className="mb-4 flex gap-1 rounded-xl border border-[var(--line)] p-1 text-sm font-semibold">
          {(['login', 'register'] as const).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => setMode(m)}
              className={`flex-1 rounded-lg py-1.5 ${mode === m ? 'bg-[var(--accent-soft)]' : 'text-muted'}`}
            >
              {m === 'login' ? 'Anmelden' : 'Registrieren'}
            </button>
          ))}
        </div>

        <form onSubmit={submit} className="space-y-3">
          {mode === 'register' && (
            <div>
              <label className="label">Name</label>
              <input className="input" value={name} onChange={(e) => setName(e.target.value)} required minLength={2} />
            </div>
          )}
          <div>
            <label className="label">E-Mail</label>
            <input className="input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
          </div>
          <div>
            <label className="label">Passwort</label>
            <input
              className="input"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              minLength={8}
              placeholder="mindestens 8 Zeichen"
            />
          </div>
          {error && <p className="rounded-lg bg-red-500/10 px-3 py-2 text-xs font-medium text-red-600">{error}</p>}
          <button className="btn btn-primary w-full" disabled={busy}>
            {busy ? 'Einen Moment …' : mode === 'login' ? 'Anmelden' : 'Konto anlegen'}
          </button>
        </form>
      </div>
    </div>
  );
}
