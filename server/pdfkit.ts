/**
 * PDF-Werkzeuge für den KI-Assistenten.
 *
 * Zwei Richtungen:
 *  1. lesen  — Text mit Koordinaten, Zeilen, Kästchen, Formularfelder, Tabellenzellen
 *  2. schreiben — Text an Position, Kästchen ankreuzen, Formularfelder füllen,
 *     jeweils MIT Passungsprüfung, damit nichts still verschwindet.
 */
import fs from 'node:fs';
import { PDFDocument, StandardFonts, rgb, type PDFFont } from 'pdf-lib';

export type TextZeile = {
  text: string;
  x: number;
  y: number;
  breite: number;
  hoehe: number;
  groesse: number;
  seite: number;
};

export type Formularfeld = {
  name: string;
  typ: string;
  wert: string;
  x: number;
  y: number;
  breite: number;
  hoehe: number;
  seite: number;
};

export type PdfStruktur = {
  seiten: number;
  seitenGroesse: Array<{ breite: number; hoehe: number }>;
  text: string;
  zeilen: TextZeile[];
  formularfelder: Formularfeld[];
  hatText: boolean;
};

/** Textzeilen mit Koordinaten auslesen (pdfjs), plus AcroForm-Felder (pdf-lib). */
export async function lesePdf(pfad: string): Promise<PdfStruktur> {
  const daten = new Uint8Array(fs.readFileSync(pfad));
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const doc = await pdfjs.getDocument({ data: daten, useSystemFonts: true } as never).promise;

  const zeilen: TextZeile[] = [];
  const seitenGroesse: Array<{ breite: number; hoehe: number }> = [];
  let gesamtText = '';

  for (let s = 1; s <= doc.numPages; s++) {
    const page = await doc.getPage(s);
    const viewport = page.getViewport({ scale: 1 });
    // PDF-Koordinaten: Ursprung unten links, wie pdf-lib sie erwartet
    seitenGroesse.push({ breite: Math.round(viewport.width), hoehe: Math.round(viewport.height) });

    const inhalt = await page.getTextContent();
    const nachZeile = new Map<number, { texte: Array<{ str: string; x: number; w: number; h: number }>; y: number }>();
    for (const item of inhalt.items as Array<{ str?: string; transform?: number[]; width?: number; height?: number }>) {
      if (!item.str || !item.transform) continue;
      const x = item.transform[4];
      const yPdfjs = item.transform[5];
      const hoehe = item.height ?? item.transform[3] ?? 10;
      const schluessel = Math.round(yPdfjs);
      const treffer = nachZeile.get(schluessel);
      const eintrag = { str: item.str, x, w: item.width ?? 0, h: hoehe };
      if (treffer) treffer.texte.push(eintrag);
      else nachZeile.set(schluessel, { texte: [eintrag], y: yPdfjs });
    }

    for (const { texte, y } of nachZeile.values()) {
      texte.sort((a, b) => a.x - b.x);
      const zusammen = texte.map((t) => t.str).join(' ').replace(/\s+/g, ' ').trim();
      if (!zusammen) continue;
      const x0 = Math.min(...texte.map((t) => t.x));
      const x1 = Math.max(...texte.map((t) => t.x + t.w));
      // transform[5] ist bereits in PDF-Koordinaten (Ursprung unten links)
      const yPdf = Math.round(y);
      zeilen.push({
        text: zusammen,
        x: Math.round(x0),
        y: yPdf,
        breite: Math.round(x1 - x0),
        hoehe: Math.round(Math.max(...texte.map((t) => t.h))),
        groesse: Math.round(Math.max(...texte.map((t) => t.h))),
        seite: s,
      });
      gesamtText += zusammen + '\n';
    }
    await page.cleanup();
  }
  try {
    await (doc as unknown as { destroy?: () => Promise<void> }).destroy?.();
  } catch {
    /* aeltere pdfjs-Versionen haben destroy nicht */
  }

  const formularfelder = await leseFormularfelder(pfad);

  return {
    seiten: seitenGroesse.length,
    seitenGroesse,
    text: gesamtText.trim(),
    zeilen,
    formularfelder,
    hatText: gesamtText.trim().length > 20,
  };
}

