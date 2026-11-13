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
      <PageHead
        label="Aufbewahrung"
        title="Papierkorb"
        intro="Gelöschte Ordner und Dateien bleiben hier, bis du sie endgültig entfernst."
      />

      <section className="app-section app-container app-section--tight">
        <div className="app-narrow">
          {error && <p className="alert-danger mb-3 text-xs">{error}</p>}

          {loading ? (
            <p className="text-sm text-muted">Lädt …</p>
          ) : items.length === 0 ? (
            <EmptyState title="Papierkorb ist leer" hint="Was du löschst, landet zuerst hier — nichts ist sofort weg." />
          ) : (
            <div className="app-list">
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
      </section>
    </Shell>
  );
}
