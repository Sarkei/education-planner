// Seed für den Education-Planner Demo-Account (nur Musterdaten, keine echten Namen).
import JSZip from 'jszip';

const BASE = 'http://127.0.0.1:3000/api';
const DEMO_EMAIL = 'demo@example.com';

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function docxXml(lines) {
  const body = lines
    .map((line) => {
      const isHeading = line.startsWith('# ');
      const isSub = line.startsWith('## ');
      const text = isHeading ? line.slice(2) : isSub ? line.slice(3) : line;
      if (!text) return '<w:p/>';
      const props = isHeading
        ? '<w:pPr><w:pStyle w:val="Heading1"/></w:pPr>'
        : isSub
          ? '<w:pPr><w:pStyle w:val="Heading2"/></w:pPr>'
          : '';
      return `<w:p>${props}<w:r><w:t xml:space="preserve">${esc(text)}</w:t></w:r></w:p>`;
    })
    .join('');
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body}<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1417" w:right="1417" w:bottom="1134" w:left="1417" w:header="708" w:footer="708" w:gutter="0"/></w:sectPr></w:body></w:document>`;
}

const DOCX_TYPES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/></Types>`;

const DOCX_RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`;

const DOCX_DOC_RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`;

const DOCX_STYLES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:style w:type="paragraph" w:styleId="Normal" w:default="1"><w:name w:val="Normal"/><w:rPr><w:sz w:val="22"/></w:rPr></w:style><w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:basedOn w:val="Normal"/><w:rPr><w:b/><w:sz w:val="32"/></w:rPr></w:style><w:style w:type="paragraph" w:styleId="Heading2"><w:name w:val="heading 2"/><w:basedOn w:val="Normal"/><w:rPr><w:b/><w:sz w:val="26"/></w:rPr></w:style></w:styles>`;

async function makeDocx(lines) {
  const zip = new JSZip();
  zip.file('[Content_Types].xml', DOCX_TYPES);
  zip.file('_rels/.rels', DOCX_RELS);
  zip.file('word/document.xml', docxXml(lines));
  zip.file('word/_rels/document.xml.rels', DOCX_DOC_RELS);
  zip.file('word/styles.xml', DOCX_STYLES);
  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
}

const XLSX_TYPES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>`;

const XLSX_RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`;

const XLSX_WORKBOOK = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Tabelle1" sheetId="1" r:id="rId1"/></sheets></workbook>`;

const XLSX_WORKBOOK_RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>`;

const colName = (i) => String.fromCharCode(65 + (i % 26));

function sheetXml(rows) {
  const body = rows
    .map((row, r) => {
      const cells = row
        .map((value, c) => {
          const ref = `${colName(c)}${r + 1}`;
          if (typeof value === 'number') return `<c r="${ref}"><v>${value}</v></c>`;
          return `<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${esc(value)}</t></is></c>`;
        })
        .join('');
      return `<row r="${r + 1}">${cells}</row>`;
    })
    .join('');
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${body}</sheetData></worksheet>`;
}

async function makeXlsx(rows) {
  const zip = new JSZip();
  zip.file('[Content_Types].xml', XLSX_TYPES);
  zip.file('_rels/.rels', XLSX_RELS);
  zip.file('xl/workbook.xml', XLSX_WORKBOOK);
  zip.file('xl/_rels/workbook.xml.rels', XLSX_WORKBOOK_RELS);
  zip.file('xl/worksheets/sheet1.xml', sheetXml(rows));
  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
}

// 1x1 PNG als Platzhalter-Grafik (Mindmap)
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==',
  'base64',
);

let token = '';

async function call(path, options = {}) {
  const headers = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  let body;
  if (options.json !== undefined) {
    body = JSON.stringify(options.json);
    headers['Content-Type'] = 'application/json';
  } else if (options.raw) {
    body = options.raw;
    headers['Content-Type'] = 'application/octet-stream';
  }
  const res = await fetch(`${BASE}${path}`, { method: options.method || (body ? 'POST' : 'GET'), headers, body });
  const text = await res.text();
  let data;
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { raw: text };
  }
  if (!res.ok) throw new Error(`${options.method || 'GET'} ${path} → ${res.status} ${text.slice(0, 200)}`);
  return data;
}

async function folder(parentId, name) {
  const { node } = await call('/nodes/folder', { json: { parentId, name } });
  return node.id;
}

async function uploadBinary(parentId, name, buffer, mime) {
  const { uploadId } = await call('/uploads/init', { json: { parentId, name, size: buffer.length, mime } });
  await call(`/uploads/${uploadId}/0`, { method: 'PUT', raw: buffer });
  const { node } = await call(`/uploads/${uploadId}/complete`, { method: 'POST' });
  return node.id;
}