/** AcroForm-Felder mit Position und aktueller Belegung. */
export async function leseFormularfelder(pfad: string): Promise<Formularfeld[]> {
  const doc = await PDFDocument.load(fs.readFileSync(pfad), { ignoreEncryption: true });
  const felder: Formularfeld[] = [];
  const form = doc.getForm();
  const seiten = doc.getPages();

  for (const feld of form.getFields()) {
    const name = feld.getName();
    let typ = 'text';
    try {
      const konstruktor = feld.constructor.name;
      if (konstruktor.includes('CheckBox')) typ = 'checkbox';
      else if (konstruktor.includes('RadioGroup')) typ = 'radio';
      else if (konstruktor.includes('Dropdown')) typ = 'dropdown';
      else if (konstruktor.includes('OptionList')) typ = 'list';
      else if (konstruktor.includes('Button')) typ = 'button';
    } catch {
      typ = 'text';
    }

    let wert = '';
    try {
      if (typeof (feld as unknown as { getText?: () => string }).getText === 'function') {
        wert = (feld as unknown as { getText: () => string }).getText() ?? '';
      } else if (typeof (feld as unknown as { isChecked?: () => boolean }).isChecked === 'function') {
        wert = (feld as unknown as { isChecked: () => boolean }).isChecked() ? 'an' : 'aus';
      }
    } catch {
      wert = '';
    }

    // Rechteck über die Widgets der Seite suchen
    let x = 0;
    let y = 0;
    let breite = 0;
    let hoehe = 0;
    let seite = 1;
    try {
      const widget = (feld as unknown as { acroField: { getWidgets: () => Array<{ getRectangle: () => { x: number; y: number; width: number; height: number } }> } })
        .acroField.getWidgets()[0];
      if (widget) {
        const r = widget.getRectangle();
        x = Math.round(r.x);
        y = Math.round(r.y);
        breite = Math.round(r.width);
        hoehe = Math.round(r.height);
        // Seite über Treffer im Annots-Array bestimmen
        for (let i = 0; i < seiten.length; i++) {
          const annos = seiten[i].node.Annots();
          if (!annos) continue;
          const treffer = annos.asArray().some((a) => {
            try {
              return a.toString().includes(name);
            } catch {
              return false;
            }
          });
          if (treffer) {
            seite = i + 1;
            break;
          }
        }
      }
    } catch {
      /* Position unbekannt */
    }

    felder.push({ name, typ, wert, x, y, breite, hoehe, seite });
  }
  return felder;
}

