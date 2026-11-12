import { useState } from 'react';
import { ChevronRight, FileText, Folder, FolderOpen, Share2 } from 'lucide-react';
import type { NodeItem } from '../lib/types';

type Props = {
  nodes: NodeItem[];
  selectedId: string | null;
  onSelect: (node: NodeItem) => void;
  onDrop: (dragId: string, targetId: string | null) => void;
  expanded: Set<string>;
  toggle: (id: string) => void;
};

/** Ordnerbaum links. Ziehen legt Dateien und Ordner in andere Ordner. */
export function Tree({ nodes, selectedId, onSelect, onDrop, expanded, toggle }: Props) {
  const byParent = new Map<string | null, NodeItem[]>();
  for (const node of nodes) {
    const key = node.parentId ?? null;
    const list = byParent.get(key) ?? [];
    list.push(node);
    byParent.set(key, list);
  }
  for (const list of byParent.values()) {
    list.sort((a, b) => (a.kind === b.kind ? a.name.localeCompare(b.name, 'de') : a.kind === 'folder' ? -1 : 1));
  }

  const [dropTarget, setDropTarget] = useState<string | null>(null);

  function render(nodesHere: NodeItem[], depth: number) {
    return nodesHere.map((node) => {
      const children = byParent.get(node.id) ?? [];
      const isOpen = expanded.has(node.id);
      return (
        <div key={node.id}>
          <div
            className={`tree-row ${selectedId === node.id ? 'active' : ''} ${dropTarget === node.id ? 'drop-target' : ''}`}
            style={{ paddingLeft: 6 + depth * 14 }}
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
            onDragLeave={() => setDropTarget((current) => (current === node.id ? null : current))}
            onDrop={(e) => {
              e.preventDefault();
              setDropTarget(null);
              const dragId = e.dataTransfer.getData('text/plain');
              if (node.kind === 'folder' && dragId && dragId !== node.id) onDrop(dragId, node.id);
            }}
            onClick={() => {
              onSelect(node);
              if (node.kind === 'folder') toggle(node.id);
            }}
          >
            {node.kind === 'folder' ? (
              <ChevronRight className={`h-3.5 w-3.5 shrink-0 text-muted transition ${isOpen ? 'rotate-90' : ''}`} />
            ) : (
              <span className="w-3.5 shrink-0" />
            )}
            {node.kind === 'folder' ? (
              isOpen ? <FolderOpen className="h-4 w-4 shrink-0 text-[var(--accent)]" /> : <Folder className="h-4 w-4 shrink-0 text-[var(--accent)]" />
            ) : (
              <FileText className="h-4 w-4 shrink-0 text-muted" />
            )}
            <span className="truncate">{node.name}</span>
            {node.shared && <Share2 className="ml-auto h-3 w-3 shrink-0 text-muted" />}
          </div>
          {node.kind === 'folder' && isOpen && children.length > 0 && render(children, depth + 1)}
        </div>
      );
    });
  }

  const roots = byParent.get(null) ?? [];

  return (
    <div
      className={`select-none ${dropTarget === 'root' ? 'rounded-lg ring-1 ring-[var(--accent)]' : ''}`}
      onDragOver={(e) => {
        e.preventDefault();
        setDropTarget('root');
      }}
      onDragLeave={() => setDropTarget((c) => (c === 'root' ? null : c))}
      onDrop={(e) => {
        e.preventDefault();
        setDropTarget(null);
        const dragId = e.dataTransfer.getData('text/plain');
        if (dragId) onDrop(dragId, null);
      }}
    >
      {roots.length === 0 ? (
        <p className="px-2 py-6 text-xs text-muted">Noch keine Ordner — leg links einen an oder lade Dateien hoch.</p>
      ) : (
        render(roots, 0)
      )}
    </div>
  );
}
