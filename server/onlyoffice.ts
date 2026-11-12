import { Router } from 'express';
import fs from 'node:fs';
import path from 'node:path';
import jwt from 'jsonwebtoken';
import { pool } from './db';
import { canWrite, fail, loadNode, nodeAccess, requireAuth, type AuthRequest } from './guards';
import { absolute, saveVersion, writeAtomic } from './storage';
import { indexNode } from './indexer';

export const officeRouter = Router();

const DS_PUBLIC_URL = (process.env.ONLYOFFICE_URL || 'https://office.nas-timgreen.com').replace(/\/+$/, '');
const DS_SECRET = process.env.ONLYOFFICE_JWT_SECRET || '';
const INTERNAL_BASE = (process.env.INTERNAL_BASE_URL || 'http://education-planner:3000').replace(/\/+$/, '');
const PUBLIC_BASE = (process.env.PUBLIC_BASE_URL || 'https://education-planner.nas-timgreen.com').replace(/\/+$/, '');

const WORD = new Set(['docx', 'doc', 'odt', 'rtf', 'txt']);
const CELL = new Set(['xlsx', 'xls', 'ods', 'csv']);
const SLIDE = new Set(['pptx', 'ppt', 'odp']);

export function documentTypeFor(name: string): 'word' | 'cell' | 'slide' | null {
  const ext = path.extname(name).toLowerCase().replace('.', '');
  if (WORD.has(ext)) return 'word';
  if (CELL.has(ext)) return 'cell';
  if (SLIDE.has(ext)) return 'slide';
  return null;
}

function signLong(payload: Record<string, unknown>, days = 2): string {
  return jwt.sign(payload, DS_SECRET || 'office-dev', { expiresIn: `${days}d` });
}

/** Editor-Konfiguration für eine Datei — wird vom Frontend an DocsAPI übergeben. */
officeRouter.post('/nodes/:id/config', requireAuth, async (req: AuthRequest, res) => {
  const access = await nodeAccess(req.params.id, req.userId!);
  if (!access || access.node.kind !== 'file') {
    fail(res, 404, 'not-found', 'Datei nicht gefunden.');
    return;
  }
  const node = access.node;
  const documentType = documentTypeFor(node.name);
  if (!documentType) {
    fail(res, 400, 'unsupported', 'Dieser Dateityp hat keinen Office-Editor.');
    return;
  }
  const ext = path.extname(node.name).toLowerCase().replace('.', '');
  const fileToken = signLong({ nid: node.id, kind: 'file' });
  const callbackToken = signLong({ nid: node.id, kind: 'callback' });

  /** Der Schlüssel muss sich mit jeder neuen Fassung ändern, sonst zeigt der Editor den alten Stand. */
  const docKey = `${node.id.replace(/-/g, '')}-v${node.version}`;
  await pool.query(
    `INSERT INTO office_sessions (node_id, doc_key, updated_at) VALUES ($1,$2, now())
     ON CONFLICT (node_id) DO UPDATE SET doc_key = EXCLUDED.doc_key, updated_at = now()`,
    [node.id, docKey],
  );

  const editable = canWrite(access);
  const config = {
    document: {
      fileType: ext,
      key: docKey,
      title: node.name,
      url: `${INTERNAL_BASE}/api/office/file/${node.id}?t=${fileToken}`,
      permissions: {
        edit: editable,
        download: true,
        print: true,
        comment: editable,
        review: editable,
        fillForms: editable,
      },
    },
    documentType,
    editorConfig: {
      lang: 'de',
      mode: editable ? 'edit' : 'view',
      callbackUrl: `${PUBLIC_BASE}/api/office/callback/${node.id}?t=${callbackToken}`,
      user: { id: String(req.userId), name: req.userName || 'Nutzer' },
      customization: {
        autosave: true,
        forcesave: true,
        compactHeader: false,
        hideRightMenu: true,
        uiTheme: 'theme-dark',
        help: false,
        feedback: false,
        chat: false,
        comments: true,
        spellcheck: true,
      },
    },
    width: '100%',
    height: '100%',
    type: 'desktop',
    token: '',
  };
  config.token = jwt.sign({
    document: config.document,
    documentType: config.documentType,
    editorConfig: config.editorConfig,
  }, DS_SECRET || 'office-dev', { expiresIn: '2h' });

  res.json({ documentServerUrl: DS_PUBLIC_URL, config });
});

