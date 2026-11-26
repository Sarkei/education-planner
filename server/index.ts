import 'dotenv/config';
import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { initDb, pool } from './db';
import { attachUser, fail } from './guards';
import { authRouter } from './auth';
import { nodesRouter } from './nodes';
import { uploadsRouter } from './uploads';
import { sharesRouter } from './shares';
import { officeRouter } from './onlyoffice';
import { searchRouter } from './search';
import { startIndexer } from './indexer';
import { ensureDirs } from './storage';
import { pushRouter, sendePushAnNutzer } from './push-route';
import { benachrichtige, benachrichtigungsRouter } from './benachrichtigungen';

/** Versand an einen Nutzer in der Form, die `benachrichtige` erwartet. */
const sendeAn =
  (nutzerId: number | string) =>
  (n: { titel: string; text: string; url?: string; tag?: string; dringend?: boolean }) =>
    sendePushAnNutzer(pool, nutzerId, n);

process.on('unhandledRejection', (reason) => {
  console.error('unhandledRejection', reason);
});
process.on('uncaughtException', (error) => {
  console.error('uncaughtException', error);
});

const app = express();
app.use(express.json({ limit: '2mb' }));

const dist = path.join(process.cwd(), 'dist');

app.get('/api/health', async (_req, res) => {
  try {
    await pool.query('SELECT 1');
    res.json({ ok: true, storage: fs.existsSync(process.env.FILES_ROOT || '/data/files') });
  } catch (e) {
    res.status(500).json({ ok: false, error: e instanceof Error ? e.message : 'db' });
  }
});

app.use('/api', attachUser);
app.use('/api/auth', authRouter);

/*
 * Web Push: Gerät anmelden, abmelden, testen.
 * Der Education-Planner hatte bis 26.11. gar keinen Push-Kanal.
 */
app.use(
  '/api/push',
  pushRouter(pool as never, (req) => (req as { userId?: number }).userId ?? null, 'Education'),
);

/* Kategorien, Ruhezeit und Verlauf der Benachrichtigungen. */
app.use(
  '/api/benachrichtigungen',
  benachrichtigungsRouter(pool as never, (req) => (req as { userId?: number }).userId ?? null),
);
app.use('/api/nodes', nodesRouter);
app.use('/api/uploads', uploadsRouter);
app.use('/api/shares', sharesRouter);
app.use('/api/search', searchRouter);
app.use('/api', officeRouter);

app.use('/api', (_req, res) => {
  fail(res, 404, 'not-found', 'Unbekannter Endpunkt.');
});

if (fs.existsSync(dist)) {
  app.use(express.static(dist, { index: false, maxAge: '1h' }));
  app.get('*', (_req, res) => {
    res.sendFile(path.join(dist, 'index.html'));
  });
}

const port = Number(process.env.PORT || 3000);

/**
 * Täglicher Takt: Dateien im Papierkorb.
 *
 * Der Education-Planner hatte keinen Push-Kanal; wer eine Datei in den
 * Papierkorb legte, erinnerte sich eine Woche später nicht mehr daran. Diese
 * Meldung nennt Zahl und ältestes Datum, damit vor dem endgültigen Löschen
 * noch etwas passiert.
 */
async function educationTick(): Promise<void> {
  const teile = new Intl.DateTimeFormat('de-DE', {
    hour: '2-digit', year: 'numeric', month: '2-digit', day: '2-digit',
    hour12: false, timeZone: 'Europe/Berlin',
  }).formatToParts(new Date());
  const wert = (t: string) => teile.find((x) => x.type === t)?.value ?? '0';
  const stunde = Number(wert('hour')) % 24;
  const heute = `${wert('year')}-${wert('month')}-${wert('day')}`;

  // Sonntags 18 Uhr: Papierkorb-Rückblick
  const wochentag = new Date(`${heute}T12:00:00Z`).getUTCDay();
  if (!(wochentag === 0 && stunde >= 17 && stunde <= 20)) return;

  try {
    const r = await pool.query<{ owner_id: number; n: string; aeltestes: string | null }>(
      `SELECT owner_id, COUNT(*)::text AS n,
              to_char(MIN(trashed_at) AT TIME ZONE 'Europe/Berlin', 'DD.MM.YYYY') AS aeltestes
         FROM nodes WHERE trashed_at IS NOT NULL AND kind = 'file'
        GROUP BY owner_id`,
    );
    for (const z of r.rows) {
      await benachrichtige(pool, sendeAn(z.owner_id), z.owner_id, {
        kategorie: 'erinnerung',
        ereignis: 'papierkorb',
        schluessel: heute,
        titel: 'Im Papierkorb liegt noch etwas',
        text: `${z.n} ${Number(z.n) === 1 ? 'Datei' : 'Dateien'}${z.aeltestes ? `, älteste seit ${z.aeltestes}` : ''}. Wiederherstellen oder endgültig löschen.`,
        url: 'https://education.nas-timgreen.com/#/trash',
        tag: 'papierkorb',
        rhythmus: 'abend',
      });
    }
  } catch (e) {
    console.error('[push] Papierkorb-Erinnerung:', (e as Error).message);
  }
}

async function start(): Promise<void> {
  ensureDirs();
  await initDb();
  startIndexer();
  app.listen(port, () => {
    console.log(`education-planner läuft auf :${port}`);
  });
  const t = setInterval(() => void educationTick(), 30 * 60_000);
  t.unref?.();
  setTimeout(() => void educationTick(), 90_000).unref?.();
}

void start().catch((e) => {
  console.error('Start fehlgeschlagen', e);
  process.exit(1);
});
