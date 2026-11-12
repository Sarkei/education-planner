import { Router } from 'express';
import bcrypt from 'bcryptjs';
import crypto from 'node:crypto';
import { z } from 'zod';
import { pool } from './db';
import { fail, requireAdmin, requireAuth, signToken, type AuthRequest } from './guards';

export const authRouter = Router();

const credentials = z.object({
  email: z.string().email('Bitte eine gültige E-Mail angeben.'),
  password: z.string().min(8, 'Mindestens 8 Zeichen.'),
});

const registerSchema = credentials.extend({ name: z.string().min(2, 'Bitte einen Namen angeben.') });

/** Erster Nutzer der Installation wird Administrator. */
authRouter.get('/config', async (_req, res) => {
  const { rows } = await pool.query<{ count: string }>('SELECT count(*)::text AS count FROM users');
  res.json({ needsSetup: rows[0].count === '0' });
});

authRouter.post('/register', async (req, res) => {
  const parsed = registerSchema.safeParse(req.body);
  if (!parsed.success) {
    fail(res, 400, 'invalid-input', parsed.error.issues[0].message);
    return;
  }
  const { email, password, name } = parsed.data;
  const existing = await pool.query('SELECT 1 FROM users WHERE lower(email) = lower($1)', [email]);
  if (existing.rowCount) {
    fail(res, 409, 'email-taken', 'Diese E-Mail ist schon vergeben.');
    return;
  }
  const count = await pool.query<{ count: string }>('SELECT count(*)::text AS count FROM users');
  const role = count.rows[0].count === '0' ? 'admin' : 'user';
  const hash = await bcrypt.hash(password, 10);
  const created = await pool.query<{ id: number; email: string; name: string; role: string; token_version: number }>(
    'INSERT INTO users (email, name, password_hash, role) VALUES ($1,$2,$3,$4) RETURNING id, email, name, role, token_version',
    [email.toLowerCase(), name, hash, role],
  );
  const user = created.rows[0];
  res.status(201).json({
    token: signToken(user),
    user: { id: user.id, email: user.email, name: user.name, role: user.role },
  });
});

authRouter.post('/login', async (req, res) => {
  const parsed = credentials.safeParse(req.body);
  if (!parsed.success) {
    fail(res, 400, 'invalid-input', parsed.error.issues[0].message);
    return;
  }
  const { rows } = await pool.query<{ id: number; email: string; name: string; role: string; password_hash: string; token_version: number }>(
    'SELECT id, email, name, role, password_hash, token_version FROM users WHERE lower(email) = lower($1)',
    [parsed.data.email],
  );
  const user = rows[0];
  if (!user || !(await bcrypt.compare(parsed.data.password, user.password_hash))) {
    fail(res, 401, 'bad-credentials', 'E-Mail oder Passwort stimmt nicht.');
    return;
  }
  res.json({
    token: signToken(user),
    user: { id: user.id, email: user.email, name: user.name, role: user.role },
  });
});

authRouter.get('/me', requireAuth, async (req: AuthRequest, res) => {
  const { rows } = await pool.query('SELECT id, email, name, role, created_at FROM users WHERE id = $1', [req.userId]);
  res.json({ user: rows[0] });
});

authRouter.post('/password', requireAuth, async (req: AuthRequest, res) => {
  const schema = z.object({ current: z.string().min(1), next: z.string().min(8, 'Mindestens 8 Zeichen.') });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    fail(res, 400, 'invalid-input', parsed.error.issues[0].message);
    return;
  }
  const { rows } = await pool.query<{ password_hash: string }>('SELECT password_hash FROM users WHERE id = $1', [req.userId]);
  if (!(await bcrypt.compare(parsed.data.current, rows[0].password_hash))) {
    fail(res, 400, 'bad-password', 'Das aktuelle Passwort stimmt nicht.');
    return;
  }
  const hash = await bcrypt.hash(parsed.data.next, 10);
  await pool.query('UPDATE users SET password_hash = $1, token_version = token_version + 1 WHERE id = $2', [hash, req.userId]);
  res.json({ ok: true, message: 'Passwort geändert — bitte neu anmelden.' });
});

