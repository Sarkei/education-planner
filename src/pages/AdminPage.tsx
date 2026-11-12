import { useCallback, useEffect, useState } from 'react';
import { ArrowLeft, Trash2, UserPlus } from 'lucide-react';
import { api } from '../lib/api';
import { navigate } from '../App';
import { useAuth } from '../lib/auth';

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
    setError(null);
    try {
      await api('/auth/users', { body: { name: name.trim(), email: email.trim(), password, role } });
      setNotice(`Konto für ${name.trim()} angelegt.`);
      setName('');
      setEmail('');
      setPassword('');
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Konto konnte nicht angelegt werden.');
    }
  }

  async function remove(id: number) {
    if (!confirm('Konto wirklich löschen? Die Dateien des Kontos werden mit entfernt.')) return;
    await api(`/auth/users/${id}`, { method: 'DELETE' });
    await load();
  }

  if (user?.role !== 'admin') {
    return <p className="p-6 text-sm text-muted">Nur für Administratoren.</p>;
  }

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center gap-2 border-b border-[var(--line)] px-4 py-2.5">
        <button className="btn btn-ghost !px-2 !py-1.5" onClick={() => navigate('#/files')}>
          <ArrowLeft className="h-4 w-4" />
        </button>
        <span className="text-sm font-semibold">Nutzer</span>
      </header>
      <div className="grid flex-1 gap-4 overflow-auto p-4 lg:grid-cols-[1fr_360px] lg:items-start">
        <div className="space-y-2">
          {users.map((u) => (
            <div key={u.id} className="card flex items-center gap-3 p-3">
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{u.name}</p>
                <p className="truncate text-[11px] text-muted">
                  {u.email} · {u.role === 'admin' ? 'Administrator' : 'Nutzer'}
                </p>
              </div>
              {u.id !== user?.id && (
                <button className="btn btn-ghost !py-1 text-xs text-red-600" onClick={() => void remove(u.id)}>
                  <Trash2 className="h-3.5 w-3.5" /> Löschen
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
          {error && <p className="rounded-lg bg-red-500/10 px-3 py-2 text-xs text-red-600">{error}</p>}
          {notice && <p className="rounded-lg bg-[var(--accent-soft)] px-3 py-2 text-xs">{notice}</p>}
          <button className="btn btn-primary w-full" onClick={() => void create()} disabled={!name.trim() || !email.trim() || password.length < 8}>
            <UserPlus className="h-4 w-4" /> Konto anlegen
          </button>
          <p className="text-[11px] text-muted">Das Startpasswort gibst du selbst weiter; jeder kann es später ändern.</p>
        </div>
      </div>
    </div>
  );
}
