import { useEffect, useState } from 'react';
import { GraduationCap } from 'lucide-react';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { isDemoMode } from '../lib/demo';

export function LoginPage() {
  const { login, register } = useAuth();
  const demo = isDemoMode();
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
        if (d.needsSetup && !demo) setMode('register');
      })
      .catch(() => undefined);
  }, [demo]);

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
      <div className="w-full max-w-sm">
        <div className="mb-5 flex items-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-2xl border border-[var(--line)] bg-[var(--accent-soft)]">
            <GraduationCap className="h-5 w-5 text-[var(--accent)]" />
          </div>
          <div>
            <p className="serif text-2xl leading-tight">Education Planner</p>
            <p className="text-[12px] text-muted">Unterlagen für die Berufsschule</p>
          </div>
        </div>

        <div className="card p-5">
          <p className="mb-4 text-[13px] text-muted">
            {demo
              ? 'Demo-Modus: Du siehst ein Beispielkonto mit erfundenen Unterlagen.'
              : needsSetup
                ? 'Erster Start: Das erste Konto wird Administrator.'
                : 'Melde dich an, um deine Ordner und Dokumente zu öffnen.'}
          </p>

          {!demo && (
            <div className="pill-nav mb-4 w-full">
              {(['login', 'register'] as const).map((m) => (
                <button
                  key={m}
                  type="button"
                  className={`pill flex-1 justify-center ${mode === m ? 'active' : ''}`}
                  onClick={() => setMode(m)}
                >
                  {m === 'login' ? 'Anmelden' : 'Registrieren'}
                </button>
              ))}
            </div>
          )}

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
            {error && <p className="alert-danger text-xs font-medium">{error}</p>}
            <button className="btn btn-primary w-full" disabled={busy}>
              {busy ? 'Einen Moment …' : mode === 'login' ? 'Anmelden' : 'Konto anlegen'}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
