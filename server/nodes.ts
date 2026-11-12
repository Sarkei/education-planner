import { Router } from 'express';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import archiver from 'archiver';
import jwt from 'jsonwebtoken';
import { z } from 'zod';
import { pool } from './db';
import { canWrite, fail, loadNode, nodeAccess, requireAuth, type AuthRequest, type NodeRow } from './guards';
import { absolute, copyPath, ensureDirs, movePath, relative as relativePath, safeName, saveVersion, TRASH_ROOT, writeAtomic } from './storage';
import { emptyFileFor } from './templates';
import { indexNode } from './indexer';

export const nodesRouter = Router();

type NodeDto = {
  id: string;
  parentId: string | null;
  name: string;
  kind: 'folder' | 'file';
  mime: string | null;
  size: number;
  version: number;
  ownerId: number;
  shared: boolean;
  permission: 'owner' | 'edit' | 'view';
  updatedAt: string;
  position: number;
};

function toDto(row: NodeRow & { permission?: string | null; shared?: boolean }, userId: number): NodeDto {
  return {
    id: row.id,
    parentId: row.parent_id,
    name: row.name,
    kind: row.kind,
    mime: row.mime,
    size: Number(row.size),
    version: row.version,
    ownerId: row.owner_id,
    shared: row.owner_id !== userId,
    permission: row.owner_id === userId ? 'owner' : row.permission === 'edit' ? 'edit' : 'view',
    updatedAt: new Date(row.updated_at ?? Date.now()).toISOString(),
    position: row.position ?? 0,
  };
}

/** Alle sichtbaren Knoten: eigene plus freigegebene Ordner mit allem darunter. */
async function visibleNodes(userId: number): Promise<NodeDto[]> {
  const { rows } = await pool.query<NodeRow & { permission: string | null }>(
    `WITH RECURSIVE shared AS (
        SELECT n.*, s.permission FROM nodes n
          JOIN shares s ON s.node_id = n.id AND s.user_id = $1
         WHERE n.trashed_at IS NULL
      ), down AS (
        SELECT * FROM shared
        UNION ALL
        SELECT n.*, d.permission FROM nodes n JOIN down d ON n.parent_id = d.id WHERE n.trashed_at IS NULL
      )
      SELECT * FROM down
      UNION
      SELECT n.*, 'owner' FROM nodes n WHERE n.owner_id = $1 AND n.trashed_at IS NULL`,
    [userId],
  );
  return rows.map((r) => toDto(r, userId));
}

nodesRouter.get('/tree', requireAuth, async (req: AuthRequest, res) => {
  res.json({ nodes: await visibleNodes(req.userId!) });
});

nodesRouter.get('/:id', requireAuth, async (req: AuthRequest, res) => {
  const access = await nodeAccess(req.params.id, req.userId!);
  if (!access) {
    fail(res, 404, 'not-found', 'Nicht gefunden.');
    return;
  }
  res.json({ node: toDto(access.node, req.userId!) });
});

