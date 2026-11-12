import { useCallback, useEffect, useState } from 'react';
import { ArrowLeft, Folder, RotateCcw, Trash2 } from 'lucide-react';
import { api } from '../lib/api';
import { navigate } from '../App';

type TrashNode = { id: string; name: string; kind: 'folder' | 'file'; trashedAt: string; size: number };

export function TrashPage() {
  const [items, setItems] = useState<TrashNode[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const data = await api<{ nodes: TrashNode[] }>('/nodes/trash/list');
      setItems(data.nodes);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Papierkorb konnte nicht geladen werden.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function restore(id: string) {
    await api(`/nodes/${id}/restore`, { method: 'POST', body: {} });
    await load();
  }

  async function purge(id: string) {
    if (!confirm('Endgültig löschen? Das lässt sich nicht rückgängig machen.')) return;
    await api(`/nodes/${id}/purge`, { method: 'DELETE' });
    await load();
  }

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center gap-2 border-b border-[var(--line)] px-4 py-2.5">
        <button className="btn btn-ghost !px-2 !py-1.5" onClick={() => navigate('#/files')}>
          <ArrowLeft className="h-4 w-4" />
        </button>
        <span className="text-sm font-semibold">Papierkorb</span>
      </header>
      <div className="flex-1 overflow-auto p-4">
        {error && <p className="mb-3 rounded-lg bg-red-500/10 px-3 py-2 text-xs text-red-600">{error}</p>}
        {loading ? (
          <p className="text-sm text-muted">Lädt …</p>
        ) : items.length === 0 ? (
          <div className="card px-6 py-14 text-center text-sm text-muted">Der Papierkorb ist leer.</div>
        ) : (
          <div className="space-y-2">
            {items.map((item) => (
              <div key={item.id} className="card flex items-center gap-3 p-3">
                <Folder className="h-4 w-4 text-muted" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{item.name}</p>
                  <p className="text-[11px] text-muted">gelöscht am {new Date(item.trashedAt).toLocaleDateString('de-DE')}</p>
                </div>
                <button className="btn btn-ghost !py-1 text-xs" onClick={() => void restore(item.id)}>
                  <RotateCcw className="h-3.5 w-3.5" /> Zurückholen
                </button>
                <button className="btn btn-ghost !py-1 text-xs text-red-600" onClick={() => void purge(item.id)}>
                  <Trash2 className="h-3.5 w-3.5" /> Endgültig
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