/** Zeichnet eine Linie/Kästchen-Übersicht: welche Rechtecke sind im PDF? */
export async function leseZeichnungen(
  pfad: string,
): Promise<Array<{ seite: number; x: number; y: number; breite: number; hoehe: number; art: string }>> {
  const daten = new Uint8Array(fs.readFileSync(pfad));
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const doc = await pdfjs.getDocument({ data: daten } as never).promise;
  const ergebnis: Array<{ seite: number; x: number; y: number; breite: number; hoehe: number; art: string }> = [];

  for (let s = 1; s <= doc.numPages; s++) {
    const page = await doc.getPage(s);
    const viewport = page.getViewport({ scale: 1 });
    const ops = await page.getOperatorList();

    for (let i = 0; i < ops.fnArray.length; i++) {
      // pdfjs 6+: alle Pfade kommen als constructPath (Code 91)
      // Aufbau: [op, [{0..5}], {0..3}] — die Objekte tragen bereits x/y/breite/hoehe
      if (ops.fnArray[i] !== 91) continue;
      const args = ops.argsArray[i] as unknown[];
      if (!Array.isArray(args) || args.length < 2) continue;

      const kandidaten: number[][] = [];
      const sammle = (wert: unknown): void => {
        if (Array.isArray(wert)) {
          for (const teil of wert) sammle(teil);
        } else if (wert && typeof wert === 'object') {
          const o = wert as Record<string, number>;
          // Zwei Formen treten auf:
          //   {0..3}            = Bounding-Box (x0,y0,x1,y1)
          //   {0..5}            = Mini-Pfad: [op, x0, y0, op, x1, y1]
          if (typeof o[4] === 'number' && typeof o[5] === 'number') {
            // Pfad: Punkte stehen in (1,2) und (4,5)
            kandidaten.push([o[1], o[2], o[1], o[2], o[4], o[5]]);
          } else if (
            typeof o[0] === 'number' &&
            typeof o[1] === 'number' &&
            typeof o[2] === 'number' &&
            typeof o[3] === 'number'
          ) {
            kandidaten.push([o[0], o[1], o[2], o[3]]);
          }
        }
      };
      sammle(args[1]);
      sammle(args[2]);

      for (const k of kandidaten) {
        const xs = [k[0], k[2] ?? k[0], k[4] ?? k[0]];
        const ys = [k[1], k[3] ?? k[1], k[5] ?? k[1]];
        const x0 = Math.min(...xs);
        const x1 = Math.max(...xs);
        const y0 = Math.min(...ys);
        const y1 = Math.max(...ys);
        const breite = Math.round(x1 - x0);
        const hoehe = Math.round(y1 - y0);
        // Unterkante zurückgeben: pdf-lib zeichnet von y nach oben,
        // damit stimmen Lese- und Schreibkoordinaten überein.
        const yPdf = Math.round(y0);

        if (breite < 2 && hoehe < 2) continue;
        let art = 'rechteck';
        if (breite <= 24 && hoehe <= 24 && breite >= 6 && hoehe >= 6) art = 'kaestchen';
        else if (hoehe <= 2 && breite >= 40) art = 'schreiblinie';
        else if (breite <= 2 && hoehe >= 40) art = 'senkrechte';
        else if (hoehe <= 2) art = 'linie';

        ergebnis.push({ seite: s, x: Math.round(x0), y: yPdf, breite, hoehe, art });
      }
    }
    await page.cleanup();
  }
  try {
    await (doc as unknown as { destroy?: () => Promise<void> }).destroy?.();
  } catch {
    /* aeltere pdfjs-Versionen */
  }
  return ergebnis;
}

export type SchreibAuftrag =
  | {
      art: 'text';
      seite: number;
      x: number;
      y: number;
      text: string;
      groesse?: number;
      breite?: number;
      /** verfügbare Höhe in Punkten — begrenzt die Zeilenzahl */
      hoehe?: number;
      farbe?: [number, number, number];
    }
  | { art: 'kaestchen'; seite: number; x: number; y: number; breite: number; hoehe: number }
  | { art: 'feld'; name: string; wert: string };

export type SchreibErgebnis = {
  erfolgreich: number;
  fehlgeschlagen: Array<{ auftrag: SchreibAuftrag; grund: string }>;
  hinweise: string[];
};

/** Wie breit wird der Text bei dieser Schriftgröße? */
function textBreite(font: PDFFont, text: string, groesse: number): number {
  return font.widthOfTextAtSize(text, groesse);
}

/** Bricht Text so um, dass er in die Breite passt. */
function umbrechen(font: PDFFont, text: string, groesse: number, maxBreite: number): string[] {
  const woerter = text.split(/\s+/);
  const zeilen: string[] = [];
  let aktuell = '';
  for (const wort of woerter) {
    const probe = aktuell ? `${aktuell} ${wort}` : wort;
    if (textBreite(font, probe, groesse) <= maxBreite || !aktuell) {
      aktuell = probe;
    } else {
      zeilen.push(aktuell);
      aktuell = wort;
    }
  }
  if (aktuell) zeilen.push(aktuell);
  return zeilen;
}

