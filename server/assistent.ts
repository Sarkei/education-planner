/**
 * KI-Assistent für den Education Planner.
 *
 * Kein Text-Chat: Das Modell bekommt Werkzeuge und arbeitet selbstständig damit —
 * suchen, lesen, anlegen, verschieben, umbenennen, löschen, bearbeiten, PDFs ausfüllen.
 *
 * Ablauf einer Anfrage:
 *   1. Werkzeuge + Verzeichnis-Kontext an das Modell
 *   2. Modell ruft Werkzeuge auf → wir führen aus → Ergebnis zurück ans Modell
 *   3. solange, bis das Modell mit Text antwortet (max. 12 Runden)
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { pool } from './db';
import { absolute, saveVersion, writeAtomic, TRASH_ROOT } from './storage';
import { lesePdf, schreibePdf, leseZeichnungen, rendereSeite, leseFormularfelder, leseTabellen, leseKaestchen } from './pdfkit';
import { mimeFor } from './templates';

type Provider = { name: string; apiKey: string; baseUrl: string; model: string };

function nutzbarerKey(key: string | undefined): boolean {
  const t = key?.trim();
  return Boolean(t && t.length >= 16 && !/your[_-]/i.test(t));
}

export function resolveProvider(): Provider | null {
  const bevorzugt = (process.env.AI_ACTIVE_PROVIDER || 'deepseek').trim().toLowerCase();
  const kandidaten: Provider[] = [
    {
      name: 'deepseek',
      apiKey: process.env.DEEPSEEK_API_KEY?.trim() ?? '',
      baseUrl: (process.env.DEEPSEEK_BASE_URL?.trim() || 'https://api.deepseek.com/v1').replace(/\/+$/, ''),
      model: process.env.AI_DEEPSEEK_MODEL?.trim() || 'deepseek-chat',
    },
    {
      name: 'mistral',
      apiKey: process.env.MISTRAL_API_KEY?.trim() ?? '',
      baseUrl: (process.env.MISTRAL_BASE_URL?.trim() || 'https://api.mistral.ai/v1').replace(/\/+$/, ''),
      model: process.env.AI_MISTRAL_MODEL?.trim() || 'mistral-large-latest',
    },
    {
      name: 'gemini',
      apiKey: process.env.GEMINI_API_KEY?.trim() ?? '',
      baseUrl: (process.env.GEMINI_BASE_URL?.trim() || 'https://generativelanguage.googleapis.com/v1beta').replace(/\/+$/, ''),
      model: process.env.AI_GEMINI_MODEL?.trim() || 'gemini-2.5-flash',
    },
  ];
  const nutzbar = kandidaten.filter((k) => nutzbarerKey(k.apiKey));
  if (!nutzbar.length) return null;
  return nutzbar.find((k) => k.name === bevorzugt) ?? nutzbar[0];
}

// ─────────────────────────── Werkzeuge ───────────────────────────

export type WerkzeugAufruf = { id: string; name: string; argumente: Record<string, unknown> };
export type WerkzeugErgebnis = { id: string; name: string; inhalt: string; ok: boolean };

type Kontext = { userId: number };

/** Alle Knoten eines Nutzers (eigene + geteilte mit Schreibrecht). */
async function ladeBaum(userId: number): Promise<Array<Record<string, unknown>>> {
  const { rows } = await pool.query(
    `WITH RECURSIVE eigene AS (
        SELECT id, parent_id, name, kind, mime, size, version, owner_id, trashed_at, updated_at, storage_path
          FROM nodes WHERE owner_id = $1 AND trashed_at IS NULL
      ),
      geteilt AS (
        SELECT n.id, n.parent_id, n.name, n.kind, n.mime, n.size, n.version, n.owner_id, n.trashed_at, n.updated_at, n.storage_path
          FROM nodes n
          JOIN shares s ON s.node_id = n.id AND s.user_id = $1 AND s.permission = 'edit'
         WHERE n.trashed_at IS NULL
         UNION ALL
        SELECT n.id, n.parent_id, n.name, n.kind, n.mime, n.size, n.version, n.owner_id, n.trashed_at, n.updated_at, n.storage_path
          FROM nodes n JOIN geteilt g ON n.parent_id = g.id
         WHERE n.trashed_at IS NULL
      )
      SELECT * FROM eigene UNION SELECT * FROM geteilt`,
    [userId],
  );
  return rows as Array<Record<string, unknown>>;
}

/** Dateiendung klein. */
function endung(name: string): string {
  return (name.split('.').pop() ?? '').toLowerCase();
}

const TEXT_ENDUNGEN = [
  'txt', 'md', 'csv', 'tsv', 'json', 'xml', 'html', 'htm', 'css', 'js', 'ts', 'yml', 'yaml',
  'ini', 'cfg', 'conf', 'sh', 'bat', 'ps1', 'sql', 'log', 'tex', 'srt', 'vtt',
];

/** Prüft Schreibrecht auf einen Ordner/Knoten. */
async function darfSchreiben(nodeId: string, userId: number): Promise<boolean> {
  const { rows } = await pool.query(
    `WITH RECURSIVE kette AS (
        SELECT n.id, n.parent_id, n.owner_id, 0 AS tiefe FROM nodes n WHERE n.id = $1
        UNION ALL
        SELECT p.id, p.parent_id, p.owner_id, k.tiefe + 1 FROM nodes p JOIN kette k ON p.id = k.parent_id
      )
      SELECT k.owner_id, k.tiefe, s.permission FROM kette k
        LEFT JOIN shares s ON s.node_id = k.id AND s.user_id = $2
       ORDER BY k.tiefe ASC`,
    [nodeId, userId],
  );
  if (!rows.length) return false;
  if (rows[0].owner_id === userId) return true;
  return rows.some((r: { permission: string | null }) => r.permission === 'edit');
}

/** Werkzeug: Baum auflisten (kompakt, damit es ins Kontextfenster passt). */
async function toolBaum(_args: Record<string, unknown>, ctx: Kontext): Promise<string> {
  const knoten = await ladeBaum(ctx.userId);
  if (!knoten.length) return 'Keine Dateien vorhanden.';
  const nachId = new Map<string, Record<string, unknown>>();
  for (const n of knoten) nachId.set(String(n.id), n);

  const pfad = (n: Record<string, unknown>): string => {
    const teile: string[] = [String(n.name)];
    let elternId = n.parent_id ? String(n.parent_id) : null;
    let schutz = 0;
    while (elternId && schutz++ < 40) {
      const eltern = nachId.get(elternId);
      if (!eltern) break;
      teile.unshift(String(eltern.name));
      elternId = eltern.parent_id ? String(eltern.parent_id) : null;
    }
    return teile.join('/');
  };

  const zeilen = knoten
    .map((n) => {
      const groesse = n.kind === 'file' ? ` (${Math.round(Number(n.size) / 1024)} KB)` : '';
      return `${n.kind === 'folder' ? '[Ordner]' : '[Datei] '} ${pfad(n)}${groesse}`;
    })
    .sort();
  return `${knoten.length} Einträge:\n${zeilen.join('\n')}`;
}

