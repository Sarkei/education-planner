import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ArrowRight,
  FileText,
  Folder,
  FolderTree,
  Search,
  Share2,
  Trash2,
  Users,
} from 'lucide-react';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { navigate } from '../App';
import { Tree } from '../components/Tree';
import { Band, PageHead, Shell, StatRow } from '../components/Shell';
import type { NodeItem } from '../lib/types';

type SharedRow = { id: string; name: string; kind: 'folder' | 'file'; permission: 'view' | 'edit'; owner_name: string };
type TrashRow = { id: string; name: string; kind: 'folder' | 'file'; trashedAt: string };

function formatDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

/** Startseite: Übersicht mit Kennzahlen, Bereichen und dem Dateibaum. */
export function OverviewPage() {
  const { user } = useAuth();
  const [nodes, setNodes] = useState<NodeItem[]>([]);
  const [shared, setShared] = useState<SharedRow[]>([]);
  const [trash, setTrash] = useState<TrashRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const load = useCallback(async () => {
    const [tree, shares, bin] = await Promise.allSettled([
      api<{ nodes: NodeItem[] }>('/nodes/tree'),
      api<{ shared: SharedRow[] }>('/shares'),
      api<{ nodes: TrashRow[] }>('/nodes/trash/list'),
    ]);
    if (tree.status === 'fulfilled') setNodes(tree.value.nodes);
    else setError(tree.reason instanceof Error ? tree.reason.message : 'Übersicht konnte nicht geladen werden.');
    setShared(shares.status === 'fulfilled' ? shares.value.shared : []);
    setTrash(bin.status === 'fulfilled' ? bin.value.nodes : []);
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const stats = useMemo(() => {
    const files = nodes.filter((node) => node.kind === 'file').length;
    const folders = nodes.filter((node) => node.kind === 'folder').length;
    return [
      { value: loading ? '—' : String(files), label: 'Dateien' },
      { value: loading ? '—' : String(folders), label: 'Ordner' },
      { value: loading ? '—' : String(shared.length), label: 'Freigaben' },
      { value: loading ? '—' : String(trash.length), label: 'Im Papierkorb' },
    ];
  }, [nodes, shared, trash, loading]);

  const sharedRoots = useMemo(() => nodes.filter((node) => node.shared), [nodes]);
  const ownRoots = useMemo(() => nodes.filter((node) => !node.shared), [nodes]);
  const recent = useMemo(
    () =>
      [...nodes]
        .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
        .slice(0, 5),
    [nodes],
  );

  function openNode(node: NodeItem) {
    if (node.kind === 'folder') navigate(`#/files/${node.id}`);
    else navigate(`#/edit/${node.id}`);
  }

  const areas = [
    {
      id: 'files',
      title: 'Dateien',
      text: 'Ordner und Unterlagen durchsehen, anlegen, hochladen und teilen.',
      meta: loading ? 'wird geladen' : `${nodes.length} Einträge`,
      icon: <FolderTree className="h-5 w-5" />,
      go: () => navigate('#/files'),
    },
    {
      id: 'shared',
      title: 'Freigaben',
      text: 'Alles, was andere für dich freigegeben haben — lesen oder mitbearbeiten.',
      meta: loading ? 'wird geladen' : `${shared.length} Freigaben`,
      icon: <Share2 className="h-5 w-5" />,
      go: () => navigate('#/shared'),
    },
    {
      id: 'search',
      title: 'Suche',
      text: 'Dateinamen und Volltext in Word, Excel, PowerPoint, PDF und Text durchsuchen.',
      meta: 'Volltext',
      icon: <Search className="h-5 w-5" />,
      go: () => navigate('#/search'),
    },
    {
      id: 'trash',
      title: 'Papierkorb',
      text: 'Gelöschtes zurückholen oder endgültig entfernen. Nichts ist sofort weg.',
      meta: loading ? 'wird geladen' : `${trash.length} Einträge`,
      icon: <Trash2 className="h-5 w-5" />,
      go: () => navigate('#/trash'),
    },
    ...(user?.role === 'admin'
      ? [
          {
            id: 'users',
            title: 'Nutzer',
            text: 'Konten anlegen und verwalten. Jeder sieht eigene Dateien plus Freigaben.',
            meta: 'Nur Administration',
            icon: <Users className="h-5 w-5" />,
            go: () => navigate('#/users'),
          },
        ]
      : []),
  ];

  return (
    <Shell tab="overview">
      <PageHead
        label="Übersicht"
        title="Deine Unterlagen an einem Ort"
        intro="Ordner, Dokumente und Freigaben für den Berufsschulunterricht — angelegt, bearbeitet und geteilt an einer Stelle."
        action={
          <button className="btn btn-primary" onClick={() => navigate('#/files')}>
            Zu den Dateien <ArrowRight className="h-4 w-4" />
          </button>
        }
      >
        <StatRow items={stats} />
      </PageHead>

      <section className="app-section app-container">
        <div className="app-section__head">
          <h2 className="app-section__title">Bereiche</h2>
          <p className="app-section__note">Alles, was die App kann — je Bereich eine eigene Ansicht.</p>
        </div>

        <div className="app-grid app-grid--three">
          {areas.map((area) => (
            <button key={area.id} className="app-card app-card--link" onClick={area.go}>
              <span className="app-card__head">
                <span className="text-accent">{area.icon}</span>
                <ArrowRight className="app-card__arrow h-4 w-4" />
              </span>
              <span className="app-card__title">{area.title}</span>
              <span className="app-card__text">{area.text}</span>
              <span className="app-card__meta">{area.meta}</span>
            </button>
          ))}
        </div>
      </section>

      <section className="app-section app-container app-section--tight">
        <div className="app-section__head">
          <h2 className="app-section__title">Dateibaum</h2>
          <a className="app-section__note underline-offset-4 hover:underline" href="#/files">
            Alle Dateien öffnen
          </a>
        </div>

        <div className="app-card" style={{ marginTop: 24, padding: 16 }}>
          {loading ? (
            <p className="text-sm text-muted">Lädt …</p>
          ) : ownRoots.length === 0 ? (
            <p className="text-sm text-muted">
              Noch keine Ordner. Leg im Bereich Dateien den ersten an oder lade eine Datei hoch.
            </p>
          ) : (
            <div className="app-tree-scroll">
              <Tree
                nodes={ownRoots}
                selectedId={null}
                onSelect={openNode}
                onDrop={() => undefined}
                expanded={expanded}
                toggle={(id) =>
                  setExpanded((prev) => {
                    const next = new Set(prev);
                    if (next.has(id)) next.delete(id);
                    else next.add(id);
                    return next;
                  })
                }
              />
            </div>
          )}

          {sharedRoots.length > 0 ? (
            <div style={{ marginTop: 16 }}>
              <p className="app-label" style={{ marginBottom: 6 }}>
                Mit mir geteilt
              </p>
              <Tree
                nodes={sharedRoots}
                selectedId={null}
                onSelect={(node) => openNode(node)}
                onDrop={() => undefined}
                expanded={expanded}
                toggle={(id) =>
                  setExpanded((prev) => {
                    const next = new Set(prev);
                    if (next.has(id)) next.delete(id);
                    else next.add(id);
                    return next;
                  })
                }
              />
            </div>
          ) : null}
        </div>
      </section>

      <Band title="Zuletzt geändert" note="Die jüngsten Änderungen aus deinem Bestand">
        {loading ? (
          <p className="mt-8 text-sm text-muted">Lädt …</p>
        ) : recent.length === 0 ? (
          <p className="mt-8 text-sm text-muted">Sobald du etwas anlegst oder bearbeitest, erscheint es hier.</p>
        ) : (
          <div className="app-list mt-8">
            {recent.map((node) => (
              <button key={node.id} className="app-row" onClick={() => openNode(node)}>
                {node.kind === 'folder' ? (
                  <Folder className="h-[18px] w-[18px] shrink-0 text-accent" />
                ) : (
                  <FileText className="h-[18px] w-[18px] shrink-0 text-muted" />
                )}
                <span className="app-row__main">
                  <span className="app-row__name">{node.name}</span>
                  <span className="app-row__meta">
                    {node.kind === 'folder' ? 'Ordner' : 'Datei'} · geändert am {formatDate(node.updatedAt)}
                  </span>
                </span>
                <ArrowRight className="h-4 w-4 shrink-0 text-muted" />
              </button>
            ))}
          </div>
        )}
      </Band>

      {error ? (
        <section className="app-container" style={{ paddingBottom: 32 }}>
          <p className="alert-danger text-xs">{error}</p>
        </section>
      ) : null}
    </Shell>
  );
}
