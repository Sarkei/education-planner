import { useCallback, useEffect, useState } from 'react';
import { File as FileIcon, Folder, RotateCcw, Trash2 } from 'lucide-react';
import { api } from '../lib/api';
import { EmptyState, PageHead, Shell } from '../components/Shell';

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
    <Shell tab="trash">
      <div className="scroll-thin h-full overflow-auto p-4">
        <div className="mx-auto max-w-4xl">
          <PageHead eyebrow="Aufbewahrung" title="Papierkorb" hint="Gelöschte Ordner und Dateien bleiben hier, bis du sie endgültig entfernst." />

          {error && <p className="mb-3 rounded-xl bg-[var(--danger)]/10 px-3 py-2 text-xs text-[var(--danger)]">{error}</p>}

          {loading ? (
            <p className="text-sm text-muted">Lädt …</p>
          ) : items.length === 0 ? (
            <EmptyState title="Papierkorb ist leer" hint="Was du löschst, landet zuerst hier — nichts ist sofort weg." />
          ) : (
            <div className="space-y-1.5">
              {items.map((item) => (
                <div key={item.id} className="row-item">
                  {item.kind === 'folder' ? <Folder className="h-[18px] w-[18px] text-[var(--accent)]" /> : <FileIcon className="h-[18px] w-[18px] text-muted" />}
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[13.5px] font-medium">{item.name}</p>
                    <p className="text-[11px] text-muted">gelöscht am {new Date(item.trashedAt).toLocaleDateString('de-DE')}</p>
                  </div>
                  <button className="btn btn-ghost !py-1 text-xs" onClick={() => void restore(item.id)}>
                    <RotateCcw className="h-3.5 w-3.5" /> Zurückholen
                  </button>
                  <button className="btn btn-ghost !py-1 text-xs text-[var(--danger)]" onClick={() => void purge(item.id)}>
                    <Trash2 className="h-3.5 w-3.5" /> Endgültig
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </Shell>
  );
}
