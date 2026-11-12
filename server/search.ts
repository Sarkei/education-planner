import { Router } from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { pool } from './db';
import jwt from 'jsonwebtoken';
import { fail, requireAuth, type AuthRequest, type NodeRow } from './guards';
import { absolute } from './storage';

export const searchRouter = Router();

const TEXT_EXTENSIONS = new Set(['.txt', '.md', '.csv', '.json', '.log']);
const MAX_CONTENT_FILES = 400;

/**
 * Suche über Dateinamen und Inhalte. Inhalte werden nur in Textdateien gelesen —
 * Office-Dokumente sind gepackte XML-Container, dafür bräuchte es einen eigenen Index.
 */
searchRouter.get('/', requireAuth, async (req: AuthRequest, res) => {
  const q = String(req.query.q ?? '').trim();
  if (q.length < 2) {
    res.json({ results: [] });
    return;
  }
  const like = `%${q.replace(/[%_]/g, (m) => `\\${m}`)}%`;

  const { rows } = await pool.query<NodeRow & { permission: string | null }>(
    `WITH RECURSIVE shared AS (
        SELECT n.*, s.permission FROM nodes n
          JOIN shares s ON s.node_id = n.id AND s.user_id = $1
         WHERE n.trashed_at IS NULL
      ), down AS (
        SELECT * FROM shared
        UNION ALL
        SELECT n.*, d.permission FROM nodes n JOIN down d ON n.parent_id = d.id WHERE n.trashed_at IS NULL
      ), visible AS (
        SELECT * FROM down
        UNION
        SELECT n.*, 'owner' FROM nodes n WHERE n.owner_id = $1 AND n.trashed_at IS NULL
      )
      SELECT * FROM visible WHERE name ILIKE $2 ORDER BY kind DESC, name ASC LIMIT 40`,
    [req.userId, like],
  );

  type Hit = {
    id: string;
    name: string;
    kind: string;
    parentId: string | null;
    mime: string | null;
    size: number;
    match: 'name' | 'content';
    snippet: string | null;
  };

  const results: Hit[] = rows.map((row) => ({
    id: row.id,
    name: row.name,
    kind: row.kind,
    parentId: row.parent_id,
    mime: row.mime,
    size: Number(row.size),
    match: 'name',
    snippet: null,
  }));

  // Inhaltssuche in allen sichtbaren Textdateien (nicht nur in den Namenstreffern)
  const textFiles = await pool.query<NodeRow & { permission: string | null }>(
    `WITH RECURSIVE shared AS (
        SELECT n.*, s.permission FROM nodes n
          JOIN shares s ON s.node_id = n.id AND s.user_id = $1
         WHERE n.trashed_at IS NULL
      ), down AS (
        SELECT * FROM shared
        UNION ALL
        SELECT n.*, d.permission FROM nodes n JOIN down d ON n.parent_id = d.id WHERE n.trashed_at IS NULL
      ), visible AS (
        SELECT * FROM down
        UNION
        SELECT n.*, 'owner' FROM nodes n WHERE n.owner_id = $1 AND n.trashed_at IS NULL
      )
      SELECT * FROM visible
       WHERE kind = 'file'
         AND lower(name) ~ '\.(txt|md|csv|json|log)$'
       ORDER BY updated_at DESC LIMIT $2`,
    [req.userId, MAX_CONTENT_FILES],
  );
  const files = textFiles.rows;
  const contentHits: Hit[] = [];
  for (const file of files) {
    if (!TEXT_EXTENSIONS.has(path.extname(file.name).toLowerCase())) continue;
    try {
      const full = absolute(file.storage_path);
      const stat = await fs.promises.stat(full);
      if (stat.size > 2 * 1024 * 1024) continue;
      const text = await fs.promises.readFile(full, 'utf8');
      const index = text.toLowerCase().indexOf(q.toLowerCase());
      if (index >= 0) {
        const start = Math.max(0, index - 40);
        const snippet = text.slice(start, Math.min(text.length, index + q.length + 60)).replace(/\s+/g, ' ');
        contentHits.push({
          id: file.id,
          name: file.name,
          kind: 'file',
          parentId: file.parent_id,
          mime: file.mime,
          size: Number(file.size),
          match: 'content',
          snippet: `…${snippet}…`,
        });
      }
    } catch {
      /* Datei nicht lesbar → ignorieren */
    }
  }

  res.json({ results: [...results, ...contentHits].slice(0, 60) });
});

/**
 * Vorschau für Bilder und PDFs. iframe und <img> können keinen Authorization-Header senden,
 * deshalb kommt der Zugriff über einen kurzlebigen Token im Query-String.
 */
searchRouter.get('/preview/:id', async (req: AuthRequest, res) => {
  const { nodeAccess } = await import('./guards');
  let userId = Number(req.userId ?? 0);
  if (!userId) {
    try {
      const payload = jwt.verify(String(req.query.t ?? ''), process.env.JWT_SECRET || 'dev-secret-change-me') as {
        uid: number;
        nid: string;
      };
      if (payload.nid !== req.params.id) throw new Error('falsche Datei');
      userId = payload.uid;
    } catch {
      fail(res, 401, 'unauthorized', 'Bitte anmelden.');
      return;
    }
  }
  const access = await nodeAccess(req.params.id, userId);
  if (!access || access.node.kind !== 'file') {
    fail(res, 404, 'not-found', 'Nicht gefunden.');
    return;
  }
  const full = absolute(access.node.storage_path);
  if (!fs.existsSync(full)) {
    fail(res, 404, 'missing', 'Datei fehlt im Speicher.');
    return;
  }
  res.setHeader('Content-Type', access.node.mime || 'application/octet-stream');
  res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(access.node.name)}"`);
  fs.createReadStream(full).pipe(res);
});
