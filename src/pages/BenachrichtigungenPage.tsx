/**
 * Benachrichtigungen — Karte und Verwaltung.
 *
 * Der Education-Planner hatte bis 26.11.2026 gar keinen Push-Kanal. Diese
 * Seite ist der einzige Ort, an dem das Gerät angemeldet wird und Tim sieht,
 * welche Arten an sind und was zuletzt rausging.
 *
 * Bewusst als eigene Seite (`#/benachrichtigungen`) statt in einer
 * Einstellungsseite: die gab es hier nicht, und eine leere Seite nur für ein
 * Kontrollkästchen wäre übertrieben.
 */

import { useEffect, useState } from 'react';
import { Bell, BellOff, Check, Loader2, Smartphone } from 'lucide-react';
import { Shell, PageHead } from '../components/Shell';
import { useAuth } from '../lib/auth';

type Status = { angemeldet: number; konfiguriert: boolean };
type Kategorie = { kategorie: string; titel: string; beschreibung: string; aktiv: boolean };
type Zeile = {
  kategorie: string;
  ereignis: string;
  titel: string;
  text: string;
  url: string | null;
  stand: string;
  grund: string | null;
  zeit: string;
};

const GRUND: Record<string, string> = {
  'kategorie-aus': 'Art ist ausgeschaltet',
  'ausserhalb-zeitfenster': 'nicht im Zeitfenster',
  ruhezeit: 'Ruhezeit (22–6 Uhr)',
  tageslimit: 'Tageslimit der Art erreicht',
  'kein-geraet': 'kein Gerät angemeldet',
};

function authHeader(): Record<string, string> {
  const t = localStorage.getItem('eduplanner.token') ?? localStorage.getItem('token');
  return t ? { Authorization: `Bearer ${t}` } : {};
}

function faehigkeit(): { moeglich: boolean; grund?: string } {
  if (typeof window === 'undefined') return { moeglich: false };
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
    return { moeglich: false, grund: 'Dieser Browser unterstützt kein Push.' };
  }
  const ios = /iPad|iPhone|iPod/.test(navigator.userAgent);
  const installiert =
    window.matchMedia('(display-mode: standalone)').matches ||
    (navigator as unknown as { standalone?: boolean }).standalone === true;
  if (ios && !installiert) {
    return {
      moeglich: false,
      grund: 'Auf dem iPhone erst über „Teilen → Zum Home-Bildschirm" installieren, dann funktioniert Push.',
    };
  }
  return { moeglich: true };
}

function schluesselAlsBytes(b64: string): BufferSource {
  const roh = atob(b64.replace(/-/g, '+').replace(/_/g, '/'));
  const arr = new Uint8Array(roh.length);
  for (let i = 0; i < roh.length; i += 1) arr[i] = roh.charCodeAt(i);
  return arr as unknown as BufferSource;
}