/**
 * Schreibt in ein PDF. Prüft bei jedem Text, ob er in die angegebene Breite passt,
 * verkleinert notfalls die Schrift und meldet, was nicht ging — nichts verschwindet still.
 */
export async function schreibePdf(quelldatei: string, zieldatei: string, auftraege: SchreibAuftrag[]): Promise<SchreibErgebnis> {
  const doc = await PDFDocument.load(fs.readFileSync(quelldatei), { ignoreEncryption: true });
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const seiten = doc.getPages();
  const ergebnis: SchreibErgebnis = { erfolgreich: 0, fehlgeschlagen: [], hinweise: [] };
  const form = doc.getForm();

  for (const auftrag of auftraege) {
    try {
      if (auftrag.art === 'feld') {
        // AcroForm-Feld direkt setzen — robust, weil das PDF die Position kennt
        const felder = form.getFields();
        const feld = felder.find((f) => f.getName() === auftrag.name);
        if (!feld) {
          ergebnis.fehlgeschlagen.push({ auftrag, grund: `Feld „${auftrag.name}" gibt es nicht.` });
          continue;
        }
        const alsText = feld as unknown as { setText?: (v: string) => void; check?: () => void; uncheck?: () => void };
        if (typeof alsText.setText === 'function') {
          alsText.setText(auftrag.wert);
        } else if (typeof alsText.check === 'function') {
          const an = /^(an|ja|true|x|1)$/i.test(auftrag.wert.trim());
          if (an) alsText.check?.();
          else alsText.uncheck?.();
        }
        ergebnis.erfolgreich++;
        continue;
      }

      const page = seiten[auftrag.seite - 1];
      if (!page) {
        ergebnis.fehlgeschlagen.push({ auftrag, grund: `Seite ${auftrag.seite} gibt es nicht.` });
        continue;
      }

      if (auftrag.art === 'kaestchen') {
        // Häkchen als zwei Linien — funktioniert bei gedruckten wie digitalen Bögen
        const x0 = auftrag.x + 2;
        const y0 = auftrag.y + 3;
        const x1 = auftrag.x + auftrag.breite - 2;
        const y1 = auftrag.y + auftrag.hoehe - 1;
        const mitte = { x: (x0 + x1) / 2, y: (y0 + y1) / 2 };
        page.drawLine({
          start: { x: x0, y: y0 + (y1 - y0) * 0.45 },
          end: { x: mitte.x, y: y0 },
          thickness: 1.6,
          color: rgb(0.05, 0.05, 0.35),
        });
        page.drawLine({
          start: { x: mitte.x, y: y0 },
          end: { x: x1, y: y1 },
          thickness: 1.6,
          color: rgb(0.05, 0.05, 0.35),
        });
        ergebnis.erfolgreich++;
        continue;
      }

      // Text: passende Größe suchen, damit weder Breite noch Höhe überschritten wird
      const startGroesse = auftrag.groesse ?? 10;
      const maxBreite = auftrag.breite ?? 400;
      // Wenn eine Höhe bekannt ist, bleibt oben/unten je 1 pt Rand
      const maxHoehe = auftrag.hoehe !== undefined ? Math.max(6, auftrag.hoehe - 2) : 200;
      let groesse = startGroesse;
      let zeilen = umbrechen(font, auftrag.text, groesse, maxBreite - 4);
      let gesamtHoehe = zeilen.length * groesse * 1.15;

      // Passt nicht in die Höhe? Schrift schrittweise verkleinern (bis 3.5 pt)
      let versuche = 0;
      while (gesamtHoehe > maxHoehe && groesse > 3.5 && versuche++ < 60) {
        groesse -= 0.25;
        zeilen = umbrechen(font, auftrag.text, groesse, maxBreite - 4);
        gesamtHoehe = zeilen.length * groesse * 1.15;
      }
      // Sicherheitsabstand: die Schrift darf höchstens 85 % der Zellenhöhe füllen
      if (auftrag.hoehe !== undefined) {
        const hObergrenze = groesse * 1.15;
        const maxZeilenNachHoehe = Math.max(1, Math.floor((auftrag.hoehe - 2) / hObergrenze));
        if (zeilen.length > maxZeilenNachHoehe) {
          zeilen = zeilen.slice(0, maxZeilenNachHoehe);
          ergebnis.hinweise.push(
            `Text bei (${auftrag.x}/${auftrag.y}) auf ${maxZeilenNachHoehe} Zeile(n) gekürzt, damit er in ${Math.round(auftrag.hoehe ?? 0)} pt passt.`,
          );
        }
      }

      // Passt immer noch nicht? Auf die erlaubte Zeilenzahl kürzen und Hinweis geben
      const maxZeilen = Math.max(1, Math.floor(maxHoehe / (groesse * 1.15)));
      if (zeilen.length > maxZeilen) {
        zeilen = zeilen.slice(0, maxZeilen);
        ergebnis.hinweise.push(
          `Text bei (${auftrag.x}/${auftrag.y}) war zu lang für ${Math.round(maxHoehe)} pt Höhe und wurde gekürzt.`,
        );
      }
      // Einzelne Wörter, die selbst bei kleinster Größe zu breit sind
      const zuBreit = zeilen.filter((z) => textBreite(font, z, groesse) > maxBreite + 1);
      if (zuBreit.length > 0) {
        ergebnis.hinweise.push(`Text an (${auftrag.x}/${auftrag.y}) ragt über die Breite: „${zuBreit[0].slice(0, 30)}…"`);
      }

      const farbe = auftrag.farbe ?? [0.05, 0.09, 0.45];
      let y = auftrag.y;
      for (const zeile of zeilen) {
        page.drawText(zeile, {
          x: auftrag.x,
          y,
          size: groesse,
          font,
          color: rgb(farbe[0], farbe[1], farbe[2]),
        });
        y -= groesse * 1.15;
      }
      ergebnis.erfolgreich++;
    } catch (e) {
      ergebnis.fehlgeschlagen.push({ auftrag, grund: e instanceof Error ? e.message : 'Unbekannter Fehler' });
    }
  }

  // Formularfelder brauchen keine Darstellungs-Aktualisierung, aber Flatten wäre falsch
  try {
    form.updateFieldAppearances(font);
  } catch {
    /* nicht jedes PDF hat Felder */
  }

  const bytes = await doc.save();
  fs.writeFileSync(zieldatei, bytes);
  return ergebnis;
}

