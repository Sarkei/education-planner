import 'dotenv/config';
import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { initDb, pool } from './db';
import { attachUser, fail } from './guards';
import { authRouter } from './auth';
import { nodesRouter } from './nodes';
import { uploadsRouter } from './uploads';
import { sharesRouter } from './shares';
import { officeRouter } from './onlyoffice';
import { searchRouter } from './search';
import { ensureDirs } from './storage';

process.on('unhandledRejection', (reason) => {
  console.error('unhandledRejection', reason);
});
process.on('uncaughtException', (error) => {
  console.error('uncaughtException', error);
});

const app = express();
app.use(express.json({ limit: '2mb' }));

const dist = path.join(process.cwd(), 'dist');

app.get('/api/health', async (_req, res) => {
  try {
    await pool.query('SELECT 1');
    res.json({ ok: true, storage: fs.existsSync(process.env.FILES_ROOT || '/data/files') });
  } catch (e) {
    res.status(500).json({ ok: false, error: e instanceof Error ? e.message : 'db' });
  }
});

app.use('/api', attachUser);
app.use('/api/auth', authRouter);
app.use('/api/nodes', nodesRouter);
app.use('/api/uploads', uploadsRouter);
app.use('/api/shares', sharesRouter);
app.use('/api/search', searchRouter);
app.use('/api', officeRouter);

app.use('/api', (_req, res) => {
  fail(res, 404, 'not-found', 'Unbekannter Endpunkt.');
});

if (fs.existsSync(dist)) {
  app.use(express.static(dist, { index: false, maxAge: '1h' }));
  app.get('*', (_req, res) => {
    res.sendFile(path.join(dist, 'index.html'));
  });
}

const port = Number(process.env.PORT || 3000);

async function start(): Promise<void> {
  ensureDirs();
  await initDb();
  app.listen(port, () => {
    console.log(`education-planner läuft auf :${port}`);
  });
}

void start().catch((e) => {
  console.error('Start fehlgeschlagen', e);
  process.exit(1);
});
