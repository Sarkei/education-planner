import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ClipboardPaste,
  Copy,
  CopyPlus,
  Download,
  ExternalLink,
  FilePlus,
  FolderPlus,
  PanelLeftClose,
  PanelLeftOpen,
  Pencil,
  Scissors,
  Share2,
  Trash2,
  Upload,
} from 'lucide-react';
import { api, getToken } from '../lib/api';
import { navigate } from '../App';
import { Tree } from '../components/Tree';
import { Modal } from '../components/Modal';
import { ShareDialog } from '../components/ShareDialog';
import { Shell } from '../components/Shell';
import { ContextMenu, type MenuEntry } from '../components/ContextMenu';
import { CreateFileDialog } from '../components/CreateFileDialog';
import { EditorPane } from '../components/EditorPane';
import { AssistentChat, AssistentKnopf } from '../components/AssistentChat';
import type { NodeItem } from '../lib/types';

const CHUNK = 8 * 1024 * 1024;

/** Schlüssel für den gemerkten Zustand — überlebt das Neuladen. */
const LS_EXPANDED = 'eduplanner.tree.expanded';
const LS_SELECTED = 'eduplanner.tree.selected';
const LS_SIDEBAR = 'eduplanner.tree.sidebar';

function readExpanded(): Set<string> {
  try {
    const raw = localStorage.getItem(LS_EXPANDED);
    const list = raw ? (JSON.parse(raw) as unknown) : [];
    return new Set(Array.isArray(list) ? list.filter((x): x is string => typeof x === 'string') : []);
  } catch {
    return new Set();
  }
}

