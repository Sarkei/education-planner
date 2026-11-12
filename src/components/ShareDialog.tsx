import { useEffect, useState } from 'react';
import { Loader2, Trash2, UserPlus } from 'lucide-react';
import { api } from '../lib/api';
import { Modal } from './Modal';
import type { NodeItem, Share } from '../lib/types';

type UserRow = { id: number; name: string; email: string };

/** Ordner oder Datei für andere Nutzer freigeben — Rechte gelten für alles darunter. */
export function ShareDialog({ node, onClose }: { node: NodeItem; onClose: () => void }) {
  const [shares, setShares] = useState<Share[]>([]);
  const [users, setUsers] = useState<UserRow[]>([]);
  const [userId, setUserId] = useState<number | ''>('');
  const [permission, setPermission] = useState<'view' | 'edit'>('edit');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    try {
      const [s, u] = await Promise.all([
        api<{ shares: Share[] }>(`/shares/${node.id}`),
        api<{ users: UserRow[] }>('/shares/users/all'),
      ]);
      setShares(s.shares);
      setUsers(u.users);
      if (u.users.length) setUserId(u.users[0].id);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Freigaben konnten nicht geladen werden.');
    }
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [node.id]);

  async function add() {
    if (!userId) return;
    setBusy(true);
    setError(null);
    try {
      await api(`/shares/${node.id}`, { body: { userId: Number(userId), permission } });
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Freigabe fehlgeschlagen.');
    } finally {
      setBusy(false);
    }
  }

  async function remove(target: number) {
    await api(`/shares/${node.id}/${target}`, { method: 'DELETE' });
    await load();
  }

  const available = users.filter((u) => !shares.some((s) => s.user_id === u.id));

  return (
    <Modal title="Teilen" subtitle={node.name} onClose={onClose}>
      <div className="space-y-3">
        <div className="flex gap-2">
          <select className="input flex-1" value={userId} onChange={(e) => setUserId(e.target.value ? Number(e.target.value) : '')}>
            {available.length === 0 && <option value="">Keine weiteren Nutzer</option>}
            {available.map((u) => (
              <option key={u.id} value={u.id}>
                {u.name} ({u.email})
              </option>
            ))}
          </select>
          <select className="input !w-32" value={permission} onChange={(e) => setPermission(e.target.value as 'view' | 'edit')}>
            <option value="edit">Bearbeiten</option>
            <option value="view">Nur ansehen</option>
          </select>
          <button className="btn btn-primary" onClick={() => void add()} disabled={busy || !userId}>
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <UserPlus className="h-4 w-4" />}
          </button>
        </div>

        <div className="space-y-1">
          {shares.length === 0 && <p className="text-xs text-muted">Noch mit niemandem geteilt.</p>}
          {shares.map((s) => (
            <div key={s.user_id} className="flex items-center justify-between rounded-lg border border-[var(--line)] px-3 py-2 text-sm">
              <span>
                {s.name} <span className="text-muted">· {s.permission === 'edit' ? 'bearbeiten' : 'ansehen'}</span>
              </span>
              <button className="btn btn-ghost !px-2 !py-1" onClick={() => void remove(s.user_id)} aria-label="Freigabe entfernen">
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
          ))}
        </div>

        {node.kind === 'folder' && (
          <p className="text-[11px] text-muted">Die Freigabe gilt für den Ordner und alles, was darin liegt.</p>
        )}
        {error && <p className="rounded-lg bg-red-500/10 px-3 py-2 text-xs text-red-600">{error}</p>}
      </div>
    </Modal>
  );
}