export function BenachrichtigungenPage() {
  const { user } = useAuth();
  const [status, setStatus] = useState<Status | null>(null);
  const [kategorien, setKategorien] = useState<Kategorie[]>([]);
  const [verlauf, setVerlauf] = useState<Zeile[]>([]);
  const [diesesGeraet, setDiesesGeraet] = useState(false);
  const [laeuft, setLaeuft] = useState(false);
  const [meldung, setMeldung] = useState<{ art: 'ok' | 'fehler'; text: string } | null>(null);

  const f = faehigkeit();

  const laden = async () => {
    try {
      const r = await fetch('/api/push', { headers: authHeader() });
      if (r.ok) setStatus((await r.json()) as Status);
    } catch {
      setStatus(null);
    }
    try {
      const reg = await navigator.serviceWorker.getRegistration();
      const sub = await reg?.pushManager.getSubscription();
      setDiesesGeraet(Boolean(sub));
    } catch {
      setDiesesGeraet(false);
    }
    try {
      const k = await fetch('/api/benachrichtigungen/kategorien', { headers: authHeader() });
      if (k.ok) setKategorien(((await k.json()) as { kategorien?: Kategorie[] }).kategorien ?? []);
    } catch {
      /* ohne Kategorien bleibt die Liste leer */
    }
    try {
      const v = await fetch('/api/benachrichtigungen/verlauf?limit=20', { headers: authHeader() });
      if (v.ok) setVerlauf(((await v.json()) as { verlauf?: Zeile[] }).verlauf ?? []);
    } catch {
      /* dito */
    }
  };

  useEffect(() => {
    void laden();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const anmelden = async () => {
    setLaeuft(true);
    setMeldung(null);
    try {
      const erlaubnis = await Notification.requestPermission();
      if (erlaubnis !== 'granted') {
        setMeldung({ art: 'fehler', text: 'Ohne Berechtigung können keine Nachrichten ankommen.' });
        return;
      }
      const reg = await navigator.serviceWorker.register('/sw.js', { scope: '/' });
      await navigator.serviceWorker.ready;
      const kr = await fetch('/api/push/key', { headers: authHeader() });
      const { publicKey } = (await kr.json()) as { publicKey?: string };
      if (!publicKey) throw new Error('Kein Schlüssel vom Server.');
      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: schluesselAlsBytes(publicKey),
      });
      const sr = await fetch('/api/push/subscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeader() },
        body: JSON.stringify({ subscription: sub.toJSON(), geraet: navigator.userAgent.slice(0, 60) }),
      });
      if (!sr.ok) throw new Error('Server hat die Anmeldung abgelehnt.');
      setDiesesGeraet(true);
      await laden();
      setMeldung({ art: 'ok', text: 'Dieses Gerät ist angemeldet.' });
    } catch (e) {
      setMeldung({ art: 'fehler', text: e instanceof Error ? e.message : 'Anmelden fehlgeschlagen.' });
    } finally {
      setLaeuft(false);
    }
  };

  const testen = async () => {
    setLaeuft(true);
    setMeldung(null);
    try {
      const r = await fetch('/api/push/test', { method: 'POST', headers: authHeader() });
      const d = (await r.json()) as { ok?: boolean; fehler?: string };
      setMeldung(
        d.ok
          ? { art: 'ok', text: 'Testnachricht ist raus — schau aufs Handy.' }
          : { art: 'fehler', text: d.fehler ?? 'Versand fehlgeschlagen.' },
      );
    } catch {
      setMeldung({ art: 'fehler', text: 'Test fehlgeschlagen.' });
    } finally {
      setLaeuft(false);
    }
  };

  const abmelden = async () => {
    setLaeuft(true);
    try {
      const reg = await navigator.serviceWorker.getRegistration();
      const sub = await reg?.pushManager.getSubscription();
      if (sub) {
        await fetch('/api/push/unsubscribe', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...authHeader() },
          body: JSON.stringify({ endpoint: sub.endpoint }),
        });
        await sub.unsubscribe();
      }
      setDiesesGeraet(false);
      await laden();
      setMeldung({ art: 'ok', text: 'Dieses Gerät ist abgemeldet.' });
    } catch {
      setMeldung({ art: 'fehler', text: 'Abmelden fehlgeschlagen.' });
    } finally {
      setLaeuft(false);
    }
  };

  const umschalten = async (kategorie: string, aktiv: boolean) => {
    setKategorien((alt) => alt.map((k) => (k.kategorie === kategorie ? { ...k, aktiv } : k)));
    try {
      const r = await fetch('/api/benachrichtigungen/kategorien', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeader() },
        body: JSON.stringify({ kategorie, aktiv }),
      });
      if (!r.ok) throw new Error('abgelehnt');
    } catch {
      setKategorien((alt) => alt.map((k) => (k.kategorie === kategorie ? { ...k, aktiv: !aktiv } : k)));
      setMeldung({ art: 'fehler', text: 'Einstellung konnte nicht gespeichert werden.' });
    }
  };

  return (
    <Shell tab="files">
      <div className="mx-auto max-w-3xl overflow-y-auto px-4 py-6">
        <PageHead title="Benachrichtigungen" hint={`Für ${user?.name ?? 'dein Konto'}`} eyebrow="Konto" />

        <div className="mt-5 flex flex-col gap-4">
          {/* ── Gerät ───────────────────────────────────────────────────── */}
          <section className="card p-4">
            <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted">
              <Bell className="h-3 w-3" /> Dieses Gerät
              {diesesGeraet && (
                <span className="ml-1 inline-flex items-center gap-1 rounded-full bg-[var(--accent-soft)] px-2 py-0.5 text-[10px] font-bold normal-case tracking-normal text-[var(--accent)]">
                  <Check className="h-2.5 w-2.5" /> aktiv
                </span>
              )}
            </p>

            {!f.moeglich ? (
              <p className="mt-2 flex items-start gap-2 rounded-lg bg-[var(--bg-soft)] px-2.5 py-2 text-[12px] text-muted">
                <Smartphone className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                {f.grund}
              </p>
            ) : (
              <>
                <div className="mt-3 flex flex-wrap gap-2">
                  {!diesesGeraet ? (
                    <button className="btn btn-primary !px-3 !py-1.5 text-[12px]" onClick={() => void anmelden()} disabled={laeuft}>
                      {laeuft ? <Loader2 className="h-3 w-3 animate-spin" /> : <Bell className="h-3 w-3" />}
                      Dieses Gerät anmelden
                    </button>
                  ) : (
                    <>
                      <button className="btn btn-primary !px-3 !py-1.5 text-[12px]" onClick={() => void testen()} disabled={laeuft}>
                        {laeuft ? <Loader2 className="h-3 w-3 animate-spin" /> : <Bell className="h-3 w-3" />}
                        Testnachricht
                      </button>
                      <button className="btn btn-ghost !px-3 !py-1.5 text-[12px]" onClick={() => void abmelden()} disabled={laeuft}>
                        <BellOff className="h-3 w-3" /> Abmelden
                      </button>
                    </>
                  )}
                </div>
                {status && status.angemeldet > 0 && (
                  <p className="mt-2 text-[11px] text-muted">
                    {status.angemeldet} {status.angemeldet === 1 ? 'Gerät' : 'Geräte'} angemeldet.
                  </p>
                )}
              </>
            )}

            {meldung && (
              <p
                className="mt-2 rounded-lg px-2.5 py-1.5 text-[11.5px]"
                style={{
                  background: meldung.art === 'ok' ? 'var(--accent-soft)' : 'var(--danger-soft, #fbecea)',
                  color: meldung.art === 'ok' ? 'var(--accent)' : 'var(--danger, #b4453a)',
                }}
              >
                {meldung.text}
              </p>
            )}
          </section>

          {/* ── Arten ───────────────────────────────────────────────────── */}
          {kategorien.length > 0 && (
            <section className="card p-4">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-muted">Was du bekommst</p>
              <div className="mt-2 flex flex-col">
                {kategorien.map((k) => (
                  <label
                    key={k.kategorie}
                    className="flex cursor-pointer items-start gap-2.5 border-b border-[var(--line)] py-2 last:border-b-0"
                  >
                    <input
                      type="checkbox"
                      checked={k.aktiv}
                      onChange={(e) => void umschalten(k.kategorie, e.target.checked)}
                      className="mt-0.5 h-4 w-4 shrink-0 cursor-pointer accent-[var(--accent)]"
                    />
                    <span className="min-w-0">
                      <span className="block text-[12.5px] font-semibold">{k.titel}</span>
                      <span className="block text-[11px] leading-snug text-muted">{k.beschreibung}</span>
                    </span>
                  </label>
                ))}
              </div>
              <p className="mt-2 text-[10.5px] leading-snug text-muted">
                Ruhezeit 22–6 Uhr. Höchstens sechs Meldungen je Art und Tag. Dringendes (Freigaben) geht immer durch.
              </p>
            </section>
          )}

          {/* ── Verlauf ─────────────────────────────────────────────────── */}
          {verlauf.length > 0 && (
            <section className="card p-4">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-muted">Zuletzt gesendet</p>
              <div className="mt-2 flex flex-col gap-1.5">
                {verlauf.map((v, i) => {
                  const ok = v.stand === 'gesendet';
                  return (
                    <div
                      key={`${v.zeit}-${v.ereignis}-${i}`}
                      className="rounded-lg bg-[var(--bg-soft)] px-2.5 py-2"
                      style={{ opacity: ok ? 1 : 0.72 }}
                    >
                      <div className="flex items-baseline justify-between gap-2">
                        <span className="text-[12px] font-semibold">{v.titel}</span>
                        <span className="shrink-0 text-[10px] text-muted">{v.zeit}</span>
                      </div>
                      <p className="mt-0.5 text-[11px] leading-snug text-muted">{v.text}</p>
                      {!ok && (
                        <p className="mt-1 text-[10px] font-semibold" style={{ color: 'var(--danger, #b4453a)' }}>
                          nicht zugestellt: {v.grund ? (GRUND[v.grund] ?? v.grund) : 'unbekannt'}
                        </p>
                      )}
                    </div>
                  );
                })}
              </div>
            </section>
          )}
        </div>
      </div>
    </Shell>
  );
}