/** Werkzeug: Volltextsuche in Namen und indizierten Inhalten. */
async function toolSuche(args: Record<string, unknown>, ctx: Kontext): Promise<string> {
  const begriff = String(args.begriff ?? '').trim();
  if (!begriff) return 'Kein Suchbegriff angegeben.';
  const { rows } = await pool.query(
    `SELECT n.id, n.name, n.kind, n.parent_id,
            ts_headline('german', coalesce(t.content, ''), plainto_tsquery('german', $2),
                        'MaxFragments=2,MaxWords=25') AS auszug
       FROM nodes n
       LEFT JOIN node_texts t ON t.node_id = n.id
      WHERE n.trashed_at IS NULL
        AND (n.owner_id = $1 OR EXISTS (SELECT 1 FROM shares s WHERE s.node_id = n.id AND s.user_id = $1))
        AND (n.name ILIKE $3 OR t.tsv @@ plainto_tsquery('german', $2))
      ORDER BY (n.name ILIKE $3) DESC, n.updated_at DESC
      LIMIT 20`,
    [ctx.userId, begriff, `%${begriff}%`],
  );
  if (!rows.length) return `Nichts zu „${begriff}" gefunden.`;
  return rows
    .map((r: { name: string; kind: string; auszug: string | null }) => {
      const auszug = (r.auszug ?? '').replace(/\s+/g, ' ').trim();
      return `${r.kind === 'folder' ? '[Ordner]' : '[Datei]'} ${r.name}${auszug ? `\n   … ${auszug.slice(0, 200)}` : ''}`;
    })
    .join('\n');
}

