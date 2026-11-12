import { Router } from 'express';
import { z } from 'zod';
import { pool } from './db';
import { canWrite, fail, nodeAccess, requireAuth, type AuthRequest } from './guards';

export const sharesRouter = Router();

/** Wer hat Zugriff auf diesen Knoten? (Eigentümer sieht die Liste.) */
sharesRouter.get('/:id', requireAuth, async (req: AuthRequest, res) => {
  const access = await nodeAccess(req.params.id, req.userId!);
  if (!access || access.level !== 'owner') {
    fail(res, 403, 'forbidden', 'Nur der Eigentümer sieht die Freigaben.');
    return;
  }
  const { rows } = await pool.query(
    `SELECT s.id, s.permission, u.id AS user_id, u.name, u.email
       FROM shares s JOIN users u ON u.id = s.user_id
      WHERE s.node_id = $1 ORDER BY u.name`,
    [req.params.id],
  );
  res.json({ shares: rows });
});

/** Freigeben oder Recht ändern. */
sharesRouter.post('/:id', requireAuth, async (req: AuthRequest, res) => {
  const schema = z.object({ userId: z.number().int(), permission: z.enum(['view', 'edit']) });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    fail(res, 400, 'invalid-input', parsed.error.issues[0].message);
    return;
  }
  const access = await nodeAccess(req.params.id, req.userId!);
  if (!access || !canWrite(access)) {
    fail(res, 403, 'forbidden', 'Keine Schreibrechte.');
    return;
  }
  if (parsed.data.userId === req.userId) {
    fail(res, 400, 'self-share', 'Du hast als Eigentümer schon Zugriff.');
    return;
  }
  await pool.query(
    `INSERT INTO shares (node_id, user_id, permission) VALUES ($1,$2,$3)
     ON CONFLICT (node_id, user_id) DO UPDATE SET permission = EXCLUDED.permission`,
    [req.params.id, parsed.data.userId, parsed.data.permission],
  );
  res.json({ ok: true });
});

sharesRouter.delete('/:id/:userId', requireAuth, async (req: AuthRequest, res) => {
  const access = await nodeAccess(req.params.id, req.userId!);
  if (!access || access.level !== 'owner') {
    fail(res, 403, 'forbidden', 'Nur der Eigentümer kann Freigaben entfernen.');
    return;
  }
  await pool.query('DELETE FROM shares WHERE node_id = $1 AND user_id = $2', [req.params.id, Number(req.params.userId)]);
  res.json({ ok: true });
});

/** „Mit mir geteilt" — alles, was andere explizit freigegeben haben. */
sharesRouter.get('/', requireAuth, async (req: AuthRequest, res) => {
  const { rows } = await pool.query(
    `SELECT n.id, n.name, n.kind, s.permission, u.name AS owner_name
       FROM shares s JOIN nodes n ON n.id = s.node_id JOIN users u ON u.id = n.owner_id
      WHERE s.user_id = $1 AND n.trashed_at is null
      ORDER BY n.name`,
    [req.userId],
  );
  res.json({ shared: rows });
});

/** Nutzerliste für den Freigabe-Dialog (jeder Angemeldete darf Namen sehen). */
sharesRouter.get('/users/all', requireAuth, async (req: AuthRequest, res) => {
  const { rows } = await pool.query('SELECT id, name, email FROM users WHERE id <> $1 ORDER BY name', [req.userId]);
  res.json({ users: rows });
});
