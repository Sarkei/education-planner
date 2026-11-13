import { useCallback, useEffect, useState } from 'react';
import { Loader2, Trash2, UserPlus } from 'lucide-react';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { PageHead, Shell } from '../components/Shell';

type UserRow = { id: number; email: string; name: string; role: string; created_at: string };

export function AdminPage() {
  const { user } = useAuth();
  const [users, setUsers] = useState<UserRow[]>([]);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState<'user' | 'admin'>('user');
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const data = await api<{ users: UserRow[] }>('/auth/users');
      setUsers(data.users);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Nutzer konnten nicht geladen werden.');
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function create() {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await api('/auth/users', { body: { name: name.trim(), email: email.trim(), password, role } });
      setNotice(`Konto für ${name.trim()} angelegt.`);
      setName('');
      setEmail('');
      setPassword('');
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Konto konnte nicht angelegt werden.');
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: number) {
    if (!confirm('Konto wirklich löschen? Die Dateien des Kontos werden mit entfernt.')) return;
    await api(`/auth/users/${id}`, { method: 'DELETE' });
    await load();
  }

  if (user?.role !== 'admin') {
    return (
      <Shell tab="users">
        <section className="app-section app-container">
          <p className="text-sm text-muted">Nur für Administratoren.</p>
        </section>
      </Shell>
    );
  }

  return (
    <Shell tab="users">
      <PageHead
        label="Zugänge"
        title="Nutzer"
        intro="Jeder bekommt ein eigenes Konto und sieht nur eigene Dateien plus Freigaben."
      />

      <section className="app-section app-container app-section--tight">
        <div className="app-narrow-wide">
          <div className="grid gap-4 lg:grid-cols-[1fr_360px] lg:items-start">
            <div className="app-list">
              {users.map((u) => (
                <div key={u.id} className="row-item">
                  <div className="flex h-8 w-8 items-center justify-center rounded-full bg-[var(--accent-soft)] text-xs font-semibold text-[var(--accent)]">
                    {u.name.slice(0, 2).toUpperCase()}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[13.5px] font-medium">{u.name}</p>
                    <p className="truncate text-[11px] text-muted">{u.email}</p>
                  </div>
                  <span className="badge">{u.role === 'admin' ? 'Administrator' : 'Nutzer'}</span>
                  {u.id !== user?.id && (
                    <button className="btn btn-ghost !py-1 text-xs text-[var(--danger)]" onClick={() => void remove(u.id)}>
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  )}
                </div>
              ))}
            </div>

            <div className="card space-y-3 p-4">
              <p className="label !mb-0">Neues Konto</p>
              <div>
                <label className="label">Name</label>
                <input className="input" value={name} onChange={(e) => setName(e.target.value)} />
              </div>
              <div>
                <label className="label">E-Mail</label>
                <input className="input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
              </div>
              <div>
                <label className="label">Startpasswort</label>
                <input className="input" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="mindestens 8 Zeichen" />
              </div>
              <div>
                <label className="label">Rolle</label>
                <select className="input" value={role} onChange={(e) => setRole(e.target.value as 'user' | 'admin')}>
                  <option value="user">Nutzer</option>
                  <option value="admin">Administrator</option>
                </select>
              </div>
              {error && <p className="alert-danger text-xs">{error}</p>}
              {notice && <p className="rounded-lg bg-[var(--accent-soft)] px-3 py-2 text-xs">{notice}</p>}
              <button
                className="btn btn-primary w-full"
                onClick={() => void create()}
                disabled={busy || !name.trim() || !email.trim() || password.length < 8}
              >
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <UserPlus className="h-4 w-4" />} Konto anlegen
              </button>
              <p className="text-[11px] text-muted">Das Startpasswort gibst du selbst weiter; jeder kann es später ändern.</p>
            </div>
          </div>
        </div>
      </section>
    </Shell>
  );
}