/** Werkzeug: Inhalt einer Datei lesen (Text oder PDF-Struktur). */
async function toolLesen(args: Record<string, unknown>, ctx: Kontext): Promise<string> {
  const name = String(args.name ?? '').trim();
  if (!name) return 'Kein Dateiname angegeben.';
  const knoten = await ladeBaum(ctx.userId);
  const treffer = knoten.filter((n) => String(n.name).toLowerCase() === name.toLowerCase());
  const datei = treffer.find((n) => n.kind === 'file');
  if (!datei) return `Datei „${name}" nicht gefunden. Vorhanden: ${knoten.filter((n) => n.kind === 'file').map((n) => n.name).slice(0, 15).join(', ')}`;

  const ext = endung(String(datei.name));
  const pfad = absolute(String(datei.storage_path ?? ''));

  try {
    if (ext === 'pdf') {
      const struktur = await lesePdf(pfad);
      const formular = await leseFormularfelder(pfad);
      const zeich = await leseZeichnungen(pfad);
      const kaestchen = zeich.filter((z) => z.art === 'kaestchen');
      const linien = zeich.filter((z) => z.art === 'schreiblinie');
      const teile = [
        `PDF „${datei.name}" — ${struktur.seiten} Seite(n), ${struktur.hatText ? 'mit Textebene' : 'NUR BILD, keine Textebene (Scan)'}`,
      ];
      if (struktur.hatText) {
        teile.push(`\nText:\n${struktur.text.slice(0, 6000)}`);
        teile.push(
          `\nTextzeilen mit Koordinaten (x/y in PDF-Punkten, y von unten):\n${struktur.zeilen
            .slice(0, 80)
            .map((z) => `  S${z.seite} (${z.x}/${z.y}) gr=${z.groesse}: ${z.text.slice(0, 80)}`)
            .join('\n')}`,
        );
      }
      if (formular.length) {
        teile.push(
          `\nFormularfelder (${formular.length}):\n${formular
            .map((f) => `  „${f.name}" (${f.typ}) S${f.seite} bei (${f.x}/${f.y}) ${f.breite}x${f.hoehe}${f.wert ? ` = „${f.wert}"` : ''}`)
            .join('\n')}`,
        );
      }
      // Tabellenzeilen aus den Schreiblinien ableiten: y-Abstand = Zeilenhöhe
      const horizontale = zeich.filter((z) => z.art === 'schreiblinie');
      const nachSeite = new Map<number, number[]>();
      for (const h of horizontale) {
        const liste = nachSeite.get(h.seite) ?? [];
        liste.push(h.y);
        nachSeite.set(h.seite, liste);
      }
      const zeilenHoehen: string[] = [];
      for (const [seite, ys] of nachSeite) {
        const sortiert = [...new Set(ys)].sort((a, b) => b - a);
        for (let i = 1; i < sortiert.length; i++) {
          const abstand = sortiert[i - 1] - sortiert[i];
          if (abstand > 8 && abstand < 40) {
            zeilenHoehen.push(`  S${seite} zwischen y=${sortiert[i]} und y=${sortiert[i - 1]}: Höhe ${abstand} pt`);
          }
        }
      }
      if (zeilenHoehen.length) {
        teile.push(`\nVerfügbare Zeilenhöhen (für „hoehe" bei pdf_ausfuellen):\n${zeilenHoehen.slice(0, 20).join('\n')}`);
      }
      // Strukturierte Tabellen: Zellen mit Koordinaten und vorhandenem Text
      const tabellen = await leseTabellen(pfad);
      for (const [ti, tab] of tabellen.entries()) {
        teile.push(`\nTabelle ${ti + 1} auf Seite ${tab.seite}: ${tab.zeilen} Zeilen x ${tab.spalten} Spalten`);
        teile.push(
          tab.zellen
            .slice(0, 60)
            .map(
              (z) =>
                `  Z${z.zeile}S${z.spalte} bei (${z.x}/${z.y}) ${z.breite}x${z.hoehe}${z.inhalt ? ` = „${z.inhalt.slice(0, 40)}"` : ' (leer)'}`,
            )
            .join('\n'),
        );
      }

      const kaestchenMitLabel = await leseKaestchen(pfad);
      if (kaestchenMitLabel.length) {
        teile.push(
          `\nAnkreuzkästchen (${kaestchenMitLabel.length}) — zum Ankreuzen „kaestchen" mit genau diesen Werten nutzen:\n${kaestchenMitLabel
            .map((k) => `  „${k.beschriftung}" S${k.seite} bei (${k.x}/${k.y}) ${k.breite}x${k.hoehe}`)
            .join('\n')}`,
        );
      }
      if (linien.length) {
        teile.push(
          `\nSchreiblinien (${linien.length}):\n${linien
            .slice(0, 30)
            .map((l) => `  S${l.seite} bei (${l.x}/${l.y}) Breite ${l.breite}`)
            .join('\n')}`,
        );
      }
      return teile.join('\n');
    }

    if (TEXT_ENDUNGEN.includes(ext)) {
      const inhalt = fs.readFileSync(pfad, 'utf8');
      return inhalt.length > 12000 ? `${inhalt.slice(0, 12000)}\n… (gekürzt)` : inhalt;
    }

    if (['docx', 'xlsx', 'pptx'].includes(ext)) {
      const { rows } = await pool.query('SELECT content FROM node_texts WHERE node_id = $1', [datei.id]);
      const text = rows[0]?.content;
      if (text && String(text).trim()) return `Inhalt von „${datei.name}":\n${String(text).slice(0, 8000)}`;
      return `„${datei.name}" ist ein ${ext.toUpperCase()}-Dokument ohne extrahierten Text. Nutze bearbeite_office, um es zu ändern.`;
    }
    return `„${datei.name}" (${ext}) lässt sich nicht als Text lesen. Herunterladen oder per Bild ansehen ist möglich.`;
  } catch (e) {
    return `Fehler beim Lesen: ${e instanceof Error ? e.message : 'unbekannt'}`;
  }
}

/** Werkzeug: Ordner anlegen. */
async function toolOrdner(args: Record<string, unknown>, ctx: Kontext): Promise<string> {
  const name = String(args.name ?? '').trim();
  if (!name) return 'Kein Name angegeben.';
  const elternName = args.eltern ? String(args.eltern).trim() : '';

  let parentId: string | null = null;
  if (elternName) {
    const knoten = await ladeBaum(ctx.userId);
    const eltern = knoten.find((n) => n.kind === 'folder' && String(n.name).toLowerCase() === elternName.toLowerCase());
    if (!eltern) return `Elternordner „${elternName}" nicht gefunden.`;
    if (!(await darfSchreiben(String(eltern.id), ctx.userId))) return `Kein Schreibrecht auf „${elternName}".`;
    parentId = String(eltern.id);
  }

  const id = crypto.randomUUID();
  await fs.promises.mkdir(absolute(name), { recursive: true });
  await pool.query(
    `INSERT INTO nodes (id, parent_id, name, kind, storage_path, owner_id, position)
     VALUES ($1,$2,$3,'folder',$4,$5,
             coalesce((select max(position)+1 from nodes where parent_id is not distinct from $2), 0))`,
    [id, parentId, name, name, ctx.userId],
  );
  return `Ordner „${name}" angelegt${elternName ? ` in „${elternName}"` : ' auf oberster Ebene'}.`;
}

/** Werkzeug: Textdatei anlegen oder überschreiben. */
async function toolDatei(args: Record<string, unknown>, ctx: Kontext): Promise<string> {
  const name = String(args.name ?? '').trim();
  const inhalt = String(args.inhalt ?? '');
  if (!name) return 'Kein Dateiname angegeben.';
  if (!endung(name)) return 'Der Dateiname braucht eine Endung, z. B. .md oder .txt.';
  const elternName = args.eltern ? String(args.eltern).trim() : '';

  let parentId: string | null = null;
  let elternPfad = '';
  if (elternName) {
    const knoten = await ladeBaum(ctx.userId);
    const eltern = knoten.find((n) => n.kind === 'folder' && String(n.name).toLowerCase() === elternName.toLowerCase());
    if (!eltern) return `Elternordner „${elternName}" nicht gefunden.`;
    if (!(await darfSchreiben(String(eltern.id), ctx.userId))) return `Kein Schreibrecht auf „${elternName}".`;
    parentId = String(eltern.id);
    elternPfad = String(eltern.storage_path ?? '');
  }

  const existierend = await pool.query(
    'SELECT id, storage_path, version FROM nodes WHERE parent_id IS NOT DISTINCT FROM $1 AND lower(name) = lower($2) AND kind = $3',
    [parentId, name, 'file'],
  );

  const storagePfad = elternPfad ? `${elternPfad}/${name}` : name;
  const ziel = absolute(storagePfad);

  if (existierend.rows.length) {
    const vorhanden = existierend.rows[0] as { id: string; storage_path: string; version: number };
    await saveVersion(vorhanden.id, absolute(vorhanden.storage_path), vorhanden.version, ctx.userId, pool);
    await writeAtomic(ziel, Buffer.from(inhalt, 'utf8'));
    await pool.query('UPDATE nodes SET version = version + 1, size = $2, updated_at = now() WHERE id = $1', [
      vorhanden.id,
      Buffer.byteLength(inhalt),
    ]);
    await pool.query(
      `UPDATE node_texts SET content = $2, version = version + 1, updated_at = now() WHERE node_id = $1`,
      [vorhanden.id, inhalt],
    );
    return `„${name}" überschrieben (alte Fassung als Version gesichert).`;
  }

  const dateiId = crypto.randomUUID();
  await pool.query(
    `INSERT INTO nodes (id, parent_id, name, kind, storage_path, mime, size, owner_id, position)
     VALUES ($1,$2,$3,'file',$4,$5,$6,$7,
             coalesce((select max(position)+1 from nodes where parent_id is not distinct from $2), 0))`,
    [dateiId, parentId, name, storagePfad, mimeFor(name), Buffer.byteLength(inhalt), ctx.userId],
  );
  await writeAtomic(ziel, Buffer.from(inhalt, 'utf8'));
  await pool.query(
    `INSERT INTO node_texts (node_id, version, content) VALUES ($1, 0, $2)
     ON CONFLICT (node_id) DO UPDATE SET content = EXCLUDED.content, updated_at = now()`,
    [dateiId, inhalt],
  );
  return `Datei „${name}" angelegt${elternName ? ` in „${elternName}"` : ''} (${Buffer.byteLength(inhalt)} Bytes).`;
}

/** Werkzeug: verschieben. */
async function toolVerschieben(args: Record<string, unknown>, ctx: Kontext): Promise<string> {
  const was = String(args.was ?? '').trim();
  const zielOrdner = args.nach ? String(args.nach).trim() : '';
  if (!was) return 'Kein Name angegeben.';

  const knoten = await ladeBaum(ctx.userId);
  const treffer = knoten.filter((n) => String(n.name).toLowerCase() === was.toLowerCase());
  if (!treffer.length) return `„${was}" nicht gefunden.`;
  if (treffer.length > 1) return `„${was}" ist mehrdeutig (${treffer.length} Treffer). Nenne den vollen Pfad.`;
  const k = treffer[0];
  if (!(await darfSchreiben(String(k.id), ctx.userId))) return `Kein Schreibrecht auf „${was}".`;

  let neuerParent: string | null = null;
  let neuerPfadBasis = '';
  if (zielOrdner) {
    const ziel = knoten.find((n) => n.kind === 'folder' && String(n.name).toLowerCase() === zielOrdner.toLowerCase());
    if (!ziel) return `Zielordner „${zielOrdner}" nicht gefunden.`;
    if (!(await darfSchreiben(String(ziel.id), ctx.userId))) return `Kein Schreibrecht auf „${zielOrdner}".`;
    neuerParent = String(ziel.id);
    neuerPfadBasis = String(ziel.storage_path ?? '');
  }

  const alterPfad = absolute(String(k.storage_path ?? ''));
  const neuerPfad = absolute(neuerPfadBasis ? `${neuerPfadBasis}/${k.name}` : String(k.name));

  await pool.query('UPDATE nodes SET parent_id = $2, storage_path = $3, updated_at = now() WHERE id = $1', [
    k.id,
    neuerParent,
    neuerPfadBasis ? `${neuerPfadBasis}/${k.name}` : String(k.name),
  ]);

  // Auch die Kinder mitziehen (rekursiv)
  await pool.query(
    `WITH RECURSIVE unter AS (
        SELECT id, storage_path FROM nodes WHERE parent_id = $1
        UNION ALL
        SELECT n.id, n.storage_path FROM nodes n JOIN unter u ON n.parent_id = u.id
      )
      UPDATE nodes SET storage_path = replace(storage_path, $2, $3) WHERE id IN (SELECT id FROM unter)`,
    [k.id, String(k.storage_path), neuerPfadBasis ? `${neuerPfadBasis}/${k.name}` : String(k.name)],
  );

  try {
    if (fs.existsSync(alterPfad) && alterPfad !== neuerPfad) {
      fs.mkdirSync(path.dirname(neuerPfad), { recursive: true });
      fs.renameSync(alterPfad, neuerPfad);
    }
  } catch (e) {
    return `Datenbank aktualisiert, aber Verschieben im Speicher scheiterte: ${e instanceof Error ? e.message : 'unbekannt'}`;
  }

  return `„${was}" ${zielOrdner ? `nach „${zielOrdner}"` : 'auf die oberste Ebene'} verschoben.`;
}

/** Werkzeug: umbenennen. */
async function toolUmbenennen(args: Record<string, unknown>, ctx: Kontext): Promise<string> {
  const was = String(args.was ?? '').trim();
  const neu = String(args.neu ?? '').trim();
  if (!was || !neu) return 'Alter und neuer Name werden gebraucht.';
  const knoten = await ladeBaum(ctx.userId);
  const treffer = knoten.filter((n) => String(n.name).toLowerCase() === was.toLowerCase());
  if (treffer.length !== 1) return treffer.length ? `„${was}" ist mehrdeutig.` : `„${was}" nicht gefunden.`;
  const k = treffer[0];
  if (!(await darfSchreiben(String(k.id), ctx.userId))) return `Kein Schreibrecht auf „${was}".`;

  const alterPfad = absolute(String(k.storage_path ?? ''));
  const teile = String(k.storage_path ?? '').split('/');
  teile[teile.length - 1] = neu;
  const neuerPfad = teile.join('/');

  await pool.query('UPDATE nodes SET name = $2, storage_path = $3, updated_at = now() WHERE id = $1', [
    k.id,
    neu,
    neuerPfad,
  ]);
  try {
    if (fs.existsSync(alterPfad)) fs.renameSync(alterPfad, absolute(neuerPfad));
  } catch {
    /* Speicher folgt beim nächsten Zugriff */
  }
  return `„${was}" heißt jetzt „${neu}".`;
}

/** Werkzeug: in den Papierkorb. */
async function toolLoeschen(args: Record<string, unknown>, ctx: Kontext): Promise<string> {
  const was = String(args.was ?? '').trim();
  if (!was) return 'Kein Name angegeben.';
  const knoten = await ladeBaum(ctx.userId);
  const treffer = knoten.filter((n) => String(n.name).toLowerCase() === was.toLowerCase());
  if (treffer.length !== 1) return treffer.length ? `„${was}" ist mehrdeutig.` : `„${was}" nicht gefunden.`;
  const k = treffer[0];
  if (!(await darfSchreiben(String(k.id), ctx.userId))) return `Kein Schreibrecht auf „${was}".`;

  const quelle = absolute(String(k.storage_path ?? ''));
  const ziel = path.join(TRASH_ROOT, String(k.id));
  try {
    if (fs.existsSync(quelle)) {
      fs.mkdirSync(TRASH_ROOT, { recursive: true });
      fs.cpSync(quelle, ziel, { recursive: true });
    }
  } catch {
    /* Papierkorb ist optional */
  }

  await pool.query(
    `WITH RECURSIVE unter AS (
        SELECT id FROM nodes WHERE id = $1
        UNION ALL SELECT n.id FROM nodes n JOIN unter u ON n.parent_id = u.id
      )
      UPDATE nodes SET trashed_at = now() WHERE id IN (SELECT id FROM unter)`,
    [k.id],
  );
  return `„${was}" in den Papierkorb gelegt (wiederherstellbar).`;
}

/** Werkzeug: PDF an Koordinaten ausfüllen. */
async function toolPdfAusfuellen(args: Record<string, unknown>, ctx: Kontext): Promise<string> {
  const name = String(args.name ?? '').trim();
  const auftraege = Array.isArray(args.auftraege) ? (args.auftraege as Array<Record<string, unknown>>) : [];
  if (!name || !auftraege.length) return 'Name und auftraege werden gebraucht.';

  const knoten = await ladeBaum(ctx.userId);
  const datei = knoten.find((n) => n.kind === 'file' && String(n.name).toLowerCase() === name.toLowerCase());
  if (!datei) return `PDF „${name}" nicht gefunden.`;
  if (!(await darfSchreiben(String(datei.id), ctx.userId))) return `Kein Schreibrecht auf „${name}".`;
  if (endung(String(datei.name)) !== 'pdf') return `„${name}" ist kein PDF.`;

  const quelle = absolute(String(datei.storage_path ?? ''));
  const arbeitsdatei = path.join(path.dirname(quelle), `.${path.basename(quelle)}.${Date.now()}.tmp.pdf`);

  const schreibauftraege = auftraege.map((a) => {
    const art = String(a.art ?? 'text');
    if (art === 'feld') return { art: 'feld' as const, name: String(a.name), wert: String(a.wert ?? '') };
    if (art === 'kaestchen') {
      return {
        art: 'kaestchen' as const,
        seite: Number(a.seite ?? 1),
        x: Number(a.x ?? 0),
        y: Number(a.y ?? 0),
        breite: Number(a.breite ?? 10),
        hoehe: Number(a.hoehe ?? 10),
      };
    }
    return {
      art: 'text' as const,
      seite: Number(a.seite ?? 1),
      x: Number(a.x ?? 0),
      y: Number(a.y ?? 0),
      text: String(a.text ?? ''),
      groesse: a.groesse !== undefined ? Number(a.groesse) : undefined,
      breite: a.breite !== undefined ? Number(a.breite) : undefined,
      hoehe: a.hoehe !== undefined ? Number(a.hoehe) : undefined,
    };
  });

  try {
    const ergebnis = await schreibePdf(quelle, arbeitsdatei, schreibauftraege);
    if (!ergebnis.erfolgreich) {
      fs.rmSync(arbeitsdatei, { force: true });
      return `Nichts geschrieben. Probleme: ${ergebnis.fehlgeschlagen.map((f) => f.grund).join('; ')}`;
    }

    // Sicherung der alten Fassung, dann ersetzen
    await saveVersion(String(datei.id), quelle, Number(datei.version), ctx.userId, pool);
    const neueGroesse = fs.statSync(arbeitsdatei).size;
    fs.renameSync(arbeitsdatei, quelle);
    await pool.query('UPDATE nodes SET version = version + 1, size = $2, updated_at = now() WHERE id = $1', [
      datei.id,
      neueGroesse,
    ]);

    const teile = [`${ergebnis.erfolgreich} Einträge in „${name}" geschrieben.`];
    if (ergebnis.hinweise.length) teile.push(`Hinweise: ${ergebnis.hinweise.join('; ')}`);
    if (ergebnis.fehlgeschlagen.length) {
      teile.push(`Nicht geschrieben: ${ergebnis.fehlgeschlagen.map((f) => f.grund).join('; ')}`);
    }
    return teile.join(' ');
  } catch (e) {
    fs.rmSync(arbeitsdatei, { force: true });
    return `Fehler beim Ausfüllen: ${e instanceof Error ? e.message : 'unbekannt'}`;
  }
}

/** Werkzeug: Seite eines PDF als Bild beschreiben (für die Sichtprüfung durch das Modell). */
async function toolPdfBild(args: Record<string, unknown>, ctx: Kontext): Promise<string> {
  const name = String(args.name ?? '').trim();
  const seite = Number(args.seite ?? 1);
  const knoten = await ladeBaum(ctx.userId);
  const datei = knoten.find((n) => n.kind === 'file' && String(n.name).toLowerCase() === name.toLowerCase());
  if (!datei) return `PDF „${name}" nicht gefunden.`;
  const quelle = absolute(String(datei.storage_path ?? ''));
  try {
    const png = await rendereSeite(quelle, seite, 100);
    return `Bild der Seite ${seite}: ${png.length} Bytes (Base64 folgt getrennt).`;
  } catch (e) {
    return `Konnte Seite nicht rendern: ${e instanceof Error ? e.message : 'unbekannt'}`;
  }
}

/** Werkzeug: Text in vorhandene Textdatei einfügen/ergänzen. */
async function toolErgaenzen(args: Record<string, unknown>, ctx: Kontext): Promise<string> {
  const name = String(args.name ?? '').trim();
  const text = String(args.text ?? '');
  const position = String(args.position ?? 'ende');
  if (!name) return 'Kein Dateiname angegeben.';
  const knoten = await ladeBaum(ctx.userId);
  const datei = knoten.find((n) => n.kind === 'file' && String(n.name).toLowerCase() === name.toLowerCase());
  if (!datei) return `„${name}" nicht gefunden.`;
  if (!(await darfSchreiben(String(datei.id), ctx.userId))) return `Kein Schreibrecht auf „${name}".`;
  const pfad = absolute(String(datei.storage_path ?? ''));
  try {
    const alt = fs.existsSync(pfad) ? fs.readFileSync(pfad, 'utf8') : '';
    const neu = position === 'anfang' ? `${text}\n${alt}` : `${alt}\n${text}`;
    await saveVersion(String(datei.id), pfad, Number(datei.version), ctx.userId, pool);
    await writeAtomic(pfad, Buffer.from(neu, 'utf8'));
    await pool.query('UPDATE nodes SET version = version + 1, size = $2, updated_at = now() WHERE id = $1', [
      datei.id,
      Buffer.byteLength(neu),
    ]);
    await pool.query(
      `INSERT INTO node_texts (node_id, version, content) VALUES ($1, 0, $2)
       ON CONFLICT (node_id) DO UPDATE SET content = EXCLUDED.content, updated_at = now()`,
      [datei.id, neu],
    );
    return `„${name}" ergänzt (${position}).`;
  } catch (e) {
    return `Fehler: ${e instanceof Error ? e.message : 'unbekannt'}`;
  }
}


/** Werkzeug: in eine erkannte Tabellenzelle schreiben (Position und Größe kommen aus dem PDF). */
async function toolZelleSchreiben(args: Record<string, unknown>, ctx: Kontext): Promise<string> {
  const name = String(args.name ?? '').trim();
  const zeile = Number(args.zeile);
  const spalte = Number(args.spalte);
  const text = String(args.text ?? '');
  const tabelleNr = args.tabelle !== undefined ? Number(args.tabelle) : 1;
  if (!name || !text) return 'Name und Text werden gebraucht.';

  const knoten = await ladeBaum(ctx.userId);
  const datei = knoten.find((n) => n.kind === 'file' && String(n.name).toLowerCase() === name.toLowerCase());
  if (!datei) return `Datei „${name}" nicht gefunden.`;
  if (!(await darfSchreiben(String(datei.id), ctx.userId))) return `Kein Schreibrecht auf „${name}".`;

  const quelle = absolute(String(datei.storage_path ?? ''));
  const tabellen = await leseTabellen(quelle);
  const tab = tabellen[tabelleNr - 1];
  if (!tab) return `Tabelle ${tabelleNr} nicht gefunden (${tabellen.length} erkannt).`;
  const zelle = tab.zellen.find((z) => z.zeile === zeile && z.spalte === spalte);
  if (!zelle) return `Zelle (Zeile ${zeile}, Spalte ${spalte}) gibt es nicht. Tabelle hat ${tab.zeilen} Zeilen, ${tab.spalten} Spalten.`;

  const arbeitsdatei = path.join(path.dirname(quelle), `.${path.basename(quelle)}.${Date.now()}.tmp.pdf`);
  const ergebnis = await schreibePdf(quelle, arbeitsdatei, [
    {
      art: 'text',
      seite: tab.seite,
      x: zelle.x + 2,
      y: zelle.y + 2,
      text,
      breite: zelle.breite - 4,
      hoehe: zelle.hoehe - 3,
      groesse: args.groesse !== undefined ? Number(args.groesse) : undefined,
    },
  ]);

  if (!ergebnis.erfolgreich) {
    fs.rmSync(arbeitsdatei, { force: true });
    return `Konnte nicht schreiben: ${ergebnis.fehlgeschlagen.map((f) => f.grund).join('; ')}`;
  }

  await saveVersion(String(datei.id), quelle, Number(datei.version), ctx.userId, pool);
  const neueGroesse = fs.statSync(arbeitsdatei).size;
  fs.renameSync(arbeitsdatei, quelle);
  await pool.query('UPDATE nodes SET version = version + 1, size = $2, updated_at = now() WHERE id = $1', [
    datei.id,
    neueGroesse,
  ]);

  return `Zelle (Zeile ${zeile}, Spalte ${spalte}) beschrieben: „${text.slice(0, 60)}"${ergebnis.hinweise.length ? ` — ${ergebnis.hinweise.join('; ')}` : ''} Angepasste Schriftgröße.`;
}

/** Werkzeug: Kästchen anhand der Beschriftung ankreuzen. */
async function toolAnkreuzen(args: Record<string, unknown>, ctx: Kontext): Promise<string> {
  const name = String(args.name ?? '').trim();
  const beschriftung = String(args.beschriftung ?? '').trim();
  if (!name || !beschriftung) return 'Name und Beschriftung werden gebraucht.';

  const knoten = await ladeBaum(ctx.userId);
  const datei = knoten.find((n) => n.kind === 'file' && String(n.name).toLowerCase() === name.toLowerCase());
  if (!datei) return `Datei „${name}" nicht gefunden.`;
  if (!(await darfSchreiben(String(datei.id), ctx.userId))) return `Kein Schreibrecht auf „${name}".`;

  const quelle = absolute(String(datei.storage_path ?? ''));
  const kaestchen = await leseKaestchen(quelle);
  const treffer = kaestchen.filter((k) =>
    k.beschriftung.toLowerCase().includes(beschriftung.toLowerCase()),
  );
  if (!treffer.length) {
    return `Kein Kästchen mit „${beschriftung}" gefunden. Vorhanden: ${kaestchen.map((k) => k.beschriftung || '(ohne Text)').join(', ')}`;
  }
  if (treffer.length > 1) {
    return `Mehrere Kästchen passen zu „${beschriftung}": ${treffer.map((t) => t.beschriftung).join(', ')}. Nenne den genauen Text.`;
  }
  const k = treffer[0];

  const arbeitsdatei = path.join(path.dirname(quelle), `.${path.basename(quelle)}.${Date.now()}.tmp.pdf`);
  const ergebnis = await schreibePdf(quelle, arbeitsdatei, [
    { art: 'kaestchen', seite: k.seite, x: k.x, y: k.y, breite: k.breite, hoehe: k.hoehe },
  ]);
  if (!ergebnis.erfolgreich) {
    fs.rmSync(arbeitsdatei, { force: true });
    return `Ankreuzen fehlgeschlagen: ${ergebnis.fehlgeschlagen.map((f) => f.grund).join('; ')}`;
  }

  await saveVersion(String(datei.id), quelle, Number(datei.version), ctx.userId, pool);
  const neueGroesse = fs.statSync(arbeitsdatei).size;
  fs.renameSync(arbeitsdatei, quelle);
  await pool.query('UPDATE nodes SET version = version + 1, size = $2, updated_at = now() WHERE id = $1', [
    datei.id,
    neueGroesse,
  ]);
  return `Kästchen „${k.beschriftung}" angekreuzt.`;
}

/** Werkzeug: Text auf eine Schreiblinie setzen (Linie 1..n, y kommt aus dem PDF). */
async function toolAufLinie(args: Record<string, unknown>, ctx: Kontext): Promise<string> {
  const name = String(args.name ?? '').trim();
  const linie = Number(args.linie ?? 1);
  const text = String(args.text ?? '');
  if (!name || !text) return 'Name und Text werden gebraucht.';

  const knoten = await ladeBaum(ctx.userId);
  const datei = knoten.find((n) => n.kind === 'file' && String(n.name).toLowerCase() === name.toLowerCase());
  if (!datei) return `Datei „${name}" nicht gefunden.`;
  if (!(await darfSchreiben(String(datei.id), ctx.userId))) return `Kein Schreibrecht auf „${name}".`;

  const quelle = absolute(String(datei.storage_path ?? ''));
  const zeich = await leseZeichnungen(quelle);
  // Schreiblinien: breit, flach, untereinander — von oben nach unten sortiert
  const linien = zeich
    .filter((z) => z.art === 'schreiblinie' && z.breite >= 100)
    .sort((a, b) => b.y - a.y);
  if (!linien.length) return 'Keine Schreiblinien gefunden.';
  const l = linien[linie - 1];
  if (!l) return `Es gibt nur ${linien.length} Schreiblinien.`;

  const arbeitsdatei = path.join(path.dirname(quelle), `.${path.basename(quelle)}.${Date.now()}.tmp.pdf`);
  const ergebnis = await schreibePdf(quelle, arbeitsdatei, [
    {
      art: 'text',
      seite: l.seite,
      x: l.x + 2,
      y: l.y + 3,
      text,
      breite: l.breite - 4,
      hoehe: 18,
      groesse: args.groesse !== undefined ? Number(args.groesse) : undefined,
    },
  ]);
  if (!ergebnis.erfolgreich) {
    fs.rmSync(arbeitsdatei, { force: true });
    return `Schreiben fehlgeschlagen: ${ergebnis.fehlgeschlagen.map((f) => f.grund).join('; ')}`;
  }

  await saveVersion(String(datei.id), quelle, Number(datei.version), ctx.userId, pool);
  const neueGroesse = fs.statSync(arbeitsdatei).size;
  fs.renameSync(arbeitsdatei, quelle);
  await pool.query('UPDATE nodes SET version = version + 1, size = $2, updated_at = now() WHERE id = $1', [
    datei.id,
    neueGroesse,
  ]);
  return `Linie ${linie} beschrieben${ergebnis.hinweise.length ? ` — ${ergebnis.hinweise.join('; ')}` : ''}.`;
}

// ─────────────────────────── Werkzeugkatalog ───────────────────────────

type WerkzeugDef = {
  name: string;
  beschreibung: string;
  parameter: Record<string, unknown>;
  ausfuehren: (args: Record<string, unknown>, ctx: Kontext) => Promise<string>;
};

export const WERKZEUGE: WerkzeugDef[] = [
  {
    name: 'baum_zeigen',
    beschreibung: 'Zeigt alle eigenen und geteilten Dateien und Ordner mit vollem Pfad. Erste Anlaufstelle für Überblick.',
    parameter: { type: 'object', properties: {}, required: [] },
    ausfuehren: toolBaum,
  },
  {
    name: 'suchen',
    beschreibung: 'Durchsucht Dateinamen und Dateiinhalte (Volltext, deutsch). Für Fragen wie „wo steht etwas zu VLAN".',
    parameter: {
      type: 'object',
      properties: { begriff: { type: 'string', description: 'Suchbegriff' } },
      required: ['begriff'],
    },
    ausfuehren: toolSuche,
  },
  {
    name: 'lesen',
    beschreibung:
      'Liest eine Datei. Bei PDFs kommen Text mit Koordinaten, Formularfelder, Ankreuzkästchen und Schreiblinien zurück — damit lässt sich das PDF danach exakt ausfüllen.',
    parameter: {
      type: 'object',
      properties: { name: { type: 'string', description: 'Dateiname, z. B. „Arbeitsblatt.pdf"' } },
      required: ['name'],
    },
    ausfuehren: toolLesen,
  },
  {
    name: 'ordner_anlegen',
    beschreibung: 'Legt einen neuen Ordner an, optional in einem vorhandenen Ordner.',
    parameter: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Name des neuen Ordners' },
        eltern: { type: 'string', description: 'Name des Elternordners (optional)' },
      },
      required: ['name'],
    },
    ausfuehren: toolOrdner,
  },
  {
    name: 'datei_anlegen',
    beschreibung: 'Legt eine Textdatei an oder überschreibt sie. Für .md, .txt und ähnliche Formate.',
    parameter: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Dateiname mit Endung' },
        inhalt: { type: 'string', description: 'Vollständiger Inhalt' },
        eltern: { type: 'string', description: 'Zielordner (optional)' },
      },
      required: ['name', 'inhalt'],
    },
    ausfuehren: toolDatei,
  },
  {
    name: 'ergaenzen',
    beschreibung: 'Hängt Text an eine vorhandene Textdatei an oder stellt ihn an den Anfang.',
    parameter: {
      type: 'object',
      properties: {
        name: { type: 'string' },
        text: { type: 'string' },
        position: { type: 'string', enum: ['ende', 'anfang'] },
      },
      required: ['name', 'text'],
    },
    ausfuehren: toolErgaenzen,
  },
  {
    name: 'verschieben',
    beschreibung: 'Verschiebt eine Datei oder einen Ordner in einen anderen Ordner.',
    parameter: {
      type: 'object',
      properties: {
        was: { type: 'string', description: 'Name des Elements' },
        nach: { type: 'string', description: 'Zielordner (leer = oberste Ebene)' },
      },
      required: ['was'],
    },
    ausfuehren: toolVerschieben,
  },
  {
    name: 'umbenennen',
    beschreibung: 'Benennt eine Datei oder einen Ordner um.',
    parameter: {
      type: 'object',
      properties: { was: { type: 'string' }, neu: { type: 'string' } },
      required: ['was', 'neu'],
    },
    ausfuehren: toolUmbenennen,
  },
  {
    name: 'loeschen',
    beschreibung: 'Legt eine Datei oder einen Ordner in den Papierkorb. Wiederherstellbar.',
    parameter: {
      type: 'object',
      properties: { was: { type: 'string' } },
      required: ['was'],
    },
    ausfuehren: toolLoeschen,
  },
  {
    name: 'zelle_schreiben',
    beschreibung:
      'Schreibt Text in eine erkannte Tabellenzelle. Position, Breite und Höhe kommen aus dem PDF — Schriftgröße wird automatisch angepasst, damit nichts über die Linien läuft. Zeile und Spalte zählen ab 0, wie in der Ausgabe von „lesen".',
    parameter: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'PDF-Dateiname' },
        tabelle: { type: 'number', description: 'Nummer der Tabelle (Standard 1)' },
        zeile: { type: 'number', description: 'Zeilennummer ab 0' },
        spalte: { type: 'number', description: 'Spaltennummer ab 0' },
        text: { type: 'string', description: 'Einzutragender Text' },
        groesse: { type: 'number', description: 'Schriftgröße in pt (optional)' },
      },
      required: ['name', 'zeile', 'spalte', 'text'],
    },
    ausfuehren: toolZelleSchreiben,
  },
  {
    name: 'ankreuzen',
    beschreibung:
      'Kreuzt ein Ankreuzkästchen an — anhand seiner Beschriftung, nicht anhand von Koordinaten. Ausgabe von „lesen" zeigt die vorhandenen Beschriftungen.',
    parameter: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'PDF-Dateiname' },
        beschriftung: { type: 'string', description: 'Text rechts neben dem Kästchen, z. B. „Normalform 2"' },
      },
      required: ['name', 'beschriftung'],
    },
    ausfuehren: toolAnkreuzen,
  },
  {
    name: 'auf_linie_schreiben',
    beschreibung:
      'Schreibt Text auf eine Schreiblinie des PDFs. Linie 1 ist die oberste. Der Text wird automatisch verkleinert, wenn er nicht passt.',
    parameter: {
      type: 'object',
      properties: {
        name: { type: 'string' },
        linie: { type: 'number', description: 'Liniennummer ab 1 (oberste zuerst)' },
        text: { type: 'string' },
        groesse: { type: 'number' },
      },
      required: ['name', 'linie', 'text'],
    },
    ausfuehren: toolAufLinie,
  },
  {
    name: 'pdf_ausfuellen',
    beschreibung:
      'Füllt ein PDF aus, OHNE seine Struktur zu ändern. Nutze die Koordinaten aus „lesen": text schreibt an (x/y), kaestchen setzt ein Häkchen, feld füllt ein echtes Formularfeld. Text wird automatisch umgebrochen und verkleinert, damit nichts abgeschnitten wird.',
    parameter: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'PDF-Dateiname' },
        auftraege: {
          type: 'array',
          description: 'Liste der Schreibaufträge',
          items: {
            type: 'object',
            properties: {
              art: { type: 'string', enum: ['text', 'kaestchen', 'feld'] },
              seite: { type: 'number' },
              x: { type: 'number' },
              y: { type: 'number' },
              text: { type: 'string' },
              groesse: { type: 'number' },
              breite: { type: 'number', description: 'Verfügbare Breite in Punkten' },
              hoehe: { type: 'number', description: 'Verfügbare Höhe in Punkten (z. B. Zeilenhöhe der Tabelle)' },
              name: { type: 'string', description: 'Feldname (bei art=feld)' },
              wert: { type: 'string' },
            },
            required: ['art'],
          },
        },
      },
      required: ['name', 'auftraege'],
    },
    ausfuehren: toolPdfAusfuellen,
  },
  {
    name: 'seite_ansehen',
    beschreibung: 'Rendert eine PDF-Seite als Bild, um das Ergebnis zu prüfen (Koordinaten abgleichen).',
    parameter: {
      type: 'object',
      properties: { name: { type: 'string' }, seite: { type: 'number' } },
      required: ['name'],
    },
    ausfuehren: toolPdfBild,
  },
];

