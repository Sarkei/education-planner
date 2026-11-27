import { useCallback, useEffect, useRef, useState } from 'react';
import { Bot, ChevronRight, Loader2, Send, Sparkles, Trash2, Wrench, X } from 'lucide-react';
import { api } from '../lib/api';

type Schritt =
  | { art: 'text'; text: string }
  | { art: 'werkzeug'; name: string; argumente: Record<string, unknown>; ergebnis: string; ok: boolean };

type Nachricht = { rolle: 'nutzer' | 'assistent'; text: string; schritte?: Schritt[] };

const VORSCHLAEGE = [
  'Was liegt alles in meinen Unterlagen?',
  'Fasse mir die Netzwerktechnik-Unterlagen zusammen',
  'Lege einen Ordner „LF5 – IT-Systeme" an',
  'Fülle das Arbeitsblatt aus, wo etwas fehlt',
];

/** Ausklappbarer KI-Chat. Arbeitet mit Werkzeugen auf allen Dateien. */
export function AssistentChat({ offen, onSchliessen, onDateiAendert }: {
  offen: boolean;
  onSchliessen: () => void;
  onDateiAendert?: () => void;
}) {
  const [nachrichten, setNachrichten] = useState<Nachricht[]>([]);
  const [eingabe, setEingabe] = useState('');
  const [laeuft, setLaeuft] = useState(false);
  const [fehler, setFehler] = useState<string | null>(null);
  const [status, setStatus] = useState<{ bereit: boolean; anbieter: string | null; modell: string | null } | null>(null);
  const unten = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!offen) return;
    void api<{ bereit: boolean; anbieter: string | null; modell: string | null }>('/assistent/status')
      .then(setStatus)
      .catch(() => setStatus(null));
    void api<{ nachrichten: Array<{ rolle: string; inhalt: string }> }>('/assistent/verlauf')
      .then((d) =>
        setNachrichten(
          d.nachrichten.map((n) => ({ rolle: n.rolle === 'nutzer' ? 'nutzer' : 'assistent', text: n.inhalt })),
        ),
      )
      .catch(() => undefined);
  }, [offen]);

  useEffect(() => {
    unten.current?.scrollIntoView({ behavior: 'smooth' });
  }, [nachrichten, laeuft]);

  const senden = useCallback(
    async (text: string) => {
      const frage = text.trim();
      if (!frage || laeuft) return;
      setEingabe('');
      setFehler(null);
      setNachrichten((prev) => [...prev, { rolle: 'nutzer', text: frage }]);
      setLaeuft(true);
      try {
        const antwort = await api<{ schritte: Schritt[]; fehler: string | null }>('/assistent/frage', {
          body: { frage },
        });
        const erklaerung = antwort.schritte
          .filter((s): s is Extract<Schritt, { art: 'text' }> => s.art === 'text')
          .map((s) => s.text)
          .join('\n\n');
        const werkzeuge = antwort.schritte.filter((s): s is Extract<Schritt, { art: 'werkzeug' }> => s.art === 'werkzeug');
        setNachrichten((prev) => [
          ...prev,
          { rolle: 'assistent', text: erklaerung || (werkzeuge.length ? '' : 'Fertig.'), schritte: werkzeuge },
        ]);
        if (antwort.fehler) setFehler(antwort.fehler);
        // Dateien haben sich geändert -> Baum neu laden
        if (werkzeuge.some((w) => w.ok)) onDateiAendert?.();
      } catch (e) {
        setFehler(e instanceof Error ? e.message : 'Der Assistent antwortet nicht.');
      } finally {
        setLaeuft(false);
      }
    },
    [laeuft, onDateiAendert],
  );

  async function verlaufLeeren() {
    if (!confirm('Verlauf des Assistenten löschen?')) return;
    try {
      await api('/assistent/verlauf', { method: 'DELETE' });
      setNachrichten([]);
    } catch {
      /* still */
    }
  }

  if (!offen) return null;

  return (
    <>
      {/* Mobil: Overlay über dem Inhalt, damit nichts verdeckt bleibt */}
      <div className="fixed inset-0 z-40 bg-black/50 md:hidden" onClick={onSchliessen} />
      <aside className="fixed inset-y-0 right-0 z-50 flex w-[92vw] max-w-sm flex-col border-l border-[var(--line)] bg-[var(--bg-soft)] md:static md:z-auto md:w-[22rem] md:max-w-none md:shrink-0 xl:w-[26rem]">
      <header className="flex items-center gap-2 border-b border-[var(--line)] px-3 py-2">
        <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-[var(--accent-soft)]">
          <Sparkles className="h-3.5 w-3.5 text-[var(--accent)]" />
        </div>
        <div className="min-w-0">
          <p className="text-[12.5px] font-semibold leading-tight">Assistent</p>
          <p className="truncate text-[10.5px] text-muted">
            {status?.bereit ? `${status.anbieter} · ${status.modell}` : status ? 'kein Anbieter eingerichtet' : 'prüfe …'}
          </p>
        </div>
        <button className="btn btn-ghost ml-auto !px-1.5 !py-1" onClick={verlaufLeeren} title="Verlauf löschen">
          <Trash2 className="h-3.5 w-3.5" />
        </button>
        <button className="btn btn-ghost !px-1.5 !py-1" onClick={onSchliessen} title="Chat schließen">
          <X className="h-3.5 w-3.5" />
        </button>
      </header>

      <div className="scroll-thin min-h-0 flex-1 space-y-3 overflow-auto p-3">
        {nachrichten.length === 0 && (
          <div className="space-y-2">
            <p className="text-[12px] text-muted">
              Ich sehe alle deine Ordner und Dateien und kann sie lesen, durchsuchen, anlegen, verschieben, umbenennen,
              löschen und PDFs ausfüllen.
            </p>
            <div className="space-y-1.5">
              {VORSCHLAEGE.map((v) => (
                <button
                  key={v}
                  className="w-full rounded-xl border border-[var(--line)] bg-[var(--card)] px-2.5 py-2 text-left text-[11.5px] transition hover:border-[var(--accent)]"
                  onClick={() => void senden(v)}
                >
                  <ChevronRight className="mr-1 inline h-3 w-3 text-muted" />
                  {v}
                </button>
              ))}
            </div>
          </div>
        )}

        {nachrichten.map((n, i) => (
          <div key={i} className={n.rolle === 'nutzer' ? 'flex justify-end' : ''}>
            {n.rolle === 'nutzer' ? (
              <p className="max-w-[85%] rounded-2xl rounded-br-sm bg-[var(--accent)] px-3 py-2 text-[12px] text-[var(--on-accent)]">
                {n.text}
              </p>
            ) : (
              <div className="space-y-1.5">
                {n.schritte?.map((s, j) =>
                  s.art === 'werkzeug' ? (
                    <details
                      key={j}
                      className="rounded-xl border border-[var(--line)] bg-[var(--card)] px-2.5 py-1.5 text-[11px]"
                    >
                      <summary className="flex cursor-pointer items-center gap-1.5 text-muted">
                        <Wrench className={`h-3 w-3 ${s.ok ? 'text-[var(--accent)]' : 'text-[var(--danger)]'}`} />
                        <span className="font-medium">{s.name}</span>
                        <span className="truncate">
                          {Object.values(s.argumente ?? {})
                            .filter((v) => typeof v === 'string')
                            .slice(0, 2)
                            .join(' · ')
                            .slice(0, 40)}
                        </span>
                      </summary>
                      <pre className="mt-1 whitespace-pre-wrap break-words text-[10.5px] text-muted">
                        {s.ergebnis.slice(0, 1200)}
                      </pre>
                    </details>
                  ) : null,
                )}
                {n.text && (
                  <p className="whitespace-pre-wrap rounded-2xl rounded-bl-sm border border-[var(--line)] bg-[var(--card)] px-3 py-2 text-[12px]">
                    {n.text}
                  </p>
                )}
              </div>
            )}
          </div>
        ))}

        {laeuft && (
          <p className="flex items-center gap-2 text-[11.5px] text-muted">
            <Loader2 className="h-3.5 w-3.5 animate-spin" /> arbeitet …
          </p>
        )}

        {fehler && <p className="rounded-xl bg-[var(--danger)]/10 px-2.5 py-2 text-[11px] text-[var(--danger)]">{fehler}</p>}
        <div ref={unten} />
      </div>

      <div className="border-t border-[var(--line)] p-2.5">
        <div className="flex items-end gap-1.5">
          <textarea
            className="scroll-thin max-h-32 min-h-[2.4rem] flex-1 resize-none rounded-xl border border-[var(--line)] bg-[var(--card)] px-2.5 py-2 text-[12px] outline-none focus:border-[var(--accent)]"
            placeholder="Frage stellen oder Auftrag geben …"
            rows={1}
            value={eingabe}
            onChange={(e) => setEingabe(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                void senden(eingabe);
              }
            }}
            disabled={laeuft || status?.bereit === false}
          />
          <button
            className="btn btn-primary !px-2.5 !py-2"
            onClick={() => void senden(eingabe)}
            disabled={laeuft || !eingabe.trim() || status?.bereit === false}
            title="Senden"
          >
            {laeuft ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
          </button>
        </div>
        {status && !status.bereit && (
          <p className="mt-1.5 text-[10.5px] text-[var(--danger)]">
            Kein KI-Anbieter eingerichtet — DEEPSEEK_API_KEY in der .env setzen.
          </p>
        )}
      </div>
      </aside>
    </>
  );
}

/** Kleiner Knopf, um den Chat aufzuziehen. */
export function AssistentKnopf({ onClick, versteckt }: { onClick: () => void; versteckt: boolean }) {
  if (versteckt) return null;
  return (
    <button className="btn btn-ghost !px-2 !py-1 text-xs" onClick={onClick} title="KI-Assistent öffnen">
      <Bot className="h-3.5 w-3.5" /> Assistent
    </button>
  );
}
