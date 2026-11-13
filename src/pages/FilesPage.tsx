import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Archive,
  ArrowLeft,
  ChevronRight,
  ClipboardPaste,
  Copy,
  CopyPlus,
  Download,
  ExternalLink,
  File as FileIcon,
  FilePlus,
  FileSpreadsheet,
  FileText,
  Folder,
  FolderPlus,
  Image as ImageIcon,
  LayoutGrid,
  List,
  Pencil,
  Music,
  Presentation,
  Scissors,
  Share2,
  Trash2,
  Upload,
  Video,
} from 'lucide-react';
import { api, getToken } from '../lib/api';
import { navigate } from '../App';
import { Tree } from '../components/Tree';
import { Modal } from '../components/Modal';
import { ShareDialog } from '../components/ShareDialog';
import { EmptyState, PageHead, Shell } from '../components/Shell';
import { ContextMenu, type MenuEntry } from '../components/ContextMenu';
import { CreateFileDialog } from '../components/CreateFileDialog';
import type { NodeItem } from '../lib/types';

const CHUNK = 8 * 1024 * 1024;

function iconFor(node: NodeItem) {
  if (node.kind === 'folder') return <Folder className="h-[18px] w-[18px] text-[var(--accent)]" />;
  const ext = node.name.split('.').pop()?.toLowerCase() ?? '';
  if (['docx', 'doc', 'odt', 'rtf', 'txt', 'md'].includes(ext)) return <FileText className="h-[18px] w-[18px] text-muted" />;
  if (['xlsx', 'xls', 'ods', 'csv'].includes(ext)) return <FileSpreadsheet className="h-[18px] w-[18px] text-muted" />;
  if (['pptx', 'ppt', 'odp'].includes(ext)) return <Presentation className="h-[18px] w-[18px] text-muted" />;
  if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg', 'ico', 'avif', 'tif', 'tiff'].includes(ext))
    return <ImageIcon className="h-[18px] w-[18px] text-muted" />;
  if (['mp3', 'wav', 'ogg', 'oga', 'm4a', 'flac', 'aac'].includes(ext)) return <Music className="h-[18px] w-[18px] text-muted" />;
  if (['mp4', 'webm', 'mov', 'm4v', 'mkv'].includes(ext)) return <Video className="h-[18px] w-[18px] text-muted" />;
  if (['zip', 'rar', '7z', 'tar', 'gz'].includes(ext)) return <Archive className="h-[18px] w-[18px] text-muted" />;
  return <FileIcon className="h-[18px] w-[18px] text-muted" />;
}

function formatSize(bytes: number): string {
  if (!bytes) return '—';
  const units = ['B', 'KB', 'MB', 'GB'];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }
  return `${value.toFixed(value < 10 && unit > 0 ? 1 : 0)} ${units[unit]}`;
}