/** Werkzeuge im OpenAI-Format für die Schnittstelle. */
function toolsFuerApi(): Array<Record<string, unknown>> {
  return WERKZEUGE.map((w) => ({
    type: 'function',
    function: { name: w.name, description: w.beschreibung, parameters: w.parameter },
  }));
}

export async function fuehreWerkzeugAus(aufruf: WerkzeugAufruf, ctx: Kontext): Promise<WerkzeugErgebnis> {
  const def = WERKZEUGE.find((w) => w.name === aufruf.name);
  if (!def) return { id: aufruf.id, name: aufruf.name, inhalt: `Unbekanntes Werkzeug „${aufruf.name}".`, ok: false };
  try {
    const inhalt = await def.ausfuehren(aufruf.argumente ?? {}, ctx);
    return { id: aufruf.id, name: aufruf.name, inhalt, ok: true };
  } catch (e) {
    return {
      id: aufruf.id,
      name: aufruf.name,
      inhalt: `Fehler: ${e instanceof Error ? e.message : 'unbekannt'}`,
      ok: false,
    };
  }
}

// ─────────────────────────── Agent-Schleife ───────────────────────────

export type AgentSchritt =
  | { art: 'text'; text: string }
  | { art: 'werkzeug'; name: string; argumente: Record<string, unknown>; ergebnis: string; ok: boolean };