/** Neue leere Datei anlegen (Word, Excel oder Text). */
nodesRouter.post('/file', requireAuth, async (req: AuthRequest, res) => {
  const schema = z.object({
    parentId: z.string().uuid().nullable().optional(),
    name: z.string().min(1).max(180),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    fail(res, 400, 'invalid-input', parsed.error.issues[0].message);
    return;
  }
  const parentId = parsed.data.parentId ?? null;
  let parentPath: string | null = null;
  if (parentId) {
    const access = await nodeAccess(parentId, req.userId!);
    if (!access || access.node.kind !== 'folder' || !canWrite(access)) {
      fail(res, 403, 'forbidden', 'Keine Schreibrechte in diesem Ordner.');
      return;
    }
    parentPath = access.node.storage_path;
  }
  const raw = parsed.data.name.includes('.') ? parsed.data.name : `${parsed.data.name}.docx`;
  const name = await uniqueName(parentId, raw);
  const storagePath = relativePath(parentPath, name);
  const content = await emptyFileFor(name);
  const size = await writeAtomic(absolute(storagePath), content);
  const id = crypto.randomUUID();
  const { rows } = await pool.query<NodeRow>(
    `INSERT INTO nodes (id, parent_id, name, kind, storage_path, mime, size, owner_id, position)
     VALUES ($1,$2,$3,'file',$4,$5,$6,$7, coalesce((select max(position)+1 from nodes where parent_id is not distinct from $2), 0))
     RETURNING *`,
    [id, parentId, name, storagePath, mimeFor(name), size, req.userId],
  );
  void indexNode(id).catch(() => undefined);
  res.status(201).json({ node: toDto(rows[0], req.userId!) });
});

/** Kopie eines Knotens (Ordner samt Inhalt) anlegen. */
nodesRouter.post('/:id/copy', requireAuth, async (req: AuthRequest, res) => {
  const schema = z.object({ parentId: z.string().uuid().nullable().optional() });
  const parsed = schema.safeParse(req.body ?? {});
  if (!parsed.success) {
    fail(res, 400, 'invalid-input', parsed.error.issues[0].message);
    return;
  }
  const access = await nodeAccess(req.params.id, req.userId!);
  if (!access) {
    fail(res, 404, 'not-found', 'Nicht gefunden.');
    return;
  }
  const targetParent = parsed.data.parentId === undefined ? access.node.parent_id : parsed.data.parentId;
  let parentPath: string | null = null;
  if (targetParent) {
    const target = await nodeAccess(targetParent, req.userId!);
    if (!target || target.node.kind !== 'folder' || !canWrite(target)) {
      fail(res, 403, 'forbidden', 'Keine Schreibrechte im Zielordner.');
      return;
    }
    parentPath = target.node.storage_path;
  }
  try {
    const copyId = await copySubtree(access.node, targetParent, parentPath, req.userId!);
    const created = await loadNode(copyId);
    res.status(201).json({ node: created ? toDto(created, req.userId!) : null });
  } catch (e) {
    fail(res, 500, 'copy-failed', e instanceof Error ? e.message : 'Kopieren fehlgeschlagen.');
  }
});

/** Kopiert einen Knoten rekursiv und liefert die neue ID zurück. */
async function copySubtree(node: NodeRow, parentId: string | null, parentPath: string | null, userId: number): Promise<string> {
  const name = await uniqueName(parentId, node.name);
  const storagePath = relativePath(parentPath, name);
  const id = crypto.randomUUID();
  await copyPath(absolute(node.storage_path), absolute(storagePath));
  await pool.query(
    `INSERT INTO nodes (id, parent_id, name, kind, storage_path, mime, size, owner_id, position)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8, coalesce((select max(position)+1 from nodes where parent_id is not distinct from $2), 0))`,
    [id, parentId, name, node.kind, storagePath, node.mime, node.size, userId],
  );
  if (node.kind === 'folder') {
    const { rows: kids } = await pool.query<NodeRow>(
      'SELECT * FROM nodes WHERE parent_id = $1 AND trashed_at is null ORDER BY name',
      [node.id],
    );
    for (const kid of kids) {
      await copySubtree(kid, id, storagePath, userId);
    }
  } else {
    void indexNode(id).catch(() => undefined);
  }
  return id;
}

function mimeFor(name: string): string {
  const ext = name.toLowerCase().split('.').pop() ?? '';
  const map: Record<string, string> = {
    docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    txt: 'text/plain',
    md: 'text/markdown',
    csv: 'text/csv',
  };
  return map[ext] ?? 'application/octet-stream';
}

/** Ordner anlegen. */
nodesRouter.post('/folder', requireAuth, async (req: AuthRequest, res) => {
  const schema = z.object({ parentId: z.string().uuid().nullable().optional(), name: z.string().min(1).max(120) });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    fail(res, 400, 'invalid-input', parsed.error.issues[0].message);
    return;
  }
  const parentId = parsed.data.parentId ?? null;
  let parentPath: string | null = null;
  if (parentId) {
    const access = await nodeAccess(parentId, req.userId!);
    if (!access || access.node.kind !== 'folder') {
      fail(res, 404, 'not-found', 'Zielordner nicht gefunden.');
      return;
    }
    if (!canWrite(access)) {
      fail(res, 403, 'forbidden', 'Keine Schreibrechte in diesem Ordner.');
      return;
    }
    parentPath = access.node.storage_path;
  }
  const name = await uniqueName(parentId, parsed.data.name);
  const storagePath = relativePath(parentPath, name);
  const id = crypto.randomUUID();
  await fs.promises.mkdir(absolute(storagePath), { recursive: true });
  const { rows } = await pool.query<NodeRow>(
    `INSERT INTO nodes (id, parent_id, name, kind, storage_path, owner_id, position)
     VALUES ($1,$2,$3,'folder',$4,$5, coalesce((select max(position)+1 from nodes where parent_id is not distinct from $2), 0))
     RETURNING *`,
    [id, parentId, name, storagePath, req.userId],
  );
  res.status(201).json({ node: toDto(rows[0], req.userId!) });
});

