import type { NextFunction, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import { pool } from './db';

export type AuthRequest = Request & { userId?: number; userName?: string; userRole?: string };

const SECRET = process.env.JWT_SECRET || 'dev-secret-change-me';

export function signToken(user: { id: number; email: string; name: string; role: string; token_version: number }): string {
  return jwt.sign({ uid: user.id, tv: user.token_version }, SECRET, { expiresIn: '30d' });
}

export function fail(res: Response, status: number, error: string, message: string): void {
  res.status(status).json({ error, message });
}

/** Füllt req.userId, erzwingt aber nichts. */
export async function attachUser(req: AuthRequest, _res: Response, next: NextFunction): Promise<void> {
  const header = req.headers.authorization;
  if (header?.startsWith('Bearer ')) {
    try {
      const payload = jwt.verify(header.slice(7), SECRET) as { uid: number; tv: number };
      const result = await pool.query<{ id: number; name: string; role: string; token_version: number }>(
        'SELECT id, name, role, token_version FROM users WHERE id = $1',
        [payload.uid],
      );
      const user = result.rows[0];
      if (user && user.token_version === payload.tv) {
        req.userId = user.id;
        req.userName = user.name;
        req.userRole = user.role;
      }
    } catch {
      /* ungültiger Token → bleibt anonym */
    }
  }
  next();
}

export function requireAuth(req: AuthRequest, res: Response, next: NextFunction): void {
  if (!req.userId) {
    fail(res, 401, 'unauthorized', 'Bitte anmelden.');
    return;
  }
  next();
}

export function requireAdmin(req: AuthRequest, res: Response, next: NextFunction): void {
  if (req.userRole !== 'admin') {
    fail(res, 403, 'forbidden', 'Nur für Administratoren.');
    return;
  }
  next();
}

export type NodeRow = {
  id: string;
  parent_id: string | null;
  name: string;
  kind: 'folder' | 'file';
  storage_path: string;
  mime: string | null;
  size: string;
  version: number;
  owner_id: number;
  trashed_at: string | null;
  trashed_from: string | null;
  updated_at: string;
  position: number;
};

export type Access = { node: NodeRow; level: 'owner' | 'edit' | 'view' };

/**
 * Zugriff auf einen Knoten bestimmen: eigene Dateien sind voll, Freigaben wirken
 * auf den Ordner und alles darunter (über die Elternkette geprüft).
 */
export async function nodeAccess(nodeId: string, userId: number): Promise<Access | null> {
  const result = await pool.query<NodeRow>(
    `WITH RECURSIVE chain AS (
        SELECT n.id, n.parent_id, n.owner_id, 0 AS depth FROM nodes n WHERE n.id = $1
        UNION ALL
        SELECT p.id, p.parent_id, p.owner_id, c.depth + 1
          FROM nodes p JOIN chain c ON p.id = c.parent_id
      )
      SELECT c.id, c.owner_id, c.depth, s.permission
        FROM chain c
        LEFT JOIN shares s ON s.node_id = c.id AND s.user_id = $2
       ORDER BY c.depth ASC`,
    [nodeId, userId],
  );
  if (!result.rows.length) return null;
  const first = result.rows[0] as unknown as { owner_id: number };
  if (first.owner_id === userId) {
    const node = await loadNode(nodeId);
    return node ? { node, level: 'owner' } : null;
  }
  let level: 'edit' | 'view' | null = null;
  for (const row of result.rows as unknown as Array<{ permission: string | null }>) {
    if (row.permission === 'edit') {
      level = 'edit';
      break;
    }
    if (row.permission === 'view' && !level) level = 'view';
  }
  if (!level) return null;
  const node = await loadNode(nodeId);
  return node ? { node, level } : null;
}

export async function loadNode(nodeId: string): Promise<NodeRow | null> {
  const result = await pool.query<NodeRow>('SELECT * FROM nodes WHERE id = $1', [nodeId]);
  return result.rows[0] ?? null;
}

export function canWrite(access: Access | null): boolean {
  return Boolean(access && (access.level === 'owner' || access.level === 'edit'));
}