const SCHREIBENDE_WERKZEUGE = [
  'ordner_anlegen',
  'datei_anlegen',
  'ergaenzen',
  'verschieben',
  'umbenennen',
  'loeschen',
  'pdf_ausfuellen',
  'zelle_schreiben',
  'ankreuzen',
  'auf_linie_schreiben',
];

const SYSTEMPROMPT = `Du bist der Datei-Assistent im Education Planner von Tim (Berufsschule IT11b, Fachinformatiker Anwendungsentwicklung).

Du kannst seine kompletten Unterlagen sehen und bearbeiten: Ordner anlegen, Dateien anlegen und ergänzen, verschieben, umbenennen, löschen (Papierkorb), suchen und lesen — auch PDFs ausfüllen.

Regeln:
1. Arbeite mit den Werkzeugen, nicht mit Behauptungen. Wenn du etwas suchst, nutze „suchen". Wenn du etwas ändern sollst, tu es.
2. Bei PDFs: erst „lesen" — das liefert Tabellen mit Zellen-Koordinaten, Kästchen MIT Beschriftung, Schreiblinien und Formularfelder.
   Zum Ausfüllen bevorzugt die passenden Werkzeuge nutzen, NICHT selbst Koordinaten schätzen:
   - Tabellenzelle: „zelle_schreiben" mit zeile/spalte (ab 0)
   - Kästchen: „ankreuzen" mit der Beschriftung
   - Schreiblinie: „auf_linie_schreiben" mit der Liniennummer
   - echtes Formularfeld: „pdf_ausfuellen" mit art=feld
   Nur wenn keins davon passt: „pdf_ausfuellen" mit art=text und Koordinaten aus der Ausgabe.
   Erfinde niemals Koordinaten.
3. Schreibe knapp und auf Deutsch. Nenne am Ende, was du tatsächlich getan hast.
4. Löschen nur, wenn ausdrücklich gewünscht — vorher nachfragen, wenn es mehrere Treffer gibt.
5. Wenn eine Angabe fehlt (z. B. welcher Ordner), frage kurz nach statt zu raten.
6. Antworte in normalem Text, nicht in JSON, wenn du fertig bist.
7. NIEMALS behaupten, du hättest etwas geschrieben, ohne das Werkzeug aufgerufen zu haben. Wenn ein Werkzeug scheitert, sage das offen mit dem Fehlertext.
8. Prüfe nach dem Schreiben mit „lesen" oder „seite_ansehen", ob es tatsächlich drinsteht — und berichte nur, was du dort gesehen hast.`;