/** Umbenennen und/oder verschieben. */
nodesRouter.patch('/:id', requireAuth, async (req: AuthRequest, res) => {
  const schema = z.object({
    name: z.string().min(1).max(180).optional(),
    parentId: z.string().uuid().nullable().optional(),
    position: z.number().int().optional(),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    fail(res, 400, 'invalid-input', parsed.error.issues[0].message);
    return;
  }
  const access = await nodeAccess(req.params.id, req.userId!);
  if (!access) {
    fail(res, 404, 'not-found', 'Nicht gefunden.');
    return;
  }
  if (!canWrite(access)) {
    fail(res, 403, 'forbidden', 'Keine Schreibrechte.');
    return;
  }
  const node = access.node;
  const name = parsed.data.name ? safeName(parsed.data.name) : node.name;
  const nextParentId = parsed.data.parentId === undefined ? node.parent_id : parsed.data.parentId;

  if (nextParentId && nextParentId === node.id) {
    fail(res, 400, 'invalid-move', 'Ein Ordner kann nicht in sich selbst verschoben werden.');
    return;
  }
  if (nextParentId && (await isDescendant(nextParentId, node.id))) {
    fail(res, 400, 'invalid-move', 'Ein Ordner kann nicht in einen seiner Unterordner.');
    return;
  }

  let parentPath: string | null = null;
  if (nextParentId) {
    const target = await nodeAccess(nextParentId, req.userId!);
    if (!target || target.node.kind !== 'folder') {
      fail(res, 404, 'not-found', 'Zielordner nicht gefunden.');
      return;
    }
    if (!canWrite(target)) {
      fail(res, 403, 'forbidden', 'Keine Schreibrechte im Zielordner.');
      return;
    }
    parentPath = target.node.storage_path;
  }

  const finalName = await uniqueName(nextParentId ?? null, name, node.id);
  const oldPath = node.storage_path;
  const newPath = relativePath(parentPath, finalName);

  if (oldPath !== newPath) {
    await movePath(absolute(oldPath), absolute(newPath));
    // Untergeordnete Pfade mitziehen
    await pool.query(
      `UPDATE nodes SET storage_path = $1 || substr(storage_path, length($2) + 1)
        WHERE storage_path LIKE $2 || '/%'`,
      [newPath, oldPath],
    );
  }

  const { rows } = await pool.query<NodeRow>(
    `UPDATE nodes SET name = $2, parent_id = $3, storage_path = $4, updated_at = now(),
            position = coalesce($5, position)
      WHERE id = $1 RETURNING *`,
    [node.id, finalName, nextParentId, newPath, parsed.data.position ?? null],
  );
  res.json({ node: toDto(rows[0], req.userId!) });
});

/** In den Papierkorb (nichts wird endgültig gelöscht). */
nodesRouter.delete('/:id', requireAuth, async (req: AuthRequest, res) => {
  const access = await nodeAccess(req.params.id, req.userId!);
  if (!access) {
    fail(res, 404, 'not-found', 'Nicht gefunden.');
    return;
  }
  if (!canWrite(access)) {
    fail(res, 403, 'forbidden', 'Keine Schreibrechte.');
    return;
  }
  const node = access.node;
  const target = path.join(TRASH_ROOT, `${node.id}`);
  await fs.promises.rm(target, { recursive: true, force: true });
  await movePath(absolute(node.storage_path), target);
  await pool.query(
    `WITH RECURSIVE sub AS (
       SELECT id FROM nodes WHERE id = $1
       UNION ALL SELECT n.id FROM nodes n JOIN sub s ON n.parent_id = s.id
     )
     UPDATE nodes SET trashed_at = now(), trashed_from = parent_id WHERE id IN (SELECT id FROM sub)`,
    [node.id],
  );
  res.json({ ok: true });
});

nodesRouter.get('/trash/list', requireAuth, async (req: AuthRequest, res) => {
  const { rows } = await pool.query<NodeRow>(
    `SELECT * FROM nodes WHERE trashed_at is not null AND owner_id = $1 ORDER BY trashed_at DESC LIMIT 200`,
    [req.userId],
  );
  res.json({ nodes: rows.map((r) => ({ ...toDto(r, req.userId!), trashedAt: r.trashed_at })) });
});

nodesRouter.post('/:id/restore', requireAuth, async (req: AuthRequest, res) => {
  const node = await loadNode(req.params.id);
  if (!node || node.owner_id !== req.userId) {
    fail(res, 404, 'not-found', 'Nicht gefunden.');
    return;
  }
  const parent = node.trashed_from ? await loadNode(node.trashed_from) : null;
  const parentPath = parent && !parent.trashed_at ? parent.storage_path : null;
  const name = await uniqueName(parent && !parent.trashed_at ? parent.id : null, node.name, node.id);
  const newPath = relativePath(parentPath, name);
  await movePath(path.join(TRASH_ROOT, node.id), absolute(newPath));
  await pool.query(
    `WITH RECURSIVE sub AS (
       SELECT id FROM nodes WHERE id = $1
       UNION ALL SELECT n.id FROM nodes n JOIN sub s ON n.parent_id = s.id
     )
     UPDATE nodes SET trashed_at = null, trashed_from = null WHERE id IN (SELECT id FROM sub)`,
    [node.id],
  );
  await pool.query('UPDATE nodes SET parent_id = $2, storage_path = $3, name = $4, updated_at = now() WHERE id = $1', [
    node.id,
    parent && !parent.trashed_at ? parent.id : null,
    newPath,
    name,
  ]);
  res.json({ ok: true });
});

/** Endgültig löschen — nur aus dem Papierkorb heraus. */
nodesRouter.delete('/:id/purge', requireAuth, async (req: AuthRequest, res) => {
  const node = await loadNode(req.params.id);
  if (!node || node.owner_id !== req.userId || !node.trashed_at) {
    fail(res, 404, 'not-found', 'Nur eigene Einträge im Papierkorb.');
    return;
  }
  await fs.promises.rm(path.join(TRASH_ROOT, node.id), { recursive: true, force: true });
  await pool.query(
    `WITH RECURSIVE sub AS (
       SELECT id FROM nodes WHERE id = $1
       UNION ALL SELECT n.id FROM nodes n JOIN sub s ON n.parent_id = s.id
     )
     DELETE FROM nodes WHERE id IN (SELECT id FROM sub)`,
    [node.id],
  );
  res.json({ ok: true });
});

/** Download: Datei direkt, Ordner als ZIP. */
nodesRouter.get('/:id/download', requireAuth, async (req: AuthRequest, res) => {
  const access = await nodeAccess(req.params.id, req.userId!);
  if (!access) {
    fail(res, 404, 'not-found', 'Nicht gefunden.');
    return;
  }
  const node = access.node;
  const full = absolute(node.storage_path);
  if (!fs.existsSync(full)) {
    fail(res, 404, 'missing', 'Datei fehlt im Speicher.');
    return;
  }
  if (node.kind === 'file') {
    res.setHeader('Content-Type', node.mime || 'application/octet-stream');
    res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(node.name)}"`);
    fs.createReadStream(full).pipe(res);
    return;
  }
  res.setHeader('Content-Type', 'application/zip');
  res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(node.name)}.zip"`);
  const archive = archiver('zip', { zlib: { level: 6 } });
  archive.on('error', () => res.destroy());
  archive.pipe(res);
  archive.directory(full, node.name);
  await archive.finalize();
});

