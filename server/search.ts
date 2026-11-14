import { Router } from 'express';
import fs from 'node:fs';
import { pool } from './db';
import jwt from 'jsonwebtoken';
import { fail, requireAuth, type AuthRequest, type NodeRow } from './guards';
import { absolute } from './storage';
import { indexPending } from './indexer';

export const searchRouter = Router();


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

  // Volltextsuche über den Index (Word, Excel, PowerPoint, ODF, PDF, Text)
  const { rows: content } = await pool.query<{
    id: string;
    name: string;
    parent_id: string | null;
    mime: string | null;
    size: string;
    excerpt: string;
    rank: number;
  }>(
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
      SELECT v.id, v.name, v.parent_id, v.mime, v.size::text AS size,
             ts_headline('german', t.content, query, 'StartSel=«,StopSel=»,MaxWords=18,MinWords=6') AS excerpt,
             ts_rank(t.tsv, query) AS rank
        FROM visible v
        JOIN node_texts t ON t.node_id = v.id
       CROSS JOIN websearch_to_tsquery('german', $2) AS query
       WHERE v.kind = 'file' AND t.tsv @@ query
       ORDER BY rank DESC
       LIMIT 30`,
    [req.userId, q],
  );
  const indexedHits: Hit[] = content.map((row) => ({
    id: row.id,
    name: row.name,
    kind: 'file',
    parentId: row.parent_id,
    mime: row.mime,
    size: Number(row.size),
    match: 'content',
    snippet: row.excerpt.replace(/\s+/g, ' ').trim(),
  }));

  // Namenstreffer und Index-Treffer zusammenführen (eine Zeile pro Datei)
  const seen = new Set(results.map((r) => r.id));
  const merged = [...results];
  for (const hit of indexedHits) {
    if (seen.has(hit.id)) continue;
    seen.add(hit.id);
    merged.push(hit);
  }

  res.json({ results: merged.slice(0, 60), pending: await indexPending() });
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