type Nachricht = Record<string, unknown>;

/** Eine Anfrage durch die Agent-Schleife schicken; liefert alle Schritte für die Oberfläche. */
export async function agentLauf(
  frage: string,
  userId: number,
  verlauf: Nachricht[] = [],
  maxRunden = 12,
): Promise<{ schritte: AgentSchritt[]; verlauf: Nachricht[]; fehler?: string }> {
  const cfg = resolveProvider();
  if (!cfg) return { schritte: [], verlauf, fehler: 'Kein KI-Provider eingerichtet (DEEPSEEK_API_KEY fehlt).' };

  const schritte: AgentSchritt[] = [];
  const nachrichten: Nachricht[] = [
    { role: 'system', content: SYSTEMPROMPT },
    ...verlauf.slice(-20),
    { role: 'user', content: frage },
  ];

  for (let runde = 0; runde < maxRunden; runde++) {
    const antwort = await rufeModell(cfg, nachrichten);
    if (antwort.fehler) return { schritte, verlauf: nachrichten, fehler: antwort.fehler };

    nachrichten.push(antwort.nachricht);

    const aufrufe = antwort.werkzeuge;
    if (!aufrufe.length) {
      const text = String(antwort.nachricht.content ?? '').trim();
      if (text) {
        // Schutz gegen reine Behauptungen: Schreibabsicht ohne Schreibwerkzeug
        const hatSchreibwerkzeug = schritte.some(
          (s) => s.art === 'werkzeug' && s.ok && SCHREIBENDE_WERKZEUGE.includes(s.name),
        );
        const behauptetAenderung =
          /(ausgefüllt|geschrieben|angelegt|geändert|verschoben|gelöscht|umbenannt|ergänzt|erstellt|angekreuzt)/i.test(text);
        if (behauptetAenderung && !hatSchreibwerkzeug) {
          schritte.push({
            art: 'text',
            text: `${text}\n\n⚠️ Hinweis: Dabei wurde kein Werkzeug ausgeführt — es wurde nichts geändert. Sag „nochmal", dann arbeite ich es mit den Werkzeugen ab.`,
          });
        } else {
          schritte.push({ art: 'text', text });
        }
      }
      return { schritte, verlauf: nachrichten };
    }

    for (const aufruf of aufrufe) {
      const ergebnis = await fuehreWerkzeugAus(aufruf, { userId });
      schritte.push({
        art: 'werkzeug',
        name: aufruf.name,
        argumente: aufruf.argumente,
        ergebnis: ergebnis.inhalt,
        ok: ergebnis.ok,
      });
      nachrichten.push({
        role: 'tool',
        tool_call_id: aufruf.id,
        content: ergebnis.inhalt.slice(0, 20000),
      });
    }
  }

  schritte.push({ art: 'text', text: 'Ich habe die maximale Zahl an Arbeitsschritten erreicht. Sag mir, wie ich weitermachen soll.' });
  return { schritte, verlauf: nachrichten };
}

