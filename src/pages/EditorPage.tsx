import { useEffect, useRef, useState } from 'react';
import { ArrowLeft, Check, Download, Loader2, Save, ShieldAlert } from 'lucide-react';
import { api, getToken } from '../lib/api';
import { navigate } from '../App';
import type { NodeItem } from '../lib/types';

type OfficeConfig = { documentServerUrl: string; config: Record<string, unknown> };

declare global {
  interface Window {
    DocsAPI?: { DocEditor: new (id: string, config: Record<string, unknown>) => { destroyEditor: () => void } };
  }
}

const TEXT_EXT = [
  'txt', 'md', 'csv', 'tsv', 'json', 'xml', 'html', 'htm', 'css', 'js', 'ts', 'yml', 'yaml',
  'ini', 'cfg', 'conf', 'sh', 'bat', 'ps1', 'sql', 'log', 'tex', 'srt', 'vtt',
];
const IMAGE_EXT = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg', 'ico', 'avif', 'tif', 'tiff'];
const AUDIO_EXT = ['mp3', 'wav', 'ogg', 'oga', 'm4a', 'flac', 'aac'];
const VIDEO_EXT = ['mp4', 'webm', 'mov', 'm4v', 'mkv'];

export function EditorPage({ nodeId }: { nodeId: string }) {
  const [node, setNode] = useState<NodeItem | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(true);
  const [text, setText] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const editorRef = useRef<{ destroyEditor: () => void } | null>(null);
  const containerId = useRef(`office-${Math.random().toString(36).slice(2)}`);

  const ext = node?.name.split('.').pop()?.toLowerCase() ?? '';
  const isText = TEXT_EXT.includes(ext);
  const isImage = IMAGE_EXT.includes(ext);
  const isAudio = AUDIO_EXT.includes(ext);
  const isVideo = VIDEO_EXT.includes(ext);
  const isPdf = ext === 'pdf';
  const isOffice = !isText && !isImage && !isAudio && !isVideo && !isPdf;

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const data = await api<{ node: NodeItem }>(`/nodes/${nodeId}`);
        if (!cancelled) setNode(data.node);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Datei nicht gefunden.');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [nodeId]);

  // Textdateien direkt im Browser
  useEffect(() => {
    if (!node || !isText) return;
    void (async () => {
      try {
        const res = await fetch(`/api/search/preview/${node.id}`, {
          headers: { Authorization: `Bearer ${getToken() ?? ''}` },
        });
        setText(await res.text());
      } catch {
        setText('');
      }
    })();
  }, [node, isText]);

  // Vorschau-Link für Bilder und PDFs (Token im Query, weil iframe/img keinen Header senden)
  useEffect(() => {
    if (!node || (!isImage && !isPdf && !isAudio && !isVideo)) return;
    void api<{ url: string }>(`/nodes/${node.id}/preview-token`, { method: 'POST', body: {} })
      .then((d) => setPreviewUrl(d.url))
      .catch(() => setPreviewUrl(null));
  }, [node, isImage, isPdf, isAudio, isVideo]);

  // Office-Dokumente in ONLYOFFICE
  useEffect(() => {
    if (!node || !isOffice) return;
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
        editorRef.current = new window.DocsAPI.DocEditor(containerId.current, config);
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
  }, [node?.id, isOffice]);

  // Alle 60 Sekunden zwischenspeichern
  useEffect(() => {
    if (!node || !isOffice) return;
    const timer = window.setInterval(() => {
      void api(`/office/${node.id}/forcesave`, { method: 'POST', body: {} }).catch(() => undefined);
    }, 60_000);
    return () => window.clearInterval(timer);
  }, [node, isOffice]);

  async function saveText() {
    if (!node || text === null) return;
    setBusy(true);
    try {
      await api(`/uploads/text/${node.id}`, { method: 'PUT', body: { content: text } });
      setSaved(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Speichern fehlgeschlagen.');
    } finally {
      setBusy(false);
    }
  }

  if (error) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center">
        <ShieldAlert className="h-6 w-6 text-[var(--danger)]" />
        <p className="text-sm font-medium text-[var(--danger)]">{error}</p>
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

  const canEdit = node.permission !== 'view';

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center gap-2 border-b border-[var(--line)] px-4 py-2.5">
        <button className="btn btn-ghost !px-2 !py-1.5" onClick={() => navigate('#/files')} title="Zurück">
          <ArrowLeft className="h-4 w-4" />
        </button>
        <div className="min-w-0">
          <p className="truncate text-[13.5px] font-semibold">{node.name}</p>
          <p className="text-[11px] text-muted">
            {canEdit ? 'bearbeitbar' : 'nur ansehen'} · Version {node.version}
          </p>
        </div>
        <div className="ml-auto flex items-center gap-2 text-[11px] text-muted">
          {isText ? (
            <>
              {saved && (
                <span className="flex items-center gap-1 text-[var(--accent)]">
                  <Check className="h-3 w-3" /> gespeichert
                </span>
              )}
              <button className="btn btn-primary !py-1 text-xs" onClick={() => void saveText()} disabled={busy || !canEdit}>
                {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />} Speichern
              </button>
            </>
          ) : isOffice ? (
            <span>{saved ? 'alle Änderungen gesichert' : 'wird gespeichert …'}</span>
          ) : (
            <span>{isPdf ? 'PDF-Ansicht' : isImage ? 'Bild' : isAudio ? 'Audio' : isVideo ? 'Video' : 'Vorschau'}</span>
          )}
          <a
            className="btn btn-ghost !px-2 !py-1"
            href={`/api/nodes/${node.id}/download`}
            onClick={async (e) => {
              e.preventDefault();
              const res = await fetch(`/api/nodes/${node.id}/download`, {
                headers: { Authorization: `Bearer ${getToken() ?? ''}` },
              });
              const blob = await res.blob();
              const url = URL.createObjectURL(blob);
              const a = document.createElement('a');
              a.href = url;
              a.download = node.name;
              a.click();
              URL.revokeObjectURL(url);
            }}
            title="Herunterladen"
          >
            <Download className="h-3.5 w-3.5" />
          </a>
        </div>
      </header>

      {isText ? (
        <textarea
          className="scroll-thin min-h-0 flex-1 resize-none border-0 bg-[var(--bg)] p-6 font-mono text-[13px] leading-relaxed outline-none"
          value={text ?? ''}
          readOnly={!canEdit}
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
      ) : isImage ? (
        <div className="flex min-h-0 flex-1 items-center justify-center overflow-auto bg-[var(--bg-soft)] p-6">
          {previewUrl ? (
            <img src={previewUrl} alt={node.name} className="max-h-full max-w-full rounded-xl" />
          ) : (
            <Loader2 className="h-5 w-5 animate-spin text-muted" />
          )}
        </div>
      ) : isPdf ? (
        previewUrl ? (
          <iframe src={previewUrl} title={node.name} className="min-h-0 flex-1 border-0 bg-[var(--bg-soft)]" />
        ) : (
          <div className="flex flex-1 items-center justify-center">
            <Loader2 className="h-5 w-5 animate-spin text-muted" />
          </div>
        )
      ) : isAudio ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-4 p-6">
          {previewUrl ? <audio src={previewUrl} controls className="w-full max-w-md" /> : <Loader2 className="h-5 w-5 animate-spin text-muted" />}
          <p className="text-[12px] text-muted">{node.name}</p>
        </div>
      ) : isVideo ? (
        <div className="flex min-h-0 flex-1 items-center justify-center bg-black p-2">
          {previewUrl ? (
            <video src={previewUrl} controls className="max-h-full max-w-full rounded-lg" />
          ) : (
            <Loader2 className="h-5 w-5 animate-spin text-muted" />
          )}
        </div>
      ) : isOffice ? (
        <div id={containerId.current} className="min-h-0 flex-1" />
      ) : (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 p-6 text-center">
          <ShieldAlert className="h-6 w-6 text-muted" />
          <p className="text-sm font-medium">Für diesen Dateityp gibt es keine Vorschau</p>
          <p className="max-w-sm text-[12px] text-muted">
            {node.name} lässt sich herunterladen und auf dem Rechner öffnen.
          </p>
        </div>
      )}
    </div>
  );
}
