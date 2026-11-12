import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import JSZip from 'jszip';

/** Dateien, die sich ohne Fremdwerkzeug lesen lassen. */
const PLAIN = new Set(['.txt', '.md', '.csv', '.json', '.log', '.xml', '.html', '.htm', '.tex', '.yml', '.yaml']);
/** Office-Formate sind ZIP-Container mit XML-Inhalt. */
const ZIP_DOC = new Set(['.docx', '.docm', '.xlsx', '.xlsm', '.pptx', '.odt', '.ods', '.odp']);

function xmlToText(xml: string): string {
  return xml
    .replace(/<w:p[^>]*>/g, '\n')
    .replace(/<a:p>/g, '\n')
    .replace(/<text:p[^>]*>/g, '\n')
    .replace(/<w:tab\/>/g, '\t')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/[ \t]+/g, ' ')
    .replace(/\n\s*\n+/g, '\n')
    .trim();
}

async function textFromZip(full: string, ext: string): Promise<string> {
  const data = await fs.promises.readFile(full);
  const zip = await JSZip.loadAsync(data);
  const parts: string[] = [];

  if (ext === '.docx' || ext === '.docm') {
    const doc = zip.file('word/document.xml');
    if (doc) parts.push(xmlToText(await doc.async('string')));
    for (const name of ['word/header1.xml', 'word/footer1.xml', 'word/footnotes.xml']) {
      const file = zip.file(name);
      if (file) parts.push(xmlToText(await file.async('string')));
    }
  } else if (ext === '.xlsx' || ext === '.xlsm') {
    const shared = zip.file('xl/sharedStrings.xml');
    if (shared) parts.push(xmlToText(await shared.async('string')));
    const sheets = Object.keys(zip.files).filter((n) => /^xl\/worksheets\/sheet\d+\.xml$/.test(n));
    for (const sheet of sheets.slice(0, 20)) {
      const file = zip.file(sheet);
      if (file) parts.push(xmlToText(await file.async('string')));
    }
  } else if (ext === '.pptx') {
    const slides = Object.keys(zip.files)
      .filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n))
      .sort();
    for (const slide of slides) {
      const file = zip.file(slide);
      if (file) parts.push(xmlToText(await file.async('string')));
    }
    const notes = Object.keys(zip.files).filter((n) => /^ppt\/notesSlides\/notesSlide\d+\.xml$/.test(n));
    for (const note of notes.slice(0, 30)) {
      const file = zip.file(note);
      if (file) parts.push(xmlToText(await file.async('string')));
    }
  } else {
    const content = zip.file('content.xml');
    if (content) parts.push(xmlToText(await content.async('string')));
    const styles = zip.file('styles.xml');
    if (styles) parts.push(xmlToText(await styles.async('string')));
  }

  return parts.filter(Boolean).join('\n').slice(0, 600_000);
}

function pdfToText(full: string): Promise<string> {
  return new Promise((resolve) => {
    execFile('pdftotext', ['-layout', full, '-'], { maxBuffer: 40 * 1024 * 1024, timeout: 30_000 }, (error, stdout) => {
      if (error) {
        resolve('');
        return;
      }
      resolve(String(stdout).slice(0, 600_000));
    });
  });
}

/**
 * Text aus einer Datei ziehen — Grundlage für den Suchindex.
 * Liefert '' wenn der Typ nicht unterstützt wird (z. B. altes .doc/.xls ohne XML).
 */
export async function extractText(fullPath: string, name: string): Promise<string> {
  const ext = path.extname(name).toLowerCase();
  try {
    const stat = await fs.promises.stat(fullPath);
    if (stat.size > 25 * 1024 * 1024) return '';
    if (PLAIN.has(ext)) {
      const raw = await fs.promises.readFile(fullPath, 'utf8');
      return raw.slice(0, 600_000);
    }
    if (ZIP_DOC.has(ext)) return textFromZip(fullPath, ext);
    if (ext === '.pdf') return pdfToText(fullPath);
  } catch {
    return '';
  }
  return '';
}

export function isSearchable(name: string): boolean {
  const ext = path.extname(name).toLowerCase();
  return PLAIN.has(ext) || ZIP_DOC.has(ext) || ext === '.pdf';
}