type ModellAntwort = {
  nachricht: Nachricht;
  werkzeuge: WerkzeugAufruf[];
  fehler?: string;
};

async function rufeModell(cfg: Provider, nachrichten: Nachricht[]): Promise<ModellAntwort> {
  if (cfg.name === 'gemini') return rufeGemini(cfg, nachrichten);

  const resp = await fetch(`${cfg.baseUrl}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${cfg.apiKey}` },
    body: JSON.stringify({
      model: cfg.model,
      messages: nachrichten,
      tools: toolsFuerApi(),
      tool_choice: 'auto',
      temperature: 0.2,
      max_tokens: 4000,
    }),
    signal: AbortSignal.timeout(120_000),
  });

  if (!resp.ok) {
    return { nachricht: {}, werkzeuge: [], fehler: `${cfg.name} HTTP ${resp.status}: ${(await resp.text()).slice(0, 300)}` };
  }

  const daten = (await resp.json()) as {
    choices?: Array<{
      message?: {
        role?: string;
        content?: string | null;
        tool_calls?: Array<{ id: string; function: { name: string; arguments: string } }>;
      };
    }>;
  };
  const nachricht = daten.choices?.[0]?.message;
  if (!nachricht) return { nachricht: {}, werkzeuge: [], fehler: 'Leere Antwort vom Modell.' };

  const werkzeuge: WerkzeugAufruf[] = (nachricht.tool_calls ?? []).map((t) => {
    let argumente: Record<string, unknown> = {};
    try {
      argumente = JSON.parse(t.function.arguments || '{}') as Record<string, unknown>;
    } catch {
      argumente = {};
    }
    return { id: t.id, name: t.function.name, argumente };
  });

  return {
    nachricht: {
      role: 'assistant',
      content: nachricht.content ?? '',
      ...(werkzeuge.length
        ? {
            tool_calls: (nachricht.tool_calls ?? []).map((t) => ({
              id: t.id,
              type: 'function',
              function: { name: t.function.name, arguments: t.function.arguments },
            })),
          }
        : {}),
    },
    werkzeuge,
  };
}

