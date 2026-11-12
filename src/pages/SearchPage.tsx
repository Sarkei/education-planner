import { useEffect, useRef, useState } from 'react';
import { FileText, Folder, Loader2, Search } from 'lucide-react';
import { api } from '../lib/api';
import { navigate } from '../App';
import { EmptyState, PageHead, Shell } from '../components/Shell';

type Hit = {
  id: string;
  name: string;
  kind: 'folder' | 'file';
  parentId: string | null;
  mime: string | null;
  size: number;
  match: 'name' | 'content';
  snippet: string | null;
};

export function SearchPage() {
  const [query, setQuery] = useState('');
  const [hits, setHits] = useState<Hit[]>([]);
  const [busy, setBusy] = useState(false);
  const [searched, setSearched] = useState(false);
  const [pending, setPending] = useState(0);
  const timer = useRef<number | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    if (timer.current) window.clearTimeout(timer.current);
    if (query.trim().length < 2) {
      setHits([]);
      setSearched(false);
      return;
    }
    timer.current = window.setTimeout(async () => {
      setBusy(true);
      try {
        const data = await api<{ results: Hit[]; pending?: number }>(`/search?q=${encodeURIComponent(query.trim())}`);
        setHits(data.results);
        setPending(data.pending ?? 0);
        setSearched(true);
      } catch {
        setHits([]);
      } finally {
        setBusy(false);
      }
    }, 300);
    return () => {
      if (timer.current) window.clearTimeout(timer.current);
    };
  }, [query]);

  return (
    <Shell tab="search">
      <div className="scroll-thin h-full overflow-auto p-4">
        <div className="mx-auto max-w-3xl">
          <PageHead eyebrow="Finden" title="Suche" hint="Dateinamen und Volltext in Word, Excel, PowerPoint, PDF und Textdateien — im eigenen Bestand und in Freigaben." />

          <div className="relative mb-4">
            <Search className="pointer-events-none absolute left-3 top-3 h-4 w-4 text-muted" />
            <input
              ref={inputRef}
              className="input !py-2.5 !pl-9"
              placeholder="z. B. Netzwerke, Präsentation, LF4 …"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            {busy && <Loader2 className="absolute right-3 top-3 h-4 w-4 animate-spin text-muted" />}
          </div>

          {pending > 0 && (
            <p className="mb-3 rounded-xl bg-[var(--accent-soft)] px-3 py-2 text-[12px] text-muted">
              {pending} {pending === 1 ? 'Datei wird' : 'Dateien werden'} noch für die Volltextsuche aufbereitet — sie
              erscheinen in den nächsten Minuten.
            </p>
          )}

          {query.trim().length < 2 ? (
            <p className="text-[13px] text-muted">Mindestens zwei Zeichen eingeben.</p>
          ) : hits.length === 0 && searched && !busy ? (
            <EmptyState title="Nichts gefunden" hint={`Kein Treffer für „${query.trim()}“. Andere Schreibweise probieren?`} />
          ) : (
            <div className="space-y-1.5">
              {hits.map((hit) => (
                <div
                  key={`${hit.id}-${hit.match}`}
                  className="row-item"
                  onClick={() => (hit.kind === 'folder' ? navigate('#/files') : navigate(`#/edit/${hit.id}`))}
                >
                  {hit.kind === 'folder' ? <Folder className="h-[18px] w-[18px] text-[var(--accent)]" /> : <FileText className="h-[18px] w-[18px] text-muted" />}
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[13.5px] font-medium">{hit.name}</p>
                    <p className="truncate text-[11px] text-muted">
                      {hit.match === 'content' ? hit.snippet : hit.kind === 'folder' ? 'Ordner' : 'Dateiname'}
                    </p>
                  </div>
                  {hit.match === 'content' && <span className="badge shrink-0">im Text</span>}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </Shell>
  );
}