/** Datei-ID aus dem Hash (#/edit/<id> oder #/datei/<id>). */
function idFromHash(): string | null {
  const match = location.hash.match(/^#\/(?:edit|datei)\/([^/?#]+)/);
  return match ? match[1] : null;
}

export function FilesPage() {
  const [nodes, setNodes] = useState<NodeItem[]>([]);
  const [selectedFolder, setSelectedFolder] = useState<string | null>(() => localStorage.getItem(LS_SELECTED) || null);
  const [openFileId, setOpenFileId] = useState<string | null>(() => idFromHash());
  const [expanded, setExpanded] = useState<Set<string>>(readExpanded);
  const [sidebarOpen, setSidebarOpen] = useState<boolean>(() => localStorage.getItem(LS_SIDEBAR) !== 'closed');
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [chatOffen, setChatOffen] = useState<boolean>(() => localStorage.getItem('eduplanner.chat') === 'offen');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [newFolderOpen, setNewFolderOpen] = useState(false);
  const [folderName, setFolderName] = useState('');
  const [shareNode, setShareNode] = useState<NodeItem | null>(null);
  const [renaming, setRenaming] = useState<NodeItem | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [uploads, setUploads] = useState<Array<{ name: string; percent: number }>>([]);
  const [dragging, setDragging] = useState(false);
  const [menu, setMenu] = useState<{ x: number; y: number; node: NodeItem | null } | null>(null);
  const [clipboard, setClipboard] = useState<{ mode: 'copy' | 'cut'; node: NodeItem } | null>(null);
  const [fileDialog, setFileDialog] = useState<{ parentId: string | null; parentName: string } | null>(null);
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

  // Hash-Route folgen (Zurück-Taste, Direktlink)
  useEffect(() => {
    const onHash = () => setOpenFileId(idFromHash());
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  // Zustand sichern: aufgeklappte Ordner, Auswahl, ein-/ausgeklappte Spalte
  useEffect(() => {
    localStorage.setItem(LS_EXPANDED, JSON.stringify([...expanded]));
  }, [expanded]);
  useEffect(() => {
    if (selectedFolder) localStorage.setItem(LS_SELECTED, selectedFolder);
    else localStorage.removeItem(LS_SELECTED);
  }, [selectedFolder]);
  useEffect(() => {
    localStorage.setItem(LS_SIDEBAR, sidebarOpen ? 'open' : 'closed');
  }, [sidebarOpen]);
  useEffect(() => {
    localStorage.setItem('eduplanner.chat', chatOffen ? 'offen' : 'zu');
  }, [chatOffen]);

  // Beim ersten Laden den Pfad zur gemerkten Auswahl aufklappen
  const restored = useRef(false);
  useEffect(() => {
    if (restored.current || !nodes.length) return;
    restored.current = true;
    const target = openFileId ?? selectedFolder;
    if (!target) return;
    const byId = new Map(nodes.map((n) => [n.id, n]));
    const next = new Set(expanded);
    let current = byId.get(target) ?? null;
    let guard = 0;
    while (current?.parentId && guard++ < 50) {
      next.add(current.parentId);
      current = byId.get(current.parentId) ?? null;
    }
    if (next.size !== expanded.size) setExpanded(next);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nodes]);

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

  const openFile = useMemo(
    () => (openFileId ? nodes.find((n) => n.id === openFileId) ?? null : null),
    [nodes, openFileId],
  );

  const breadcrumb = useMemo(() => {
    const anchor = openFile ?? nodes.find((n) => n.id === selectedFolder) ?? null;
    const path: NodeItem[] = [];
    let current: NodeItem | null = anchor;
    let guard = 0;
    while (current && guard++ < 50) {
      path.unshift(current);
      current = current.parentId ? nodes.find((n) => n.id === current?.parentId) ?? null : null;
    }
    return path;
  }, [nodes, selectedFolder, openFile]);

  const currentTitle = breadcrumb.length ? breadcrumb[breadcrumb.length - 1].name : 'Alle Dateien';
  /** Zielordner für neue Dateien: der Ordner der offenen Datei, sonst die Baumauswahl. */
  const folderForNew = openFile?.parentId ?? selectedFolder;

  function toggle(id: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function openNode(node: NodeItem) {
    if (node.kind === 'folder') {
      setSelectedFolder(node.id);
      setExpanded((prev) => new Set(prev).add(node.id));
      setDrawerOpen(false);
      return;
    }
    setSelectedFolder(node.parentId ?? null);
    setOpenFileId(node.id);
    setDrawerOpen(false);
    navigate(`#/datei/${node.id}`);
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
      await api('/nodes/folder', { body: { parentId: folderForNew, name } });
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
    if (!confirm(`„${node.name}“ in den Papierkorb legen?`)) return;
    try {
      await api(`/nodes/${node.id}`, { method: 'DELETE' });
      if (openFileId === node.id) {
        setOpenFileId(null);
        navigate('#/files');
      }
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Löschen fehlgeschlagen.');
    }
  }

  /** Upload in Teilen — so passen auch große Dateien durch den Tunnel. */
  async function uploadFiles(files: FileList | File[]) {
    const parentId = folderForNew;
    for (const file of Array.from(files)) {
      setUploads((prev) => [...prev, { name: file.name, percent: 0 }]);
      try {
        const init = await api<{ uploadId: string }>('/uploads/init', {
          body: { parentId, name: file.name, size: file.size, mime: file.type || undefined },
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
    const res = await fetch(`/api/nodes/${node.id}/download`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
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
    try {
      if (clipboard.mode === 'copy') {
        await api(`/nodes/${clipboard.node.id}/copy`, { body: { parentId: selectedFolder } });
      } else {
        await api(`/nodes/${clipboard.node.id}`, { method: 'PATCH', body: { parentId: selectedFolder } });
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
    entries.push({
      kind: 'item',
      label: 'Neuer Ordner',
      icon: <FolderPlus className="h-3.5 w-3.5" />,
      onClick: () => setNewFolderOpen(true),
    });
    entries.push({
      kind: 'item',
      label: 'Neue Datei',
      icon: <FilePlus className="h-3.5 w-3.5" />,
      onClick: () =>
        setFileDialog({
          parentId: node && node.kind === 'folder' ? node.id : folderForNew,
          parentName: node?.name ?? currentTitle,
        }),
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
    entries.push({
      kind: 'item',
      label: node.kind === 'folder' ? 'Öffnen' : 'Bearbeiten',
      icon: <ExternalLink className="h-3.5 w-3.5" />,
      onClick: () => openNode(node),
    });
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
    entries.push({
      kind: 'item',
      label: 'Kopieren',
      icon: <Copy className="h-3.5 w-3.5" />,
      shortcut: 'Strg+C',
      onClick: () => setClipboard({ mode: 'copy', node }),
    });
    entries.push({
      kind: 'item',
      label: 'Ausschneiden',
      icon: <Scissors className="h-3.5 w-3.5" />,
      shortcut: 'Strg+X',
      onClick: () => setClipboard({ mode: 'cut', node }),
    });
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
    entries.push({
      kind: 'item',
      label: 'Teilen',
      icon: <Share2 className="h-3.5 w-3.5" />,
      onClick: () => setShareNode(node),
    });
    entries.push({
      kind: 'item',
      label: 'Herunterladen',
      icon: <Download className="h-3.5 w-3.5" />,
      onClick: () => void download(node),
    });
    entries.push({ kind: 'separator' });
    entries.push({
      kind: 'item',
      label: 'In den Papierkorb',
      icon: <Trash2 className="h-3.5 w-3.5" />,
      danger: true,
      onClick: () => void remove(node),
    });
    return entries;
  }

  const ownNodes = nodes.filter((n) => !n.shared);
  const sharedRoots = nodes.filter((n) => n.shared);

  const treeBlock = (
    <>
      <div className="mb-1.5 flex gap-1.5">
        <button className="btn btn-primary flex-1 !py-1.5 text-xs" onClick={() => setNewFolderOpen(true)}>
          <FolderPlus className="h-3.5 w-3.5" /> Ordner
        </button>
        <button
          className="btn btn-ghost flex-1 !py-1.5 text-xs"
          onClick={() => setFileDialog({ parentId: folderForNew, parentName: currentTitle })}
        >
          <FilePlus className="h-3.5 w-3.5" /> Datei
        </button>
      </div>
      <button className="btn btn-ghost mb-2 w-full !py-1.5 text-xs" onClick={() => fileInput.current?.click()}>
        <Upload className="h-3.5 w-3.5" /> Hochladen
      </button>
      <div className="scroll-thin min-h-0 flex-1 overflow-auto">
        <p className="label mt-2">Meine Dateien</p>
        {loading ? (
          <p className="px-2 py-4 text-xs text-muted">Lädt …</p>
        ) : (
          <Tree
            nodes={ownNodes}
            selectedId={openFileId ?? selectedFolder}
            onSelect={openNode}
            onDrop={(d, t) => void moveNode(d, t)}
            expanded={expanded}
            toggle={toggle}
            onContextMenu={(node, x, y) => setMenu({ x, y, node })}
          />
        )}
        {sharedRoots.length > 0 && (
          <>
            <p className="label mt-4">Mit mir geteilt</p>
            <Tree
              nodes={sharedRoots}
              selectedId={openFileId ?? selectedFolder}
              onSelect={openNode}
              onDrop={(d, t) => void moveNode(d, t)}
              expanded={expanded}
              toggle={toggle}
              onContextMenu={(node, x, y) => setMenu({ x, y, node })}
            />
          </>
        )}
      </div>
    </>
  );

  return (
    <Shell tab="files">
      <div className="flex h-full">
        {/* Baum: feste Spalte auf großen Bildschirmen, Ausklapper auf dem Handy */}
        {sidebarOpen && (
          <aside className="hidden w-72 shrink-0 flex-col border-r border-[var(--line)] p-3 md:flex">{treeBlock}</aside>
        )}

        {drawerOpen && (
          <div className="fixed inset-0 z-40 md:hidden">
            <div className="absolute inset-0 bg-black/50" onClick={() => setDrawerOpen(false)} />
            <aside className="absolute inset-y-0 left-0 flex w-[19rem] max-w-[85vw] flex-col border-r border-[var(--line)] bg-[var(--bg)] p-3">
              <div className="mb-2 flex items-center justify-between">
                <p className="serif text-[15px]">Dateien</p>
                <button className="btn btn-ghost !px-2 !py-1" onClick={() => setDrawerOpen(false)} title="Baum schließen">
                  <PanelLeftClose className="h-4 w-4" />
                </button>
              </div>
              {treeBlock}
            </aside>
          </div>
        )}

        <main
          className={`flex min-w-0 flex-1 flex-col ${dragging ? 'bg-[var(--accent-soft)]' : ''}`}
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
          {/* Kopfzeile der Dokumentansicht */}
          <div className="flex items-center gap-1.5 border-b border-[var(--line)] px-3 py-1.5">
            <button
              className="btn btn-ghost !px-1.5 !py-1 md:hidden"
              onClick={() => setDrawerOpen(true)}
              title="Baum öffnen"
            >
              <PanelLeftOpen className="h-3.5 w-3.5" />
            </button>
            <button
              className="btn btn-ghost hidden !px-1.5 !py-1 md:inline-flex"
              onClick={() => setSidebarOpen((v) => !v)}
              title={sidebarOpen ? 'Baum einklappen' : 'Baum ausklappen'}
            >
              {sidebarOpen ? <PanelLeftClose className="h-3.5 w-3.5" /> : <PanelLeftOpen className="h-3.5 w-3.5" />}
            </button>
            <span className="truncate text-[11px] text-muted">{currentTitle}</span>
            <div className="ml-auto flex items-center gap-1.5">
              <AssistentKnopf onClick={() => setChatOffen(true)} versteckt={chatOffen} />
              <button className="btn btn-primary !py-1 text-xs" onClick={() => fileInput.current?.click()}>
                <Upload className="h-3.5 w-3.5" /> Hochladen
              </button>
            </div>
          </div>

          {error && (
            <p className="mx-3 mt-2 rounded-xl bg-[var(--danger)]/10 px-3 py-2 text-xs font-medium text-[var(--danger)]">
              {error}
            </p>
          )}

          {uploads.length > 0 && (
            <div className="mx-3 mt-2 space-y-2">
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

          <div className="flex min-h-0 flex-1">
            <div className="min-h-0 min-w-0 flex-1">
            {openFileId ? (
              <EditorPane nodeId={openFileId} />
            ) : (
              <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center">
                <p className="serif text-lg">{selectedFolder ? currentTitle : 'Wähle links eine Datei'}</p>
                <p className="max-w-sm text-[12px] text-muted">
                  PDF, Word, Excel, PowerPoint, Text und Markdown öffnen sich hier rechts — der Ordnerbaum bleibt links
                  stehen. Dateien kannst du auch einfach in dieses Fenster ziehen.
                </p>
                <div className="flex flex-wrap justify-center gap-1.5">
                  <button className="btn btn-ghost !py-1.5 text-xs" onClick={() => setNewFolderOpen(true)}>
                    <FolderPlus className="h-3.5 w-3.5" /> Ordner
                  </button>
                  <button
                    className="btn btn-ghost !py-1.5 text-xs"
                    onClick={() => setFileDialog({ parentId: folderForNew, parentName: currentTitle })}
                  >
                    <FilePlus className="h-3.5 w-3.5" /> Datei
                  </button>
                  <button className="btn btn-primary !py-1.5 text-xs" onClick={() => fileInput.current?.click()}>
                    <Upload className="h-3.5 w-3.5" /> Hochladen
                  </button>
                </div>
              </div>
            )}
            </div>
            <AssistentChat
              offen={chatOffen}
              onSchliessen={() => setChatOffen(false)}
              onDateiAendert={() => void load()}
            />
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
            if (node.kind === 'file') openNode(node);
          }}
        />
      )}
    </Shell>
  );
}