/** Gemini kennt ein eigenes Format — hier auf das gemeinsame Schema abbilden. */
async function rufeGemini(cfg: Provider, nachrichten: Nachricht[]): Promise<ModellAntwort> {
  const system = nachrichten.filter((n) => n.role === 'system').map((n) => String(n.content)).join('\n');
  const inhalt = nachrichten
    .filter((n) => n.role !== 'system')
    .map((n) => {
      if (n.role === 'tool') return { role: 'user', parts: [{ text: `Werkzeugergebnis: ${String(n.content).slice(0, 8000)}` }] };
      if (n.role === 'assistant') {
        const calls = n.tool_calls as Array<{ function: { name: string; arguments: string } }> | undefined;
        const parts: Array<Record<string, unknown>> = [];
        if (n.content) parts.push({ text: String(n.content) });
        for (const c of calls ?? []) {
          parts.push({ functionCall: { name: c.function.name, args: JSON.parse(c.function.arguments || '{}') } });
        }
        return { role: 'model', parts: parts.length ? parts : [{ text: '' }] };
      }
      return { role: 'user', parts: [{ text: String(n.content) }] };
    });

  const resp = await fetch(`${cfg.baseUrl}/models/${encodeURIComponent(cfg.model)}:generateContent`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': cfg.apiKey },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: system }] },
      contents: inhalt,
      tools: [
        {
          functionDeclarations: WERKZEUGE.map((w) => ({
            name: w.name,
            description: w.beschreibung,
            parameters: w.parameter,
          })),
        },
      ],
      generationConfig: { temperature: 0.2, maxOutputTokens: 4096 },
    }),
    signal: AbortSignal.timeout(120_000),
  });

  if (!resp.ok) {
    return { nachricht: {}, werkzeuge: [], fehler: `gemini HTTP ${resp.status}: ${(await resp.text()).slice(0, 300)}` };
  }
  const daten = (await resp.json()) as {
    candidates?: Array<{
      content?: { parts?: Array<{ text?: string; functionCall?: { name: string; args: Record<string, unknown> } }> };
    }>;
  };
  const parts = daten.candidates?.[0]?.content?.parts ?? [];
  const text = parts.map((p) => p.text ?? '').join('').trim();
  const aufrufe = parts
    .filter((p) => p.functionCall)
    .map((p, i) => ({
      id: `gemini-${Date.now()}-${i}`,
      name: p.functionCall!.name,
      argumente: p.functionCall!.args ?? {},
    }));

  return {
    nachricht: {
      role: 'assistant',
      content: text,
      ...(aufrufe.length
        ? {
            tool_calls: aufrufe.map((a) => ({
              id: a.id,
              type: 'function',
              function: { name: a.name, arguments: JSON.stringify(a.argumente) },
            })),
          }
        : {}),
    },
    werkzeuge: aufrufe,
  };
}