/** Kurzlebiger Link für die Vorschau (Bilder, PDFs) — ohne Authorization-Header nutzbar. */
nodesRouter.post('/:id/preview-token', requireAuth, async (req: AuthRequest, res) => {
  const access = await nodeAccess(req.params.id, req.userId!);
  if (!access) {
    fail(res, 404, 'not-found', 'Nicht gefunden.');
    return;
  }
  const token = jwt.sign({ uid: req.userId, nid: access.node.id }, process.env.JWT_SECRET || 'dev-secret-change-me', {
    expiresIn: '2h',
  });
  res.json({ url: `/api/search/preview/${access.node.id}?t=${token}` });
});

/** Alte Fassungen einer Datei. */
nodesRouter.get('/:id/versions', requireAuth, async (req: AuthRequest, res) => {
  const access = await nodeAccess(req.params.id, req.userId!);
  if (!access) {
    fail(res, 404, 'not-found', 'Nicht gefunden.');
    return;
  }
  const { rows } = await pool.query(
    'SELECT id, version, size, created_at FROM file_versions WHERE node_id = $1 ORDER BY created_at DESC',
    [req.params.id],
  );
  res.json({ versions: rows });
});

// ---- Hilfen -------------------------------------------------------------

/** Namen im Zielordner eindeutig machen: „Name (2).docx". */
async function uniqueName(parentId: string | null, desired: string, ignoreId?: string): Promise<string> {
  const base = safeName(desired);
  const ext = path.extname(base);
  const stem = ext ? base.slice(0, -ext.length) : base;
  let candidate = base;
  for (let i = 2; i < 200; i++) {
    const clash = await pool.query(
      `SELECT 1 FROM nodes WHERE parent_id is not distinct from $1 AND lower(name) = lower($2) AND trashed_at is null AND ($3::uuid is null or id <> $3)`,
      [parentId, candidate, ignoreId ?? null],
    );
    if (!clash.rowCount) return candidate;
    candidate = `${stem} (${i})${ext}`;
  }
  return `${stem} (${Date.now()})${ext}`;
}

/** Ist `candidate` ein Unterknoten von `ancestor`? */
async function isDescendant(candidate: string, ancestor: string): Promise<boolean> {
  const { rows } = await pool.query(
    `WITH RECURSIVE up AS (
        SELECT id, parent_id FROM nodes WHERE id = $1
        UNION ALL SELECT n.id, n.parent_id FROM nodes n JOIN up u ON n.id = u.parent_id
     ) SELECT 1 FROM up WHERE id = $2 LIMIT 1`,
    [candidate, ancestor],
  );
  return rows.length > 0;
}

export async function ensureStorage(): Promise<void> {
  ensureDirs();
}

export { saveVersion, copyPath };