/** Datei-Abruf für den Dokumentenserver (Token statt Login). */
officeRouter.get('/office/file/:id', async (req, res) => {
  try {
    const payload = jwt.verify(String(req.query.t ?? ''), DS_SECRET || 'office-dev') as { nid: string; kind: string };
    if (payload.kind !== 'file') throw new Error('falscher Token');
    const node = await loadNode(payload.nid);
    if (!node) throw new Error('Datei fehlt');
    const full = absolute(node.storage_path);
    if (!fs.existsSync(full)) throw new Error('Datei fehlt im Speicher');
    res.setHeader('Content-Type', node.mime || 'application/octet-stream');
    fs.createReadStream(full).pipe(res);
  } catch {
    res.status(403).end();
  }
});

/**
 * Callback des Dokumentenservers: enthält die bearbeitete Fassung.
 * status 2 = fertig, 6 = zwischendurch gespeichert, 3/7 = Fehler, 4 = ohne Änderung geschlossen.
 */
officeRouter.post('/office/callback/:id', async (req, res) => {
  const body = req.body as { status?: number; url?: string; key?: string; token?: string; users?: string[] };
  try {
    const query = jwt.verify(String(req.query.t ?? ''), DS_SECRET || 'office-dev') as { nid: string; kind: string };
    if (query.kind !== 'callback' || query.nid !== req.params.id) throw new Error('falscher Token');
    if (DS_SECRET && body.token) {
      jwt.verify(body.token, DS_SECRET, { algorithms: ['HS256'] });
    }
    const node = await loadNode(req.params.id);
    if (!node) throw new Error('Datei fehlt');

    const status = Number(body.status ?? 0);
    await pool.query(
      'UPDATE office_sessions SET last_status = $2, last_saved_at = now(), updated_at = now() WHERE node_id = $1',
      [node.id, status],
    );

    if (status === 2 || status === 6 || status === 3 || status === 7) {
      if (status === 2 || status === 6) {
        const url = String(body.url ?? '');
        if (!url) throw new Error('keine Download-URL');
        let response = await fetch(url);
        if (response.status === 403 && DS_SECRET) {
          // Mit JWT-Schutz verlangt der Dokumentenserver einen signierten Header.
          const token = jwt.sign({ url }, DS_SECRET, { expiresIn: '5m' });
          response = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
        }
        if (!response.ok) throw new Error(`Download fehlgeschlagen: ${response.status}`);
        const buffer = Buffer.from(await response.arrayBuffer());
        if (!buffer.length) throw new Error('leere Datei');
        await saveVersion(node.id, absolute(node.storage_path), node.version, null, pool);
        const size = await writeAtomic(absolute(node.storage_path), buffer);
        await pool.query(
          'UPDATE nodes SET size = $2, version = version + 1, updated_at = now() WHERE id = $1',
          [node.id, size],
        );
        void indexNode(node.id).catch(() => undefined);
      }
    }
    res.json({ error: 0 });
  } catch (e) {
    // ONLYOFFICE erwartet immer { error: 0|1 }
    res.json({ error: 1, message: e instanceof Error ? e.message : 'Fehler' });
  }
});

/** Erzwingt ein Zwischenspeichern über den Command-Service (Schutz gegen Absturz). */
officeRouter.post('/office/:id/forcesave', requireAuth, async (req: AuthRequest, res) => {
  const access = await nodeAccess(req.params.id, req.userId!);
  if (!access || access.node.kind !== 'file') {
    fail(res, 404, 'not-found', 'Datei nicht gefunden.');
    return;
  }
  if (!canWrite(access)) {
    fail(res, 403, 'forbidden', 'Keine Schreibrechte.');
    return;
  }
  const { rows } = await pool.query<{ doc_key: string }>('SELECT doc_key FROM office_sessions WHERE node_id = $1', [req.params.id]);
  if (!rows.length) {
    res.json({ ok: true, skipped: 'kein offener Editor' });
    return;
  }
  const payload = { c: 'forcesave', key: rows[0].doc_key };
  const token = jwt.sign(payload, DS_SECRET || 'office-dev', { expiresIn: '5m' });
  try {
    const response = await fetch(`${DS_PUBLIC_URL}/coauthoring/CommandService.ashx`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...payload, token }),
    });
    const data = (await response.json()) as { error?: number };
    res.json({ ok: data.error === 0, error: data.error ?? null });
  } catch (e) {
    res.json({ ok: false, message: e instanceof Error ? e.message : 'Command-Service nicht erreichbar' });
  }
});

/** Kurzstatus für die Oberfläche („zuletzt gespeichert"). */
officeRouter.get('/nodes/:id/office-status', requireAuth, async (req: AuthRequest, res) => {
  const access = await nodeAccess(req.params.id, req.userId!);
  if (!access) {
    fail(res, 404, 'not-found', 'Nicht gefunden.');
    return;
  }
  const { rows } = await pool.query('SELECT last_status, last_saved_at FROM office_sessions WHERE node_id = $1', [req.params.id]);
  res.json({ status: rows[0] ?? null, version: access.node.version });
});
