import { Router } from 'express';
import { requireAuth, fail, type AuthRequest } from './guards';
import { agentLauf, resolveProvider, WERKZEUGE } from './assistent';
import { pool } from './db';

export const assistentRouter = Router();

/** Tabelle beim Start anlegen, falls sie fehlt. */
let tabelleBereit = false;
async function stelleTabelleSicher(): Promise<void> {
  if (tabelleBereit) return;
  await pool.query(
    `CREATE TABLE IF NOT EXISTS assistent_nachrichten (
        id          BIGSERIAL PRIMARY KEY,
        user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        rolle       TEXT    NOT NULL,
        inhalt      TEXT    NOT NULL DEFAULT '',
        erstellt_am TIMESTAMPTZ NOT NULL DEFAULT now()
     )`,
  );
  await pool.query(
    'CREATE INDEX IF NOT EXISTS assistent_nachrichten_user_idx ON assistent_nachrichten (user_id, id DESC)',
  );
  tabelleBereit = true;
}

/** Zustand: ist ein KI-Provider eingerichtet, welche Werkzeuge gibt es? */
assistentRouter.get('/status', requireAuth, (_req: AuthRequest, res) => {
  const cfg = resolveProvider();
  res.json({
    bereit: Boolean(cfg),
    anbieter: cfg?.name ?? null,
    modell: cfg?.model ?? null,
    werkzeuge: WERKZEUGE.map((w) => ({ name: w.name, beschreibung: w.beschreibung })),
  });
});

/** Verlauf eines Nutzers laden. */
assistentRouter.get('/verlauf', requireAuth, async (req: AuthRequest, res) => {
  await stelleTabelleSicher();
  const { rows } = await pool.query(
    `SELECT id, rolle, inhalt, erstellt_am FROM assistent_nachrichten
      WHERE user_id = $1 ORDER BY id DESC LIMIT 60`,
    [req.userId],
  );
  res.json({ nachrichten: rows.reverse() });
});

/** Verlauf leeren. */
assistentRouter.delete('/verlauf', requireAuth, async (req: AuthRequest, res) => {
  await stelleTabelleSicher();
  await pool.query('DELETE FROM assistent_nachrichten WHERE user_id = $1', [req.userId]);
  res.json({ ok: true });
});

/** Eine Frage an den Assistenten; führt Werkzeuge aus und liefert alle Schritte. */
assistentRouter.post('/frage', requireAuth, async (req: AuthRequest, res) => {
  const frage = String((req.body as { frage?: unknown })?.frage ?? '').trim();
  if (!frage) {
    fail(res, 400, 'leer', 'Die Frage fehlt.');
    return;
  }
  if (frage.length > 8000) {
    fail(res, 400, 'zu-lang', 'Die Frage ist zu lang (max. 8000 Zeichen).');
    return;
  }

  await stelleTabelleSicher();

  // Verlauf der letzten Runden mitgeben, damit Rückfragen funktionieren
  const { rows } = await pool.query<{ rolle: string; inhalt: string }>(
    `SELECT rolle, inhalt FROM assistent_nachrichten WHERE user_id = $1 ORDER BY id DESC LIMIT 12`,
    [req.userId],
  );
  const verlauf = rows
    .reverse()
    .map((r) => ({ role: r.rolle === 'assistent' ? 'assistant' : 'user', content: r.inhalt }));

  try {
    const ergebnis = await agentLauf(frage, req.userId!, verlauf);

    // Frage und Antwort sichern
    await pool.query('INSERT INTO assistent_nachrichten (user_id, rolle, inhalt) VALUES ($1,$2,$3)', [
      req.userId,
      'nutzer',
      frage,
    ]);
    const zusammenfassung = ergebnis.schritte
      .filter((s) => s.art === 'text')
      .map((s) => (s.art === 'text' ? s.text : ''))
      .join('\n\n');
    const aktionen = ergebnis.schritte
      .filter((s) => s.art === 'werkzeug')
      .map((s) => (s.art === 'werkzeug' ? `${s.name}: ${s.ergebnis}` : ''))
      .join('\n');
    await pool.query('INSERT INTO assistent_nachrichten (user_id, rolle, inhalt) VALUES ($1,$2,$3)', [
      req.userId,
      'assistent',
      [zusammenfassung, aktionen ? `\n\nAktionen:\n${aktionen}` : ''].join('').trim(),
    ]);

    res.json({ schritte: ergebnis.schritte, fehler: ergebnis.fehler ?? null });
  } catch (e) {
    fail(res, 500, 'fehler', e instanceof Error ? e.message : 'Der Assistent ist gescheitert.');
  }
});
