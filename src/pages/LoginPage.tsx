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
    <div className="flex min-h-screen items-center justify-center px-5 py-12">
      <div className="w-full max-w-[420px]">
        <div className="mb-6 flex flex-col items-center gap-3 text-center">
          <span className="app-brand__mark">
            <GraduationCap className="h-5 w-5" />
          </span>
          <div>
            <p className="font-serif text-xl leading-tight">Education Planner</p>
            <p className="mt-1 text-[11px] uppercase tracking-[0.14em] text-muted">Unterlagen für die Berufsschule</p>
          </div>
        </div>

        <div className="app-card p-6">
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
