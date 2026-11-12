import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowLeft,
  Download,
  File as FileIcon,
  Folder,
  FileSpreadsheet,
  FileText,
  FolderPlus,
  Image as ImageIcon,
  LogOut,
  Moon,
  Pencil,
  Presentation,
  Share2,
  Sun,
  Trash2,
  Upload,
  Users,
} from 'lucide-react';
import { api, getToken } from '../lib/api';
import { useAuth } from '../lib/auth';
import { navigate } from '../App';
import { Tree } from '../components/Tree';
import { Modal } from '../components/Modal';
import { ShareDialog } from '../components/ShareDialog';
import type { NodeItem } from '../lib/types';

const CHUNK = 8 * 1024 * 1024;

function iconFor(node: NodeItem) {
  if (node.kind === 'folder') return <Folder className="h-5 w-5 text-[var(--accent)]" />;
  const ext = node.name.split('.').pop()?.toLowerCase() ?? '';
  if (['docx', 'doc', 'odt', 'rtf', 'txt', 'md'].includes(ext)) return <FileText className="h-5 w-5" />;
  if (['xlsx', 'xls', 'ods', 'csv'].includes(ext)) return <FileSpreadsheet className="h-5 w-5" />;
  if (['pptx', 'ppt', 'odp'].includes(ext)) return <Presentation className="h-5 w-5" />;
  if (['png', 'jpg', 'jpeg', 'gif', 'webp'].includes(ext)) return <ImageIcon className="h-5 w-5" />;
  return <FileIcon className="h-5 w-5" />;
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
  const { user, logout } = useAuth();
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
  const [theme, setTheme] = useState<'light' | 'dark'>(() => (localStorage.getItem('eduplanner.theme') as 'light' | 'dark') || 'light');
  const fileInput = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('eduplanner.theme', theme);
  }, [theme]);

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
    if (name.length < 1) return;
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
    const list = Array.from(files);
    for (const file of list) {
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

  const sharedRoots = nodes.filter((n) => n.shared);

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center justify-between gap-3 border-b border-[var(--line)] px-4 py-2.5">
        <div className="flex items-center gap-2">
          <span className="text-base font-semibold">Education Planner</span>
          <span className="hidden text-xs text-muted sm:inline">{user?.name}</span>
        </div>
        <div className="flex items-center gap-1.5">
          <button className="btn btn-ghost !px-2 !py-1.5" onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')} title="Design wechseln">
            {theme === 'dark' ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
          </button>
          {user?.role === 'admin' && (
            <button className="btn btn-ghost !px-2 !py-1.5" onClick={() => navigate('#/users')} title="Nutzer">
              <Users className="h-4 w-4" />
            </button>
          )}
          <button className="btn btn-ghost !px-2 !py-1.5" onClick={() => navigate('#/trash')} title="Papierkorb">
            <Trash2 className="h-4 w-4" />
          </button>
          <button className="btn btn-ghost !px-2 !py-1.5" onClick={logout} title="Abmelden">
            <LogOut className="h-4 w-4" />
          </button>
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        <aside className="hidden w-72 shrink-0 flex-col border-r border-[var(--line)] p-3 md:flex">
          <div className="mb-2 flex gap-1.5">
            <button className="btn btn-primary flex-1 !py-1.5 text-xs" onClick={() => setNewFolderOpen(true)}>
              <FolderPlus className="h-3.5 w-3.5" /> Ordner
            </button>
            <button className="btn btn-ghost flex-1 !py-1.5 text-xs" onClick={() => fileInput.current?.click()}>
              <Upload className="h-3.5 w-3.5" /> Hochladen
            </button>
          </div>
          <div className="min-h-0 flex-1 overflow-auto">
            <p className="label mt-2">Meine Dateien</p>
            <Tree nodes={nodes.filter((n) => !n.shared)} selectedId={selectedFolder} onSelect={(n) => setSelectedFolder(n.id)} onDrop={(d, t) => void moveNode(d, t)} expanded={expanded} toggle={toggle} />
            {sharedRoots.length > 0 && (
              <>
                <p className="label mt-4">Mit mir geteilt</p>
                <Tree nodes={sharedRoots} selectedId={selectedFolder} onSelect={(n) => setSelectedFolder(n.id)} onDrop={(d, t) => void moveNode(d, t)} expanded={expanded} toggle={toggle} />
              </>
            )}
          </div>
        </aside>

        <main
          className={`min-w-0 flex-1 overflow-auto p-4 ${dragging ? 'bg-[var(--accent-soft)]' : ''}`}
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
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <button className="btn btn-ghost !px-2 !py-1" onClick={() => setSelectedFolder(breadcrumb.length > 1 ? breadcrumb[breadcrumb.length - 2].id : null)} disabled={!selectedFolder}>
              <ArrowLeft className="h-4 w-4" />
            </button>
            <div className="flex flex-wrap items-center gap-1 text-sm">
              <button className={selectedFolder ? 'text-muted' : 'font-semibold'} onClick={() => setSelectedFolder(null)}>
                Meine Dateien
              </button>
              {breadcrumb.map((item) => (
                <span key={item.id} className="flex items-center gap-1">
                  <span className="text-muted">/</span>
                  <button onClick={() => setSelectedFolder(item.id)} className="hover:underline">
                    {item.name}
                  </button>
                </span>
              ))}
            </div>
            <div className="ml-auto flex gap-1.5">
              <button className="btn btn-ghost !py-1.5 text-xs md:hidden" onClick={() => setNewFolderOpen(true)}>
                <FolderPlus className="h-3.5 w-3.5" /> Ordner
              </button>
              <button className="btn btn-primary !py-1.5 text-xs" onClick={() => fileInput.current?.click()}>
                <Upload className="h-3.5 w-3.5" /> Hochladen
              </button>
            </div>
          </div>

          {error && <p className="mb-3 rounded-lg bg-red-500/10 px-3 py-2 text-xs font-medium text-red-600">{error}</p>}

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
            <div className="card flex flex-col items-center justify-center gap-2 px-6 py-16 text-center">
              <FolderPlus className="h-8 w-8 text-muted" />
              <p className="text-sm font-medium">Dieser Ordner ist leer</p>
              <p className="max-w-sm text-xs text-muted">
                Zieh Dateien aus dem Explorer hierher oder nutze „Hochladen“. Ordner legst du mit „Ordner“ an.
              </p>
            </div>
          ) : (
            <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
              {children.map((node) => (
                <div
                  key={node.id}
                  className="card group flex items-center gap-3 p-3 hover:border-[var(--accent)]"
                  draggable
                  onDragStart={(e) => {
                    e.dataTransfer.setData('text/plain', node.id);
                    e.dataTransfer.effectAllowed = 'move';
                  }}
                  onDoubleClick={() => open(node)}
                >
                  <button className="flex min-w-0 flex-1 items-center gap-3 text-left" onClick={() => open(node)}>
                    {iconFor(node)}
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-medium">{node.name}</span>
                      <span className="block text-[11px] text-muted">
                        {node.kind === 'folder' ? 'Ordner' : formatSize(node.size)}
                        {node.shared ? ' · geteilt' : ''}
                      </span>
                    </span>
                  </button>
                  <div className="flex shrink-0 items-center gap-0.5 opacity-0 transition group-hover:opacity-100">
                    <button className="btn btn-ghost !px-1.5 !py-1" title="Umbenennen" onClick={() => { setRenaming(node); setRenameValue(node.name); }}>
                      <Pencil className="h-3.5 w-3.5" />
                    </button>
                    <button className="btn btn-ghost !px-1.5 !py-1" title="Teilen" onClick={() => setShareNode(node)}>
                      <Share2 className="h-3.5 w-3.5" />
                    </button>
                    <button className="btn btn-ghost !px-1.5 !py-1" title="Herunterladen" onClick={() => void download(node)}>
                      <Download className="h-3.5 w-3.5" />
                    </button>
                    <button className="btn btn-ghost !px-1.5 !py-1" title="In den Papierkorb" onClick={() => void remove(node)}>
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
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
        <Modal title="Neuer Ordner" onClose={() => setNewFolderOpen(false)}>
          <div className="space-y-3">
            <div>
              <label className="label">Name</label>
              <input className="input" autoFocus value={folderName} onChange={(e) => setFolderName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && void createFolder()} />
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
              <input className="input" autoFocus value={renameValue} onChange={(e) => setRenameValue(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && void rename()} />
            </div>
            <button className="btn btn-primary w-full" onClick={() => void rename()} disabled={!renameValue.trim()}>
              Speichern
            </button>
          </div>
        </Modal>
      )}

      {shareNode && <ShareDialog node={shareNode} onClose={() => setShareNode(null)} />}
    </div>
  );
}
