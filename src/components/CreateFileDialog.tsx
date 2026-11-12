import { useState } from 'react';
import { FileSpreadsheet, FileText, Loader2, NotebookPen } from 'lucide-react';
import { api } from '../lib/api';
import { Modal } from './Modal';
import type { NodeItem } from '../lib/types';

type Kind = { ext: string; label: string; hint: string; icon: typeof FileText };

const KINDS: Kind[] = [
  { ext: 'docx', label: 'Word-Dokument', hint: '.docx · im Office-Editor bearbeiten', icon: FileText },
  { ext: 'xlsx', label: 'Excel-Tabelle', hint: '.xlsx · im Office-Editor bearbeiten', icon: FileSpreadsheet },
  { ext: 'md', label: 'Notiz', hint: '.md · direkt im Browser schreiben', icon: NotebookPen },
  { ext: 'txt', label: 'Textdatei', hint: '.txt · direkt im Browser schreiben', icon: FileText },
];

/** Neue leere Datei anlegen — der Typ bestimmt die Vorlage. */
export function CreateFileDialog({
  parentId,
  parentName,
  onClose,
  onCreated,
}: {
  parentId: string | null;
  parentName: string;
  onClose: () => void;
  onCreated: (node: NodeItem) => void;
}) {
  const [kind, setKind] = useState<Kind>(KINDS[0]);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function create() {
    const base = name.trim() || `Neues Dokument`;
    const full = base.toLowerCase().endsWith(`.${kind.ext}`) ? base : `${base}.${kind.ext}`;
    setBusy(true);
    setError(null);
    try {
      const data = await api<{ node: NodeItem }>('/nodes/file', { body: { parentId, name: full } });
      onCreated(data.node);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Datei konnte nicht angelegt werden.');
      setBusy(false);
    }
  }

  return (
    <Modal title="Neue Datei" subtitle={parentName} onClose={onClose}>
      <div className="space-y-3">
        <div className="grid grid-cols-2 gap-2">
          {KINDS.map((k) => {
            const Icon = k.icon;
            return (
              <button
                key={k.ext}
                type="button"
                onClick={() => setKind(k)}
                className={`flex flex-col items-start gap-1 rounded-xl border p-3 text-left ${
                  kind.ext === k.ext ? 'border-[var(--accent)] bg-[var(--accent-soft)]' : 'border-[var(--line)]'
                }`}
              >
                <Icon className="h-4 w-4 text-[var(--accent)]" />
                <span className="text-[13px] font-medium">{k.label}</span>
                <span className="text-[10.5px] text-muted">{k.hint}</span>
              </button>
            );
          })}
        </div>

        <div>
          <label className="label">Name</label>
          <div className="flex items-center gap-2">
            <input
              className="input"
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && void create()}
              placeholder="z. B. Lernzettel Netzwerke"
            />
            <span className="shrink-0 text-[12px] text-muted">.{kind.ext}</span>
          </div>
        </div>

        {error && <p className="rounded-lg bg-[var(--danger)]/10 px-3 py-2 text-xs text-[var(--danger)]">{error}</p>}

        <button className="btn btn-primary w-full" onClick={() => void create()} disabled={busy}>
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null} Anlegen
        </button>
      </div>
    </Modal>
  );
}