/** Ohne SMTP wird der Link direkt zurückgegeben (ALLOW_DEV_RESET_LINK=1). */
authRouter.post('/forgot', async (req, res) => {
  const email = String((req.body as { email?: string })?.email ?? '').trim().toLowerCase();
  const { rows } = await pool.query<{ id: number }>('SELECT id FROM users WHERE lower(email) = lower($1)', [email]);
  const response: Record<string, unknown> = { ok: true, message: 'Wenn es das Konto gibt, ist ein Link unterwegs.' };
  if (rows.length && process.env.ALLOW_DEV_RESET_LINK === '1') {
    const token = crypto.randomBytes(24).toString('hex');
    const hash = crypto.createHash('sha256').update(token).digest('hex');
    await pool.query('INSERT INTO password_resets (user_id, token_hash, expires_at) VALUES ($1,$2, now() + interval \'60 minutes\')', [rows[0].id, hash]);
    response.resetToken = token;
  }
  res.json(response);
});

authRouter.post('/reset', async (req, res) => {
  const schema = z.object({ token: z.string().min(10), password: z.string().min(8, 'Mindestens 8 Zeichen.') });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    fail(res, 400, 'invalid-input', parsed.error.issues[0].message);
    return;
  }
  const hash = crypto.createHash('sha256').update(parsed.data.token).digest('hex');
  const { rows } = await pool.query<{ id: number; user_id: number }>(
    'SELECT id, user_id FROM password_resets WHERE token_hash = $1 AND used_at IS NULL AND expires_at > now()',
    [hash],
  );
  if (!rows.length) {
    fail(res, 400, 'invalid-token', 'Der Link ist ungültig oder abgelaufen.');
    return;
  }
  const passwordHash = await bcrypt.hash(parsed.data.password, 10);
  await pool.query('UPDATE users SET password_hash = $1, token_version = token_version + 1 WHERE id = $2', [passwordHash, rows[0].user_id]);
  await pool.query('UPDATE password_resets SET used_at = now() WHERE id = $1', [rows[0].id]);
  res.json({ ok: true });
});

/** Nutzerverwaltung (nur Admin) — Tim legt damit die Familie/Freunde an. */
authRouter.get('/users', requireAuth, requireAdmin, async (_req, res) => {
  const { rows } = await pool.query('SELECT id, email, name, role, created_at FROM users ORDER BY name');
  res.json({ users: rows });
});

authRouter.post('/users', requireAuth, requireAdmin, async (req, res) => {
  const schema = credentials.extend({ name: z.string().min(2), role: z.enum(['admin', 'user']).default('user') });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    fail(res, 400, 'invalid-input', parsed.error.issues[0].message);
    return;
  }
  const existing = await pool.query('SELECT 1 FROM users WHERE lower(email) = lower($1)', [parsed.data.email]);
  if (existing.rowCount) {
    fail(res, 409, 'email-taken', 'Diese E-Mail ist schon vergeben.');
    return;
  }
  const hash = await bcrypt.hash(parsed.data.password, 10);
  const { rows } = await pool.query(
    'INSERT INTO users (email, name, password_hash, role) VALUES ($1,$2,$3,$4) RETURNING id, email, name, role, created_at',
    [parsed.data.email.toLowerCase(), parsed.data.name, hash, parsed.data.role],
  );
  res.status(201).json({ user: rows[0] });
});

authRouter.delete('/users/:id', requireAuth, requireAdmin, async (req: AuthRequest, res) => {
  const id = Number(req.params.id);
  if (id === req.userId) {
    fail(res, 400, 'self-delete', 'Das eigene Konto lässt sich hier nicht löschen.');
    return;
  }
  await pool.query('DELETE FROM users WHERE id = $1', [id]);
  res.json({ ok: true });
});
