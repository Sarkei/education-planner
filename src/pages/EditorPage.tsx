import { useEffect, useRef, useState } from 'react';
import { ArrowLeft, Check, Loader2, Save } from 'lucide-react';
import { api } from '../lib/api';
import { navigate } from '../App';
import type { NodeItem } from '../lib/types';

type OfficeConfig = {
  documentServerUrl: string;
  config: Record<string, unknown>;
};

declare global {
  interface Window {
    DocsAPI?: { DocEditor: new (id: string, config: Record<string, unknown>) => { destroyEditor: () => void } };
  }
}

const TEXT_EXTENSIONS = ['txt', 'md'];

export function EditorPage({ nodeId }: { nodeId: string }) {
  const [node, setNode] = useState<NodeItem | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [text, setText] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const editorRef = useRef<{ destroyEditor: () => void } | null>(null);
  const containerRef = useRef<string>(`office-${Math.random().toString(36).slice(2)}`);

  const ext = node?.name.split('.').pop()?.toLowerCase() ?? '';
  const isText = TEXT_EXTENSIONS.includes(ext) && !node?.mime?.includes('officedocument');

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const data = await api<{ node: NodeItem }>(`/nodes/${nodeId}`);
        if (cancelled) return;
        setNode(data.node);
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Datei nicht gefunden.');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [nodeId]);

  // Textdateien direkt im Browser bearbeiten
  useEffect(() => {
    if (!node || !isText) return;
    void (async () => {
      try {
        const res = await fetch(`/api/nodes/${node.id}/download`, {
          headers: { Authorization: `Bearer ${localStorage.getItem('eduplanner.token') ?? ''}` },
        });
        setText(await res.text());
      } catch {
        setText('');
      }
    })();
  }, [node, isText]);

  // Office-Dokument in ONLYOFFICE öffnen
  useEffect(() => {
    if (!node || isText) return;
    let disposed = false;

    async function boot() {
      try {
        const data = await api<OfficeConfig>(`/nodes/${node!.id}/config`, { method: 'POST', body: {} });
        if (disposed) return;
        if (!window.DocsAPI) {
          await new Promise<void>((resolve, reject) => {
            const script = document.createElement('script');
            script.src = `${data.documentServerUrl}/web-apps/apps/api/documents/api.js`;
            script.onload = () => resolve();
            script.onerror = () => reject(new Error('Dokumentenserver nicht erreichbar.'));
            document.body.appendChild(script);
          });
        }
        if (disposed || !window.DocsAPI) return;
        const config = {
          ...data.config,
          events: {
            onDocumentStateChange: (event: { data?: boolean }) => setSaved(!event.data),
            onError: (event: { data?: { errorDescription?: string } }) =>
              setError(event?.data?.errorDescription ?? 'Der Editor meldet einen Fehler.'),
            onRequestClose: () => navigate('#/files'),
          },
        };
        editorRef.current = new window.DocsAPI.DocEditor(containerRef.current, config);
        setSaved(true);
      } catch (e) {
        if (!disposed) setError(e instanceof Error ? e.message : 'Editor konnte nicht starten.');
      }
    }
    void boot();

    return () => {
      disposed = true;
      editorRef.current?.destroyEditor();
      editorRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [node?.id, isText]);

  // Alle 60 Sekunden zwischenspeichern, damit bei Absturz nichts verloren geht
  useEffect(() => {
    if (!node || isText) return;
    const timer = window.setInterval(() => {
      void api(`/office/${node.id}/forcesave`, { method: 'POST', body: {} }).catch(() => undefined);
    }, 60_000);
    return () => window.clearInterval(timer);
  }, [node, isText]);

  async function saveText() {
    if (!node || text === null) return;
    setBusy(true);
    try {
      await api(`/uploads/text/${node.id}`, { method: 'PUT', body: { content: text } });
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Speichern fehlgeschlagen.');
    } finally {
      setBusy(false);
    }
  }

  if (error) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center">
        <p className="text-sm font-medium text-red-600">{error}</p>
        <button className="btn btn-ghost" onClick={() => navigate('#/files')}>
          <ArrowLeft className="h-4 w-4" /> Zurück zu den Dateien
        </button>
      </div>
    );
  }

  if (!node) {
    return (
      <div className="flex h-full items-center justify-center gap-2 text-sm text-muted">
        <Loader2 className="h-4 w-4 animate-spin" /> Datei wird geöffnet …
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center gap-2 border-b border-[var(--line)] px-4 py-2">
        <button className="btn btn-ghost !px-2 !py-1.5" onClick={() => navigate('#/files')} title="Zurück">
          <ArrowLeft className="h-4 w-4" />
        </button>
        <span className="truncate text-sm font-semibold">{node.name}</span>
        <span className="ml-auto flex items-center gap-2 text-[11px] text-muted">
          {isText ? (
            <>
              {saved && (
                <span className="flex items-center gap-1 text-[var(--accent)]">
                  <Check className="h-3 w-3" /> gespeichert
                </span>
              )}
              <button className="btn btn-primary !py-1 text-xs" onClick={() => void saveText()} disabled={busy}>
                {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />} Speichern
              </button>
            </>
          ) : (
            <span>{saved ? 'alle Änderungen gesichert' : 'wird gespeichert …'}</span>
          )}
        </span>
      </header>

      {isText ? (
        <textarea
          className="min-h-0 flex-1 resize-none border-0 bg-[var(--surface)] p-6 font-mono text-sm outline-none"
          value={text ?? ''}
          onChange={(e) => {
            setText(e.target.value);
            setSaved(false);
          }}
          onKeyDown={(e) => {
            if ((e.metaKey || e.ctrlKey) && e.key === 's') {
              e.preventDefault();
              void saveText();
            }
          }}
        />
      ) : (
        <div id={containerRef.current} className="min-h-0 flex-1" />
      )}
    </div>
  );
}
