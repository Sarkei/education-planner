import { useCallback, useEffect, useState } from 'react';
import { FileText, Folder, Pencil, Share2 } from 'lucide-react';
import { api } from '../lib/api';
import { navigate } from '../App';
import { EmptyState, PageHead, Shell } from '../components/Shell';

type SharedRow = {
  id: string;
  name: string;
  kind: 'folder' | 'file';
  permission: 'view' | 'edit';
  owner_name: string;
};

/** „Mit mir geteilt" — bestehende Freigaben aus /api/shares. */
export function SharedPage() {
  const [rows, setRows] = useState<SharedRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const data = await api<{ shared: SharedRow[] }>('/shares');
      setRows(data.shared);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Freigaben konnten nicht geladen werden.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  function open(row: SharedRow) {
    if (row.kind === 'folder') navigate(`#/files/${row.id}`);
    else navigate(`#/edit/${row.id}`);
  }

  return (
    <Shell tab="shared">
      <PageHead
        label="Freigaben"
        title="Mit mir geteilt"
        intro="Ordner und Dateien, die andere für dich freigegeben haben — je nach Recht zum Ansehen oder Mitbearbeiten."
      />

      <section className="app-section app-container app-section--tight">
        {error ? <p className="alert-danger mb-4 text-xs">{error}</p> : null}

        {loading ? (
          <p className="text-sm text-muted">Lädt …</p>
        ) : rows.length === 0 ? (
          <EmptyState
            title="Noch nichts geteilt"
            hint="Sobald jemand einen Ordner oder eine Datei für dich freigibt, erscheint sie hier."
            action={
              <button className="btn mt-2" onClick={() => navigate('#/files')}>
                <Share2 className="h-4 w-4" /> Zu den eigenen Dateien
              </button>
            }
          />
        ) : (
          <div className="app-list">
            {rows.map((row) => (
              <button key={`${row.id}-${row.owner_name}`} className="app-row" onClick={() => open(row)}>
                {row.kind === 'folder' ? (
                  <Folder className="h-[18px] w-[18px] shrink-0 text-accent" />
                ) : (
                  <FileText className="h-[18px] w-[18px] shrink-0 text-muted" />
                )}
                <span className="app-row__main">
                  <span className="app-row__name">{row.name}</span>
                  <span className="app-row__meta">
                    von {row.owner_name} · {row.kind === 'folder' ? 'Ordner' : 'Datei'}
                  </span>
                </span>
                <span className="badge badge-accent shrink-0">
                  <Pencil className="h-3 w-3" /> {row.permission === 'edit' ? 'bearbeitbar' : 'nur ansehen'}
                </span>
              </button>
            ))}
          </div>
        )}
      </section>
    </Shell>
  );
}