export function FilesPage() {
  const [nodes, setNodes] = useState<NodeItem[]>([]);
  const [selectedFolder, setSelectedFolder] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [newFolderOpen, setNewFolderOpen] = useState(false);
  const [folderName, setFolderName] = useState('');
  const [shareNode, setShareNode] = useState<NodeItem | null>(null);
  const [renaming, setRenaming] = useState<NodeItem | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [uploads, setUploads] = useState<Array<{ name: string; percent: number }>>([]);
  const [dragging, setDragging] = useState(false);
  const [dropTarget, setDropTarget] = useState<string | null>(null);
  const [menu, setMenu] = useState<{ x: number; y: number; node: NodeItem | null } | null>(null);
  const [clipboard, setClipboard] = useState<{ mode: 'copy' | 'cut'; node: NodeItem } | null>(null);
  const [fileDialog, setFileDialog] = useState<{ parentId: string | null; parentName: string } | null>(null);
  const [view, setView] = useState<'list' | 'grid'>(() => (localStorage.getItem('eduplanner.view') as 'list' | 'grid') || 'list');
  const [thumbs, setThumbs] = useState<Record<string, string>>({});
  const fileInput = useRef<HTMLInputElement | null>(null);

  const load = useCallback(async () => {
    try {
      const data = await api<{ nodes: NodeItem[] }>('/nodes/tree');
      setNodes(data.nodes);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Liste konnte nicht geladen werden.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // Tastaturkürzel wie im Explorer
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      const target = event.target as HTMLElement;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) return;
      if (!(event.ctrlKey || event.metaKey)) return;
      if (event.key === 'v' && clipboard) {
        event.preventDefault();
        void paste();
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clipboard, selectedFolder]);

  const children = useMemo(() => {
    const list = nodes.filter((n) => (n.parentId ?? null) === selectedFolder);
    return list.sort((a, b) => (a.kind === b.kind ? a.name.localeCompare(b.name, 'de') : a.kind === 'folder' ? -1 : 1));
  }, [nodes, selectedFolder]);

  const breadcrumb = useMemo(() => {
    const path: NodeItem[] = [];
    let current = nodes.find((n) => n.id === selectedFolder) ?? null;
    while (current) {
      path.unshift(current);
      current = nodes.find((n) => n.id === current?.parentId) ?? null;
    }
    return path;
  }, [nodes, selectedFolder]);

  function toggle(id: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function moveNode(dragId: string, targetId: string | null) {
    try {
      await api(`/nodes/${dragId}`, { method: 'PATCH', body: { parentId: targetId } });
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Verschieben fehlgeschlagen.');
    }
  }

  async function createFolder() {
    const name = folderName.trim();
    if (!name) return;
    try {
      await api('/nodes/folder', { body: { parentId: selectedFolder, name } });
      setNewFolderOpen(false);
      setFolderName('');
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Ordner konnte nicht angelegt werden.');
    }
  }

  async function rename() {
    if (!renaming) return;
    try {
      await api(`/nodes/${renaming.id}`, { method: 'PATCH', body: { name: renameValue.trim() } });
      setRenaming(null);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Umbenennen fehlgeschlagen.');
    }
  }

  async function remove(node: NodeItem) {
    if (!confirm(`„${node.name}" in den Papierkorb legen?`)) return;
    try {
      await api(`/nodes/${node.id}`, { method: 'DELETE' });
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Löschen fehlgeschlagen.');
    }
  }

  function open(node: NodeItem) {
    if (node.kind === 'folder') {
      setSelectedFolder(node.id);
      setExpanded((prev) => new Set(prev).add(node.id));
      return;
    }
    navigate(`#/edit/${node.id}`);
  }

  /** Upload in Teilen — so passen auch große Dateien durch den Tunnel. */
  async function uploadFiles(files: FileList | File[]) {
    for (const file of Array.from(files)) {
      setUploads((prev) => [...prev, { name: file.name, percent: 0 }]);
      try {
        const init = await api<{ uploadId: string }>('/uploads/init', {
          body: { parentId: selectedFolder, name: file.name, size: file.size, mime: file.type || undefined },
        });
        const total = Math.max(1, Math.ceil(file.size / CHUNK));
        for (let index = 0; index < total; index++) {
          const slice = file.slice(index * CHUNK, Math.min(file.size, (index + 1) * CHUNK));
          const buffer = await slice.arrayBuffer();
          await api(`/uploads/${init.uploadId}/${index}`, { method: 'PUT', raw: buffer });
          setUploads((prev) =>
            prev.map((u) => (u.name === file.name ? { ...u, percent: Math.round(((index + 1) / total) * 95) } : u)),
          );
        }
        await api(`/uploads/${init.uploadId}/complete`, { method: 'POST', body: {} });
        setUploads((prev) => prev.map((u) => (u.name === file.name ? { ...u, percent: 100 } : u)));
      } catch (e) {
        setError(e instanceof Error ? `${file.name}: ${e.message}` : 'Upload fehlgeschlagen.');
      }
    }
    setTimeout(() => setUploads([]), 1200);
    await load();
  }

  async function download(node: NodeItem) {
    const token = getToken();
    const res = await fetch(`/api/nodes/${node.id}/download`, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
    if (!res.ok) {
      setError('Download fehlgeschlagen.');
      return;
    }
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = node.kind === 'folder' ? `${node.name}.zip` : node.name;
    a.click();
    URL.revokeObjectURL(url);
  }

  /** Einfügen: kopieren legt eine Kopie an, ausschneiden verschiebt. */
  async function paste() {
    if (!clipboard) return;
    const target = selectedFolder;
    try {
      if (clipboard.mode === 'copy') {
        await api(`/nodes/${clipboard.node.id}/copy`, { body: { parentId: target } });
      } else {
        await api(`/nodes/${clipboard.node.id}`, { method: 'PATCH', body: { parentId: target } });
      }
      setClipboard(null);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Einfügen fehlgeschlagen.');
    }
  }

  /** Rechtsklick-Menü passend zum Ziel (Knoten oder leerer Bereich). */
  function menuEntries(node: NodeItem | null): MenuEntry[] {
    const entries: MenuEntry[] = [];
    entries.push({ kind: 'item', label: 'Neuer Ordner', icon: <FolderPlus className="h-3.5 w-3.5" />, onClick: () => setNewFolderOpen(true) });
    entries.push({
      kind: 'item',
      label: 'Neue Datei',
      icon: <FilePlus className="h-3.5 w-3.5" />,
      onClick: () => setFileDialog({ parentId: node && node.kind === 'folder' ? node.id : null, parentName: node?.name ?? currentTitle }),
    });
    entries.push({ kind: 'separator' });
    entries.push({
      kind: 'item',
      label: 'Einfügen',
      icon: <ClipboardPaste className="h-3.5 w-3.5" />,
      shortcut: 'Strg+V',
      disabled: !clipboard,
      onClick: () => void paste(),
    });
    if (!node) return entries;

    entries.push({ kind: 'separator' });
    entries.push({ kind: 'item', label: node.kind === 'folder' ? 'Öffnen' : 'Bearbeiten', icon: <ExternalLink className="h-3.5 w-3.5" />, onClick: () => open(node) });
    entries.push({
      kind: 'item',
      label: 'Umbenennen',
      icon: <Pencil className="h-3.5 w-3.5" />,
      onClick: () => {
        setRenaming(node);
        setRenameValue(node.name);
      },
    });
    entries.push({ kind: 'separator' });
    entries.push({ kind: 'item', label: 'Kopieren', icon: <Copy className="h-3.5 w-3.5" />, shortcut: 'Strg+C', onClick: () => setClipboard({ mode: 'copy', node }) });
    entries.push({ kind: 'item', label: 'Ausschneiden', icon: <Scissors className="h-3.5 w-3.5" />, shortcut: 'Strg+X', onClick: () => setClipboard({ mode: 'cut', node }) });
    entries.push({
      kind: 'item',
      label: 'Duplizieren',
      icon: <CopyPlus className="h-3.5 w-3.5" />,
      onClick: async () => {
        try {
          await api(`/nodes/${node.id}/copy`, { body: { parentId: node.parentId ?? null } });
          await load();
        } catch (e) {
          setError(e instanceof Error ? e.message : 'Duplizieren fehlgeschlagen.');
        }
      },
    });
    entries.push({ kind: 'separator' });
    entries.push({ kind: 'item', label: 'Teilen', icon: <Share2 className="h-3.5 w-3.5" />, onClick: () => setShareNode(node) });
    entries.push({ kind: 'item', label: 'Herunterladen', icon: <Download className="h-3.5 w-3.5" />, onClick: () => void download(node) });
    entries.push({ kind: 'separator' });
    entries.push({ kind: 'item', label: 'In den Papierkorb', icon: <Trash2 className="h-3.5 w-3.5" />, danger: true, onClick: () => void remove(node) });
    return entries;
  }

  // In der Galerie: Vorschau-Links für alle Bilder des Ordners in einem Aufruf
  useEffect(() => {
    if (view !== 'grid') return;
    const images = children.filter((n) => n.kind === 'file' && /^(png|jpe?g|gif|webp|bmp|svg|avif|tiff?|ico)$/i.test(n.name.split('.').pop() ?? ''));
    if (!images.length) {
      setThumbs({});
      return;
    }
    let cancelled = false;
    void api<{ urls: Record<string, string> }>('/nodes/preview-tokens', { body: { ids: images.map((i) => i.id) } })
      .then((data) => {
        if (!cancelled) setThumbs(data.urls);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [view, children]);

  function switchView(next: 'list' | 'grid') {
    setView(next);
    localStorage.setItem('eduplanner.view', next);
  }

  const sharedRoots = nodes.filter((n) => n.shared);
  const currentTitle = breadcrumb.length ? breadcrumb[breadcrumb.length - 1].name : 'Alle Dateien';

  return (
    <Shell tab="files">
      <div className="flex h-full">
        <aside className="hidden w-72 shrink-0 flex-col border-r border-[var(--line)] p-3 md:flex">
          <div className="mb-1.5 flex gap-1.5">
            <button className="btn btn-ghost min-w-0 flex-1 !px-3 !py-1.5 text-xs" onClick={() => setNewFolderOpen(true)}>
              <FolderPlus className="h-3.5 w-3.5" /> Ordner
            </button>
            <button
              className="btn btn-ghost min-w-0 flex-1 !px-3 !py-1.5 text-xs"
              onClick={() => setFileDialog({ parentId: selectedFolder, parentName: currentTitle })}
            >
              <FilePlus className="h-3.5 w-3.5" /> Datei
            </button>
          </div>
          <button className="btn btn-ghost mb-2 w-full !py-1.5 text-xs" onClick={() => fileInput.current?.click()}>
            <Upload className="h-3.5 w-3.5" /> Hochladen
          </button>
          <div className="scroll-thin min-h-0 flex-1 overflow-auto">
            <p className="label mt-2">Meine Dateien</p>
            <Tree
              nodes={nodes.filter((n) => !n.shared)}
              selectedId={selectedFolder}
              onSelect={(n) => setSelectedFolder(n.id)}
              onDrop={(d, t) => void moveNode(d, t)}
              expanded={expanded}
              toggle={toggle}
              onContextMenu={(node, x, y) => setMenu({ x, y, node })}
            />
            {sharedRoots.length > 0 && (
              <>
                <p className="label mt-4">Mit mir geteilt</p>
                <Tree
                  nodes={sharedRoots}
                  selectedId={selectedFolder}
                  onSelect={(n) => setSelectedFolder(n.id)}
                  onDrop={(d, t) => void moveNode(d, t)}
                  expanded={expanded}
                  toggle={toggle}
                  onContextMenu={(node, x, y) => setMenu({ x, y, node })}
                />
              </>
            )}
          </div>
        </aside>

        <main
          className={`scroll-thin min-w-0 flex-1 overflow-auto p-4 ${dragging ? 'bg-[var(--accent-soft)]' : ''}`}
          onDragOver={(e) => {
            if (e.dataTransfer.types.includes('Files')) {
              e.preventDefault();
              setDragging(true);
            }
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => {
            if (e.dataTransfer.files?.length) {
              e.preventDefault();
              setDragging(false);
              void uploadFiles(e.dataTransfer.files);
            }
          }}
        >
          <div className="mx-auto max-w-6xl">
            <PageHead
              eyebrow="Sammlung"
              title={currentTitle}
              hint={`${children.length} ${children.length === 1 ? 'Eintrag' : 'Einträge'} · Dateien liegen als echte Dateien auf dem NAS`}
              action={
                <div className="flex gap-1.5">
                  <div className="pill-nav !p-0.5">
                    <button
                      className={`pill !px-2 !py-1.5 ${view === 'list' ? 'active' : ''}`}
                      onClick={() => switchView('list')}
                      title="Listenansicht"
                    >
                      <List className="h-3.5 w-3.5" />
                    </button>
                    <button
                      className={`pill !px-2 !py-1.5 ${view === 'grid' ? 'active' : ''}`}
                      onClick={() => switchView('grid')}
                      title="Galerieansicht"
                    >
                      <LayoutGrid className="h-3.5 w-3.5" />
                    </button>
                  </div>
                  <button className="btn btn-ghost !py-1.5 text-xs md:hidden" onClick={() => setNewFolderOpen(true)}>
                    <FolderPlus className="h-3.5 w-3.5" /> Ordner
                  </button>
                  <button
                    className="btn btn-ghost !py-1.5 text-xs md:hidden"
                    onClick={() => setFileDialog({ parentId: selectedFolder, parentName: currentTitle })}
                  >
                    <FilePlus className="h-3.5 w-3.5" /> Datei
                  </button>
                  <button className="btn btn-primary !py-1.5 text-xs" onClick={() => fileInput.current?.click()}>
                    <Upload className="h-3.5 w-3.5" /> Hochladen
                  </button>
                </div>
              }
            />

            <div className="mb-3 flex flex-wrap items-center gap-1.5 text-[13px]">
              <button
                className="btn btn-ghost !px-2 !py-1"
                onClick={() => setSelectedFolder(breadcrumb.length > 1 ? breadcrumb[breadcrumb.length - 2].id : null)}
                disabled={!selectedFolder}
                title="Eine Ebene zurück"
              >
                <ArrowLeft className="h-3.5 w-3.5" />
              </button>
              <button className={selectedFolder ? 'text-muted hover:underline' : 'font-semibold'} onClick={() => setSelectedFolder(null)}>
                Alle Dateien
              </button>
              {breadcrumb.map((item) => (
                <span key={item.id} className="flex items-center gap-1">
                  <ChevronRight className="h-3 w-3 text-muted" />
                  <button onClick={() => setSelectedFolder(item.id)} className="hover:underline">
                    {item.name}
                  </button>
                </span>
              ))}
            </div>

            {error && (
              <p className="mb-3 alert-danger mb-3 text-xs font-medium">{error}</p>
            )}

            {uploads.length > 0 && (
              <div className="mb-3 space-y-2">
                {uploads.map((u) => (
                  <div key={u.name} className="card p-3">
                    <div className="mb-1 flex justify-between text-xs">
                      <span className="truncate">{u.name}</span>
                      <span className="text-muted">{u.percent}%</span>
                    </div>
                    <div className="h-1.5 overflow-hidden rounded-full bg-[var(--accent-soft)]">
                      <div className="h-full bg-[var(--accent)] transition-all" style={{ width: `${u.percent}%` }} />
                    </div>
                  </div>
                ))}
              </div>
            )}

            {loading ? (
              <p className="text-sm text-muted">Lädt …</p>
            ) : children.length === 0 ? (
              <EmptyState
                title="Hier ist noch nichts"
                hint="Zieh Dateien aus dem Explorer in dieses Fenster oder nutze „Hochladen“. Ordner legst du mit „Ordner“ an."
                action={
                  <button className="btn btn-ghost mt-2" onClick={() => setNewFolderOpen(true)}>
                    <FolderPlus className="h-4 w-4" /> Ersten Ordner anlegen
                  </button>
                }
              />
            ) : view === 'grid' ? (
              <div
                className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4"
                onContextMenu={(e) => {
                  if ((e.target as HTMLElement).closest('.tile')) return;
                  e.preventDefault();
                  setMenu({ x: e.clientX, y: e.clientY, node: null });
                }}
              >
                {children.map((node) => {
                  const isImage = node.kind === 'file' && !!thumbs[node.id];
                  return (
                    <div
                      key={node.id}
                      className="tile card group relative overflow-hidden"
                      draggable
                      onDragStart={(e) => {
                        e.dataTransfer.setData('text/plain', node.id);
                        e.dataTransfer.effectAllowed = 'move';
                      }}
                      onDragOver={(e) => {
                        if (node.kind !== 'folder') return;
                        e.preventDefault();
                        setDropTarget(node.id);
                      }}
                      onDrop={(e) => {
                        e.preventDefault();
                        setDropTarget(null);
                        const dragId = e.dataTransfer.getData('text/plain');
                        if (node.kind === 'folder' && dragId && dragId !== node.id) void moveNode(dragId, node.id);
                      }}
                      onClick={() => open(node)}
                      onContextMenu={(e) => {
                        e.preventDefault();
                        setMenu({ x: e.clientX, y: e.clientY, node });
                      }}
                      title={node.name}
                    >
                      <div className="flex aspect-[4/3] items-center justify-center overflow-hidden bg-surface-2">
                        {isImage ? (
                          <img src={thumbs[node.id]} alt={node.name} loading="lazy" className="h-full w-full object-cover" />
                        ) : (
                          <span className="scale-[2] opacity-60">{iconFor(node)}</span>
                        )}
                      </div>
                      <div className="border-t border-[var(--line)] px-2.5 py-2">
                        <p className="truncate text-[12.5px] font-medium">{node.name}</p>
                        <p className="text-[10.5px] text-muted">
                          {node.kind === 'folder' ? 'Ordner' : formatSize(node.size)}
                        </p>
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div
                className="space-y-1.5"
                onContextMenu={(e) => {
                  if ((e.target as HTMLElement).closest('.row-item')) return;
                  e.preventDefault();
                  setMenu({ x: e.clientX, y: e.clientY, node: null });
                }}
              >
                {children.map((node) => (
                  <div
                    key={node.id}
                    className={`row-item group ${dropTarget === node.id ? 'drop-target' : ''}`}
                    draggable
                    onDragStart={(e) => {
                      e.dataTransfer.setData('text/plain', node.id);
                      e.dataTransfer.effectAllowed = 'move';
                    }}
                    onDragOver={(e) => {
                      if (node.kind !== 'folder') return;
                      e.preventDefault();
                      setDropTarget(node.id);
                    }}
                    onDragLeave={() => setDropTarget((c) => (c === node.id ? null : c))}
                    onDrop={(e) => {
                      e.preventDefault();
                      setDropTarget(null);
                      const dragId = e.dataTransfer.getData('text/plain');
                      if (node.kind === 'folder' && dragId && dragId !== node.id) void moveNode(dragId, node.id);
                    }}
                    onClick={() => open(node)}
                    onContextMenu={(e) => {
                      e.preventDefault();
                      setMenu({ x: e.clientX, y: e.clientY, node });
                    }}
                  >
                    {iconFor(node)}
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[13.5px] font-medium" title={node.name}>
                        {node.name}
                      </p>
                      <p className="text-[11px] text-muted">
                        {node.kind === 'folder' ? 'Ordner' : formatSize(node.size)}
                        {node.permission !== 'owner' ? ` · ${node.permission === 'edit' ? 'bearbeitbar' : 'nur ansehen'}` : ''}
                      </p>
                    </div>
                    <div className="flex shrink-0 items-center gap-0.5 opacity-0 transition group-hover:opacity-100">
                      <button
                        className="btn btn-ghost !px-1.5 !py-1"
                        title="Umbenennen"
                        onClick={(e) => {
                          e.stopPropagation();
                          setRenaming(node);
                          setRenameValue(node.name);
                        }}
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </button>
                      <button
                        className="btn btn-ghost !px-1.5 !py-1"
                        title="Teilen"
                        onClick={(e) => {
                          e.stopPropagation();
                          setShareNode(node);
                        }}
                      >
                        <Share2 className="h-3.5 w-3.5" />
                      </button>
                      <button
                        className="btn btn-ghost !px-1.5 !py-1"
                        title="Herunterladen"
                        onClick={(e) => {
                          e.stopPropagation();
                          void download(node);
                        }}
                      >
                        <Download className="h-3.5 w-3.5" />
                      </button>
                      <button
                        className="btn btn-ghost !px-1.5 !py-1 text-[var(--danger)]"
                        title="In den Papierkorb"
                        onClick={(e) => {
                          e.stopPropagation();
                          void remove(node);
                        }}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </main>
      </div>

      <input
        ref={fileInput}
        type="file"
        multiple
        className="hidden"
        onChange={(e) => {
          if (e.target.files?.length) void uploadFiles(e.target.files);
          e.target.value = '';
        }}
      />

      {newFolderOpen && (
        <Modal title="Neuer Ordner" subtitle={currentTitle} onClose={() => setNewFolderOpen(false)}>
          <div className="space-y-3">
            <div>
              <label className="label">Name</label>
              <input
                className="input"
                autoFocus
                value={folderName}
                onChange={(e) => setFolderName(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && void createFolder()}
                placeholder="z. B. IT11b oder LF4 Netzwerke"
              />
            </div>
            <button className="btn btn-primary w-full" onClick={() => void createFolder()} disabled={!folderName.trim()}>
              Anlegen
            </button>
          </div>
        </Modal>
      )}

      {renaming && (
        <Modal title="Umbenennen" onClose={() => setRenaming(null)}>
          <div className="space-y-3">
            <div>
              <label className="label">Neuer Name</label>
              <input
                className="input"
                autoFocus
                value={renameValue}
                onChange={(e) => setRenameValue(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && void rename()}
              />
            </div>
            <button className="btn btn-primary w-full" onClick={() => void rename()} disabled={!renameValue.trim()}>
              Speichern
            </button>
          </div>
        </Modal>
      )}

      {shareNode && <ShareDialog node={shareNode} onClose={() => setShareNode(null)} />}

      {menu && <ContextMenu x={menu.x} y={menu.y} entries={menuEntries(menu.node)} onClose={() => setMenu(null)} />}

      {fileDialog && (
        <CreateFileDialog
          parentId={fileDialog.parentId}
          parentName={fileDialog.parentName}
          onClose={() => setFileDialog(null)}
          onCreated={(node) => {
            void load();
            if (node.kind === 'file') navigate(`#/edit/${node.id}`);
          }}
        />
      )}
    </Shell>
  );
}