/** Seite als PNG rendern, damit die KI das Ergebnis sehen kann. */
export async function rendereSeite(pfad: string, seite: number, dpi = 150): Promise<Buffer> {
  const daten = new Uint8Array(fs.readFileSync(pfad));
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const doc = await pdfjs.getDocument({ data: daten } as never).promise;
  const page = await doc.getPage(seite);
  const viewport = page.getViewport({ scale: dpi / 72 });

  const { createCanvas } = await import('@napi-rs/canvas');
  const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
  const ctx = canvas.getContext('2d');
  await page.render({ canvasContext: ctx, viewport, canvas } as never).promise;
  const png = await canvas.encode('png');
  try {
    await (doc as unknown as { destroy?: () => Promise<void> }).destroy?.();
  } catch {
    /* aeltere pdfjs-Versionen */
  }
  return Buffer.from(png);
}

export type TabellenZelle = {
  zeile: number;
  spalte: number;
  x: number;
  y: number;
  breite: number;
  hoehe: number;
  /** bereits gedruckter Text in der Zelle */
  inhalt: string;
};

export type Tabelle = {
  seite: number;
  zeilen: number;
  spalten: number;
  zellen: TabellenZelle[];
};

/**
 * Erkennt Tabellen aus den gezeichneten Linien und ordnet jeder Zelle den
 * vorhandenen Text zu. Damit kann exakt in eine Zelle geschrieben werden,
 * ohne Position zu raten.
 */
