import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

/** Wurzel im Container; im Compose auf ein NAS-Volume gemountet. */
export const FILES_ROOT = process.env.FILES_ROOT || '/data/files';
export const VERSIONS_ROOT = process.env.VERSIONS_ROOT || '/data/versions';
export const TRASH_ROOT = process.env.TRASH_ROOT || '/data/trash';
export const TMP_ROOT = process.env.TMP_ROOT || '/data/tmp';

export function ensureDirs(): void {
  for (const dir of [FILES_ROOT, VERSIONS_ROOT, TRASH_ROOT, TMP_ROOT]) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

/** Dateinamen für das Dateisystem entschärfen (kein Pfad-Ausbruch, keine Sonderzeichen). */
export function safeName(raw: string): string {
  const cleaned = String(raw ?? '')
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^\.+/, '');
  const name = cleaned.slice(0, 180).trim();
  return name || 'Unbenannt';
}

/** Absoluten Pfad aus einem relativen Storage-Pfad bauen und Ausbrüche verhindern. */
export function absolute(relative: string): string {
  const clean = relative
    .split('/')
    .filter((part) => part && part !== '.' && part !== '..')
    .join('/');
  const full = path.join(FILES_ROOT, clean);
  if (!full.startsWith(FILES_ROOT)) throw new Error('Pfad außerhalb des Speichers');
  return full;
}

export function relative(parentPath: string | null, name: string): string {
  return parentPath ? `${parentPath}/${safeName(name)}` : safeName(name);
}

/** Schreibt eine Datei atomar: erst Temp-Datei, dann rename. */
export async function writeAtomic(target: string, data: Buffer | NodeJS.ReadableStream): Promise<number> {
  await fs.promises.mkdir(path.dirname(target), { recursive: true });
  const tmp = `${target}.${crypto.randomBytes(6).toString('hex')}.tmp`;
  if (Buffer.isBuffer(data)) {
    await fs.promises.writeFile(tmp, data);
  } else {
    await new Promise<void>((resolve, reject) => {
      const out = fs.createWriteStream(tmp);
      data.pipe(out);
      data.on('error', reject);
      out.on('error', reject);
      out.on('finish', () => resolve());
    });
  }
  await fs.promises.rename(tmp, target);
  const stat = await fs.promises.stat(target);
  return stat.size;
}

export async function movePath(from: string, to: string): Promise<void> {
  await fs.promises.mkdir(path.dirname(to), { recursive: true });
  try {
    await fs.promises.rename(from, to);
  } catch {
    // anderes Dateisystem: kopieren und löschen
    await fs.promises.cp(from, to, { recursive: true });
    await fs.promises.rm(from, { recursive: true, force: true });
  }
}

export async function copyPath(from: string, to: string): Promise<void> {
  await fs.promises.mkdir(path.dirname(to), { recursive: true });
  await fs.promises.cp(from, to, { recursive: true });
}

/** Version sichern, bevor eine Datei überschrieben wird. Behält die letzten 20. */
type Queryable = { query: (q: string, v?: unknown[]) => Promise<{ rows: Array<Record<string, unknown>> }> };

export async function saveVersion(nodeId: string, absolutePath: string, version: number, userId: number | null, pool: Queryable): Promise<void> {
  if (!fs.existsSync(absolutePath)) return;
  const dir = path.join(VERSIONS_ROOT, nodeId);
  await fs.promises.mkdir(dir, { recursive: true });
  const target = path.join(dir, `${version}-${Date.now()}${path.extname(absolutePath) || '.bin'}`);
  await fs.promises.copyFile(absolutePath, target);
  const stat = await fs.promises.stat(target);
  await pool.query(
    'INSERT INTO file_versions (node_id, version, storage_path, size, created_by) VALUES ($1,$2,$3,$4,$5)',
    [nodeId, version, path.relative(VERSIONS_ROOT, target), stat.size, userId],
  );
  const keep = (await pool.query(
    `SELECT id FROM file_versions WHERE node_id = $1 ORDER BY created_at DESC OFFSET 20`,
    [nodeId],
  )) as { rows: Array<{ id: number }> };
  for (const row of keep.rows) {
    await pool.query('DELETE FROM file_versions WHERE id = $1', [row.id]);
  }
}
