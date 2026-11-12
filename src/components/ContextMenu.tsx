import { useEffect, useRef, useState, type ReactNode } from 'react';

export type MenuEntry =
  | { kind: 'item'; label: string; icon?: ReactNode; onClick: () => void; danger?: boolean; shortcut?: string; disabled?: boolean }
  | { kind: 'separator' };

/** Rechtsklick-Menü im App-Stil — ersetzt das Browser-Menü im Baum und in der Liste. */
export function ContextMenu({ x, y, entries, onClose }: { x: number; y: number; entries: MenuEntry[]; onClose: () => void }) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [pos, setPos] = useState({ x, y });

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const maxX = window.innerWidth - rect.width - 8;
    const maxY = window.innerHeight - rect.height - 8;
    setPos({ x: Math.min(x, Math.max(8, maxX)), y: Math.min(y, Math.max(8, maxY)) });
  }, [x, y]);

  useEffect(() => {
    const close = () => onClose();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('click', close);
    window.addEventListener('contextmenu', close);
    window.addEventListener('keydown', onKey);
    window.addEventListener('resize', close);
    return () => {
      window.removeEventListener('click', close);
      window.removeEventListener('contextmenu', close);
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('resize', close);
    };
  }, [onClose]);

  return (
    <div
      ref={ref}
      className="fixed z-[60] min-w-[212px] overflow-hidden rounded-xl border border-[var(--line)] bg-[var(--card)] py-1 shadow-xl"
      style={{ left: pos.x, top: pos.y }}
      onClick={(e) => e.stopPropagation()}
      onContextMenu={(e) => e.preventDefault()}
    >
      {entries.map((entry, index) =>
        entry.kind === 'separator' ? (
          <div key={`sep-${index}`} className="my-1 h-px bg-[var(--line)]" />
        ) : (
          <button
            key={entry.label}
            className={`flex w-full items-center gap-2.5 px-3 py-1.5 text-left text-[13px] hover:bg-[var(--accent-soft)] disabled:opacity-40 ${
              entry.danger ? 'text-[var(--danger)]' : ''
            }`}
            disabled={entry.disabled}
            onClick={() => {
              onClose();
              entry.onClick();
            }}
          >
            <span className="flex h-4 w-4 items-center justify-center text-muted">{entry.icon}</span>
            <span className="flex-1">{entry.label}</span>
            {entry.shortcut && <span className="text-[11px] text-muted">{entry.shortcut}</span>}
          </button>
        ),
      )}
    </div>
  );
}
