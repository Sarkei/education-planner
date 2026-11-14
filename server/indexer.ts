import { pool } from './db';
import { loadNode, type NodeRow } from './guards';
import { extractText, isSearchable } from './extract';
import { absolute } from './storage';

/** Text einer Datei in den Index schreiben (überschreibt die alte Fassung). */
export async function indexNode(nodeId: string): Promise<boolean> {
  const node = await loadNode(nodeId);
  if (!node || node.kind !== 'file' || node.trashed_at) return false;
  if (!isSearchable(node.name)) return false;
  const text = await extractText(absolute(node.storage_path), node.name);
  await pool.query(
    `INSERT INTO node_texts (node_id, version, content, tsv, updated_at)
     VALUES ($1,$2,$3, to_tsvector('german', $3), now())
     ON CONFLICT (node_id) DO UPDATE
        SET version = EXCLUDED.version, content = EXCLUDED.content,
            tsv = EXCLUDED.tsv, updated_at = now()`,
    [node.id, node.version, text],
  );
  return true;
}

/** Dateien ohne (aktuellen) Index nachziehen — läuft beim Start und danach regelmäßig. */
export async function indexMissing(limit = 25): Promise<number> {
  const { rows } = await pool.query<NodeRow>(
    `SELECT n.* FROM nodes n
       LEFT JOIN node_texts t ON t.node_id = n.id
      WHERE n.kind = 'file' AND n.trashed_at IS NULL
        AND (t.node_id IS NULL OR t.version < n.version)
      ORDER BY n.updated_at DESC
      LIMIT $1`,
    [limit],
  );
  let done = 0;
  for (const row of rows) {
    if (await indexNode(row.id)) done++;
  }
  return done;
}

/** Wie viele Dateien warten noch auf den Index? Für den Hinweis in der Oberfläche. */
export async function indexPending(): Promise<number> {
  const { rows } = await pool.query<{ count: string }>(
    `SELECT count(*)::text AS count FROM nodes n
       LEFT JOIN node_texts t ON t.node_id = n.id
      WHERE n.kind = 'file' AND n.trashed_at IS NULL
        AND (t.node_id IS NULL OR t.version < n.version)`,
  );
  return Number(rows[0]?.count ?? 0);
}

/** Hintergrundlauf: alle 5 Minuten fehlende Texte nachziehen. */
export function startIndexer(intervalMs = 5 * 60 * 1000): void {
  const tick = async () => {
    try {
      const done = await indexMissing(25);
      if (done) console.log(`Index: ${done} Dateien ergänzt`);
    } catch (error) {
      console.error('Index-Lauf fehlgeschlagen', error);
    }
  };
  void tick();
  setInterval(() => void tick(), intervalMs);
}

/** Beim Löschen den Index mitentfernen. */
export async function dropIndex(nodeId: string): Promise<void> {
  await pool.query('DELETE FROM node_texts WHERE node_id = $1', [nodeId]);
}
