import { Router } from 'express';
import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { z } from 'zod';
import { pool } from './db';
import { canWrite, fail, nodeAccess, requireAuth, type AuthRequest, type NodeRow } from './guards';
import { absolute, relative as relativePath, safeName, TMP_ROOT, writeAtomic } from './storage';

export const uploadsRouter = Router();

const CHUNK_LIMIT = '96mb';

/** Upload starten: die App schickt Name, Größe und Zielordner. */
uploadsRouter.post('/init', requireAuth, async (req: AuthRequest, res) => {
  const schema = z.object({
    parentId: z.string().uuid().nullable().optional(),
    name: z.string().min(1).max(180),
    size: z.number().int().nonnegative().optional(),
    mime: z.string().max(160).optional(),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    fail(res, 400, 'invalid-input', parsed.error.issues[0].message);
    return;
  }
  const parentId = parsed.data.parentId ?? null;
  if (parentId) {
    const access = await nodeAccess(parentId, req.userId!);
    if (!access || access.node.kind !== 'folder' || !canWrite(access)) {
      fail(res, 403, 'forbidden', 'Keine Schreibrechte in diesem Ordner.');
      return;
    }
  }
  const id = crypto.randomUUID();
  await fs.promises.mkdir(path.join(TMP_ROOT, id), { recursive: true });
  await pool.query(
    'INSERT INTO upload_sessions (id, user_id, parent_id, name, mime, size) VALUES ($1,$2,$3,$4,$5,$6)',
    [id, req.userId, parentId, safeName(parsed.data.name), parsed.data.mime ?? null, parsed.data.size ?? 0],
  );
  res.status(201).json({ uploadId: id, chunkSize: 8 * 1024 * 1024 });
});

/** Ein Teil hochladen (Rohbytes, Reihenfolge über die Index-Nummer). */
uploadsRouter.put(
  '/:id/:index',
  requireAuth,
  express.raw({ type: () => true, limit: CHUNK_LIMIT }),
  async (req: AuthRequest, res) => {
    const session = await pool.query<{ user_id: number; chunks: number }>('SELECT user_id, chunks FROM upload_sessions WHERE id = $1', [req.params.id]);
    if (!session.rowCount || session.rows[0].user_id !== req.userId) {
      fail(res, 404, 'not-found', 'Upload nicht gefunden.');
      return;
    }
    const index = Number(req.params.index);
    if (!Number.isInteger(index) || index < 0) {
      fail(res, 400, 'invalid-chunk', 'Ungültiger Teil.');
      return;
    }
    const buffer = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
    if (!buffer.length) {
      fail(res, 400, 'empty-chunk', 'Leerer Teil.');
      return;
    }
    await fs.promises.writeFile(path.join(TMP_ROOT, req.params.id, String(index).padStart(5, '0')), buffer);
    const count = await fs.promises.readdir(path.join(TMP_ROOT, req.params.id));
    await pool.query('UPDATE upload_sessions SET chunks = $2 WHERE id = $1', [req.params.id, count.length]);
    res.json({ received: index, chunks: count.length });
  },
);

/** Upload abschließen: Teile zusammensetzen und als Datei anlegen. */
uploadsRouter.post('/:id/complete', requireAuth, async (req: AuthRequest, res) => {
  const session = await pool.query<{ user_id: number; parent_id: string | null; name: string; mime: string | null }>(
    'SELECT user_id, parent_id, name, mime FROM upload_sessions WHERE id = $1',
    [req.params.id],
  );
  if (!session.rowCount || session.rows[0].user_id !== req.userId) {
    fail(res, 404, 'not-found', 'Upload nicht gefunden.');
    return;
  }
  const { parent_id: parentId, name, mime } = session.rows[0];
  let parentPath: string | null = null;
  if (parentId) {
    const access = await nodeAccess(parentId, req.userId!);
    if (!access || !canWrite(access)) {
      fail(res, 403, 'forbidden', 'Keine Schreibrechte in diesem Ordner.');
      return;
    }
    parentPath = access.node.storage_path;
  }

  const dir = path.join(TMP_ROOT, req.params.id);
  const parts = (await fs.promises.readdir(dir)).sort();
  if (!parts.length) {
    fail(res, 400, 'empty-upload', 'Es sind keine Teile angekommen.');
    return;
  }
  const finalName = await uniqueName(parentId, name);
  const storagePath = relativePath(parentPath, finalName);
  const target = absolute(storagePath);
  await fs.promises.mkdir(path.dirname(target), { recursive: true });
  const tmpTarget = `${target}.uploading`;
  const out = fs.createWriteStream(tmpTarget);
  for (const part of parts) {
    await new Promise<void>((resolve, reject) => {
      const input = fs.createReadStream(path.join(dir, part));
      input.on('error', reject);
      input.on('end', () => resolve());
      input.pipe(out, { end: false });
    });
  }
  await new Promise<void>((resolve) => out.end(resolve));
  await fs.promises.rename(tmpTarget, target);
  await fs.promises.rm(dir, { recursive: true, force: true });

  const stat = await fs.promises.stat(target);
  const nodeId = crypto.randomUUID();
  const { rows } = await pool.query<NodeRow>(
    `INSERT INTO nodes (id, parent_id, name, kind, storage_path, mime, size, owner_id, position)
     VALUES ($1,$2,$3,'file',$4,$5,$6,$7, coalesce((select max(position)+1 from nodes where parent_id is not distinct from $2), 0))
     RETURNING *`,
    [nodeId, parentId, finalName, storagePath, mime || guessMime(finalName), stat.size, req.userId],
  );
  await pool.query('DELETE FROM upload_sessions WHERE id = $1', [req.params.id]);
  res.status(201).json({
    node: {
      id: rows[0].id,
      parentId: rows[0].parent_id,
      name: rows[0].name,
      kind: rows[0].kind,
      size: Number(rows[0].size),
      mime: rows[0].mime,
    },
  });
});

/** Textdatei direkt anlegen/bearbeiten (für .md/.txt ohne Office). */
uploadsRouter.put('/text/:id', requireAuth, async (req: AuthRequest, res) => {
  const access = await nodeAccess(req.params.id, req.userId!);
  if (!access || access.node.kind !== 'file' || !canWrite(access)) {
    fail(res, 403, 'forbidden', 'Keine Schreibrechte.');
    return;
  }
  const content = String((req.body as { content?: string })?.content ?? '');
  const size = await writeAtomic(absolute(access.node.storage_path), Buffer.from(content, 'utf8'));
  await pool.query('UPDATE nodes SET size = $2, updated_at = now(), version = version + 1 WHERE id = $1', [req.params.id, size]);
  res.json({ ok: true, size });
});

function guessMime(name: string): string {
  const ext = path.extname(name).toLowerCase();
  const map: Record<string, string> = {
    '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    '.doc': 'application/msword',
    '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    '.xls': 'application/vnd.ms-excel',
    '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    '.ppt': 'application/vnd.ms-powerpoint',
    '.odt': 'application/vnd.oasis.opendocument.text',
    '.ods': 'application/vnd.oasis.opendocument.spreadsheet',
    '.odp': 'application/vnd.oasis.opendocument.presentation',
    '.pdf': 'application/pdf',
    '.txt': 'text/plain',
    '.md': 'text/markdown',
    '.csv': 'text/csv',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
  };
  return map[ext] ?? 'application/octet-stream';
}

async function uniqueName(parentId: string | null, desired: string): Promise<string> {
  const base = safeName(desired);
  const ext = path.extname(base);
  const stem = ext ? base.slice(0, -ext.length) : base;
  let candidate = base;
  for (let i = 2; i < 200; i++) {
    const clash = await pool.query(
      'SELECT 1 FROM nodes WHERE parent_id is not distinct from $1 AND lower(name) = lower($2) AND trashed_at is null',
      [parentId, candidate],
    );
    if (!clash.rowCount) return candidate;
    candidate = `${stem} (${i})${ext}`;
  }
  return `${stem} (${Date.now()})${ext}`;
}