async function uploadText(parentId, name, content) {
  const created = await call('/nodes/file', { json: { parentId, name } });
  const id = created.node.id;
  await call(`/uploads/text/${id}`, { method: 'PUT', json: { content } });
  return id;
}

const DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

async function main() {
  const demo = await call('/auth/demo');
  token = demo.token;
  console.log('Demo-Token für', demo.user.email, demo.user.name);

  // Vorhandenen Demo-Baum wegräumen, damit das Skript wiederholbar ist.
  const existing = await call('/nodes/tree');
  for (const node of existing.nodes.filter((n) => n.parentId === null)) {
    if (node.ownerId !== demo.user.id) continue;
    await call(`/nodes/${node.id}`, { method: 'DELETE' });
    await call(`/nodes/${node.id}/purge`, { method: 'DELETE' });
  }

  const root = await folder(null, 'Schuljahr 2026–27 (IT11b)');

  // Mathematik
  const mathe = await folder(root, 'Mathematik');
  await uploadBinary(
    mathe,
    'Lernfeld 2 – Gleichungen.docx',
    await makeDocx([
      '# Lernfeld 2 – Lineare Gleichungen',
      'Thema: Äquivalenzumformungen, Textaufgaben und Prozentrechnung.',
      '',
      '## Merksatz',
      'Eine Gleichung bleibt im Gleichgewicht, solange auf beiden Seiten dieselbe Rechenoperation ausgeführt wird.',
      '',
      '## Beispiel',
      '3x + 12 = 45  |  -12',
      '3x = 33      |  :3',
      'x = 11',
      '',
      '## Hausaufgabe',
      'Arbeitsblatt Seite 42, Aufgaben 3 bis 7. Abgabe am Montag.',
    ]),
    DOCX,
  );
  await uploadText(
    mathe,
    'Formelsammlung.md',
    `# Formelsammlung Mathematik

## Prozentrechnung
- Grundwert G, Prozentwert W, Prozentsatz p
- W = G * p / 100

## Zinsrechnung
- Zinsen Z = K * p * t / (100 * 12)

## Flächen
- Rechteck: A = a * b
- Dreieck: A = (g * h) / 2
- Kreis: A = π * r²

## Prüfungstipp
Formeln immer mit Einheit aufschreiben – Punkte gibt es für den Rechenweg.
`,
  );
  await uploadBinary(
    mathe,
    'Übungsblatt Prozentrechnung.xlsx',
    await makeXlsx([
      ['Aufgabe', 'Grundwert', 'Prozentsatz', 'Prozentwert', 'Lösung'],
      ['1', 250, 12, 0, ''],
      ['2', 480, 7.5, 0, ''],
      ['3', 1200, 3, 0, ''],
      ['4', 85, 20, 0, ''],
      ['Summe', 2015, 0, 0, ''],
    ]),
    XLSX,
  );

  // Deutsch
  const deutsch = await folder(root, 'Deutsch');
  await uploadBinary(
    deutsch,
    'Berichtsheft – Leitfaden.docx',
    await makeDocx([
      '# Berichtsheft richtig führen',
      'Das Berichtsheft wird wöchentlich ausgefüllt und von der Ausbilderin unterschrieben.',
      '',
      '## Aufbau eines Wochenberichts',
      '1. Betriebliche Tätigkeiten mit Datum',
      '2. Unterweisungen und Schulunterricht',
      '3. Besondere Vorkommnisse',
      '',
      '## Formulierungen',
      'Sachlich, in der Vergangenheit und in vollständigen Sätzen schreiben.',
      'Beispiel: "Ich habe die Netzwerkdosen im Raum 2.14 geprüft und dokumentiert."',
    ]),
    DOCX,
  );
  await uploadText(
    deutsch,
    'Lesejournal KW 45.md',
    `# Lesejournal KW 45

## Gelesen
- Kapitel 4–6 aus "Der Vorleser"
- Zeitungsartikel über Ausbildungsberufe im IT-Bereich

## Gedanken
Die Erzählperspektive wechselt häufig. Für die Interpretation wichtig:
Schuld, Erinnerung und Verantwortung.

## Vokabelliste
- Ambivalenz: Zerrissenheit zwischen zwei Gefühlen
- Interpretation: Deutung eines Textes
`,
  );
  await uploadBinary(
    deutsch,
    'Aufsatz – Analyse Übung.docx',
    await makeDocx([
      '# Aufsatzübung: Texterörterung',
      'Aufgabe: Erörtere die These, dass digitale Medien den Schulalltag verbessern.',
      '',
      '## Gliederung',
      '- Einleitung: These und Aktualität',
      '- Hauptteil: Argument 1 (Zugang zu Wissen), Argument 2 (Ablenkung)',
      '- Schluss: eigenes Fazit',
      '',
      '## Rückmeldung der Lehrkraft',
      'Argumentation schlüssig, aber Belege fehlen. Beim nächsten Mal zwei Quellen angeben.',
    ]),
    DOCX,
  );

  // Englisch
  const englisch = await folder(root, 'Englisch');
  await uploadBinary(
    englisch,
    'Vokabelliste Unit 3.xlsx',
    await makeXlsx([
      ['English', 'German', 'Beispielsatz'],
      ['to apply', 'sich bewerben', 'I want to apply for an internship.'],
      ['application', 'Bewerbung', 'My application is ready.'],
      ['skill', 'Fähigkeit', 'Teamwork is an important skill.'],
      ['deadline', 'Frist', 'The deadline is next Friday.'],
      ['to achieve', 'erreichen', 'She achieved her goal.'],
      ['reliable', 'zuverlässig', 'He is a reliable colleague.'],
    ]),
    XLSX,
  );
  await uploadText(
    englisch,
    'Summary Writing.md',
    `# How to write a summary

1. Read the text twice and mark key facts.
2. Write in your own words, simple present.
3. Keep the order of the original text.
4. Do not add your own opinion.

## Useful phrases
- The text deals with ...
- The author points out that ...
- In conclusion, ...

## Homework
Write a summary of the article "Digital learning in schools" (150 words).
`,
  );

  // Informatik
  const info = await folder(root, 'Informatik');
  await uploadBinary(
    info,
    'Lernfeld 4 – Datenbanken.docx',
    await makeDocx([
      '# Lernfeld 4 – Datenbanken',
      'Daten werden in Tabellen gespeichert und über Schlüssel verknüpft.',
      '',
      '## Grundbegriffe',
      '- Entität: ein Objekt der realen Welt (z. B. Schüler)',
      '- Attribut: eine Eigenschaft (Name, Klasse)',
      '- Primärschlüssel: eindeutige Kennung eines Datensatzes',
      '- Fremdschlüssel: verweist auf den Primärschlüssel einer anderen Tabelle',
      '',
      '## Normalformen',
      '1. Normalform: keine mehrfachen Werte in einer Zelle',
      '2. Normalform: jedes Nichtschlüssel-Attribut hängt vom ganzen Schlüssel ab',
      '3. Normalform: keine Abhängigkeiten zwischen Nichtschlüssel-Attributen',
    ]),
    DOCX,
  );
  await uploadText(
    info,
    'SQL Cheatsheet.md',
    `# SQL Cheatsheet

\`\`\`sql
-- Alle Schüler einer Klasse
SELECT name, vorname
FROM schueler
WHERE klasse = 'IT11b'
ORDER BY name;

-- Anzahl je Klasse
SELECT klasse, count(*) AS anzahl
FROM schueler
GROUP BY klasse;

-- Verknüpfung zweier Tabellen
SELECT s.name, n.fach, n.note
FROM schueler s
JOIN noten n ON n.schueler_id = s.id
WHERE n.note <= 2;
\`\`\`

## Merken
- JOIN braucht immer eine Bedingung (ON).
- GROUP BY fasst Zeilen zusammen, HAVING filtert Gruppen.
`,
  );
  await uploadBinary(
    info,
    'Projekt Datenbankentwurf.xlsx',
    await makeXlsx([
      ['Tabelle', 'Feld', 'Typ', 'Schlüssel', 'Bemerkung'],
      ['schueler', 'id', 'serial', 'PK', ''],
      ['schueler', 'name', 'text', '', 'Nachname'],
      ['schueler', 'klasse', 'text', 'FK', 'verweist auf klasse'],
      ['noten', 'id', 'serial', 'PK', ''],
      ['noten', 'schueler_id', 'integer', 'FK', ''],
      ['noten', 'fach', 'text', '', ''],
      ['noten', 'note', 'integer', '', '1 bis 6'],
    ]),
    XLSX,
  );

  // Netzwerktechnik
  const netz = await folder(root, 'Netzwerktechnik');
  await uploadText(
    netz,
    'Subnetting Übungen.md',
    `# Subnetting – Übungen

## Aufgabe 1
Netz 192.168.10.0/24 in vier gleich große Subnetze teilen.

- Neue Maske: /26 (255.255.255.192)
- Subnetze: .0/26, .64/26, .128/26, .192/26
- Nutzbare Hosts je Subnetz: 62

## Aufgabe 2
Wie viele Hosts passen in ein /28-Netz?
2^(32-28) - 2 = 14 Hosts.

## Aufgabe 3
Broadcast-Adresse von 10.0.5.37/27?
Netz: 10.0.5.32/27 → Broadcast 10.0.5.63.

## Prüfungstipp
Immer erst Netzmaske in Binärschreibweise notieren, dann rechnen.
`,
  );
  await uploadBinary(
    netz,
    'Netzwerkplan Schule.docx',
    await makeDocx([
      '# Netzwerkplan Berufsschule',
      'Aufbau des Schulnetzes im Raum 2.14.',
      '',
      '## Komponenten',
      '- Router: FritzBox 7590 (Internetzugang)',
      '- Switch: 24 Ports, VLAN-fähig',
      '- Patchpanel: 24 Ports, Cat 6a',
      '- Access Points: 2 Stück für WLAN',
      '',
      '## Adressierung',
      'Verwaltung: 192.168.10.0/24',
      'Schüler-WLAN: 192.168.20.0/24 (eigenes VLAN)',
      'Drucker: 192.168.10.50 bis 192.168.10.60 (fest)',
      '',
      '## Offene Punkte',
      'VLAN 20 muss noch am Switch eingerichtet und getestet werden.',
    ]),
    DOCX,
  );
  await uploadText(
    netz,
    'Praxisaufgabe VLAN.md',
    `# Praxisaufgabe: VLAN einrichten

## Ziel
Schüler-WLAN vom Verwaltungsnetz trennen.

## Schritte
1. VLAN 10 (Verwaltung) und VLAN 20 (Schüler) am Switch anlegen.
2. Ports 1–12 dem VLAN 10 zuweisen.
3. Ports 13–24 dem VLAN 20 zuweisen.
4. Uplink als Trunk konfigurieren.
5. Mit ping die Trennung prüfen.

## Ergebnis
Die Netze sind getrennt, ein Ping von VLAN 20 in VLAN 10 schlägt fehl – wie geplant.
`,
  );

  // Hausaufgaben & Termine
  const termine = await folder(root, 'Hausaufgaben & Termine');
  await uploadText(
    termine,
    'Hausaufgaben KW 46.md',
    `# Hausaufgaben KW 46

| Fach | Aufgabe | Abgabe |
| --- | --- | --- |
| Mathematik | Arbeitsblatt Seite 42, Aufgabe 3–7 | Montag |
| Deutsch | Aufsatzgliederung digital abgeben | Dienstag |
| Englisch | Summary "Digital learning" (150 Wörter) | Mittwoch |
| Informatik | ER-Modell zur Schulbibliothek zeichnen | Donnerstag |
| Netzwerktechnik | Subnetting Aufgabe 3 rechnen | Freitag |

## Erledigt
- [x] Vokabeln Unit 3 wiederholen
- [ ] Berichtsheft KW 45 unterschreiben lassen
`,
  );
  await uploadText(
    termine,
    'Termine November.md',
    `# Termine im November

- 03.11. Klassenarbeit Mathematik (90 Minuten)
- 07.11. Exkursion Rechenzentrum, Treffpunkt 08:00 Uhr
- 12.11. Abgabe Projekt Datenbankentwurf
- 18.11. Präsentation Netzwerktechnik (10 Minuten)
- 25.11. Elternsprechtag, 16:00 bis 19:00 Uhr
- 30.11. Berichtsheft KW 47 abgeben
`,
  );
  await uploadText(
    termine,
    'Klassenarbeit Mathematik – Lernplan.txt',
    `Klassenarbeit Mathematik am 03.11.

Themen:
- Lineare Gleichungen und Äquivalenzumformungen
- Prozent- und Zinsrechnung
- Flächenberechnung
- Textaufgaben

Lernplan:
Tag 1: Formelsammlung abschreiben und Beispiele rechnen
Tag 2: Übungsblatt Prozentrechnung komplett
Tag 3: Alte Klassenarbeit durchrechnen, Fehler markieren
Tag 4: Nur Wiederholung der Fehler, früh schlafen
`,
  );

  // Mindmap-Grafik für etwas Abwechslung
  await uploadBinary(netz, 'Mindmap Netzwerke.png', PNG, 'image/png');

  const tree = await call('/nodes/tree');
  console.log('Knoten im Demo-Baum:', tree.nodes.length);
}

main().catch((error) => {
  console.error('SEED FAILED:', error.message);
  process.exit(1);
});