export async function leseTabellen(pfad: string): Promise<Tabelle[]> {
  const zeich = await leseZeichnungen(pfad);
  const struktur = await lesePdf(pfad);
  const tabellen: Tabelle[] = [];

  const nachSeite = new Map<number, typeof zeich>();
  for (const z of zeich) {
    const liste = nachSeite.get(z.seite) ?? [];
    liste.push(z);
    nachSeite.set(z.seite, liste);
  }

  for (const [seite, objekte] of nachSeite) {
    // Senkrechte Linien = Spaltengrenzen
    const senkrecht = objekte
      .filter((o) => o.art === 'senkrechte' || (o.breite <= 2 && o.hoehe > 20))
      .map((o) => o.x);
    // Waagerechte = Zeilengrenzen
    const waagerecht = objekte
      .filter((o) => o.art === 'schreiblinie' || (o.hoehe <= 2 && o.breite > 60))
      .map((o) => o.y);

    const xs = [...new Set(senkrecht)].sort((a, b) => a - b);
    const ys = [...new Set(waagerecht)].sort((a, b) => b - a);
    if (xs.length < 2 || ys.length < 2) continue;

    const zellen: TabellenZelle[] = [];
    for (let zi = 0; zi < ys.length - 1; zi++) {
      const oben = ys[zi];
      const unten = ys[zi + 1];
      const hoehe = oben - unten;
      if (hoehe < 6 || hoehe > 120) continue;
      for (let si = 0; si < xs.length - 1; si++) {
        const links = xs[si];
        const rechts = xs[si + 1];
        const breite = rechts - links;
        if (breite < 20) continue;
        // Text, der in dieser Zelle liegt
        const drin = struktur.zeilen
          .filter((z) => z.seite === seite && z.y > unten - 2 && z.y < oben + 2 && z.x >= links - 3 && z.x < rechts - 3)
          .map((z) => z.text)
          .join(' ')
          .trim();
        zellen.push({ zeile: zi, spalte: si, x: links, y: unten, breite, hoehe, inhalt: drin });
      }
    }
    if (zellen.length) {
      tabellen.push({ seite, zeilen: ys.length - 1, spalten: xs.length - 1, zellen });
    }
  }
  return tabellen;
}

export type Kaestchen = {
  seite: number;
  x: number;
  y: number;
  breite: number;
  hoehe: number;
  /** Text direkt rechts daneben — das ist die Beschriftung */
  beschriftung: string;
};

/** Ankreuzkästchen samt der Beschriftung rechts daneben. */
export async function leseKaestchen(pfad: string): Promise<Kaestchen[]> {
  const zeich = await leseZeichnungen(pfad);
  const struktur = await lesePdf(pfad);
  const ergebnis: Kaestchen[] = [];

  for (const k of zeich.filter((z) => z.art === 'kaestchen')) {
    // Nächstgelegener Text auf gleicher Höhe, rechts vom Kästchen
    let beste: { text: string; abstand: number } | null = null;
    for (const z of struktur.zeilen) {
      if (z.seite !== k.seite) continue;
      // y der Textzeile plus halbe Schrifthöhe = Textmitte
      const textMitte = z.y + z.hoehe / 2;
      const kaestchenMitte = k.y + k.hoehe / 2;
      const dy = Math.abs(textMitte - kaestchenMitte);
      if (dy > 8) continue;
      const dx = z.x - (k.x + k.breite);
      if (dx < -4 || dx > 140) continue;
      const abstand = dy * 4 + Math.max(0, dx);
      if (!beste || abstand < beste.abstand) beste = { text: z.text, abstand };
    }
    ergebnis.push({
      seite: k.seite,
      x: k.x,
      y: k.y,
      breite: k.breite,
      hoehe: k.hoehe,
      beschriftung: beste?.text ?? '',
    });
  }
  return ergebnis;
}
