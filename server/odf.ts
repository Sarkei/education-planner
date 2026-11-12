import JSZip from 'jszip';

/**
 * Minimale OpenDocument-Vorlagen (.odt/.ods/.odp).
 * Wichtig: die Datei `mimetype` muss als erster Eintrag UNKOMPRIMIERT im ZIP stehen,
 * sonst erkennen LibreOffice und ONLYOFFICE das Format nicht.
 */

const META = `<?xml version="1.0" encoding="UTF-8"?>
<office:document-meta xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" xmlns:meta="urn:oasis:names:tc:opendocument:xmlns:meta:1.0" xmlns:dc="http://purl.org/dc/elements/1.1/" office:version="1.3"><office:meta><dc:creator>Education Planner</dc:creator><dc:title>Dokument</dc:title></office:meta></office:document-meta>`;

const SETTINGS = `<?xml version="1.0" encoding="UTF-8"?>
<office:document-settings xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" xmlns:config="urn:oasis:names:tc:opendocument:xmlns:config:1.0" office:version="1.3"><office:settings><config:config-item-set config:name="ooo:view-settings"><config:config-item config:name="ViewAreaTop" config:type="long">0</config:config-item><config:config-item config:name="ViewAreaLeft" config:type="long">0</config:config-item></config:config-item-set></office:settings></office:document-settings>`;

function manifest(mime: string, extra: string[]): string {
  const entries = extra
    .map((path) => `<manifest:file-entry manifest:full-path="${path}" manifest:media-type="text/xml"/>`)
    .join('');
  return `<?xml version="1.0" encoding="UTF-8"?>
<manifest:manifest xmlns:manifest="urn:oasis:names:tc:opendocument:xmlns:manifest:1.0" manifest:version="1.3"><manifest:file-entry manifest:full-path="/" manifest:version="1.3" manifest:media-type="${mime}"/><manifest:file-entry manifest:full-path="content.xml" manifest:media-type="text/xml"/><manifest:file-entry manifest:full-path="styles.xml" manifest:media-type="text/xml"/><manifest:file-entry manifest:full-path="meta.xml" manifest:media-type="text/xml"/><manifest:file-entry manifest:full-path="settings.xml" manifest:media-type="text/xml"/>${entries}</manifest:manifest>`;
}

const STYLES_TEXT = `<?xml version="1.0" encoding="UTF-8"?>
<office:document-styles xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" xmlns:style="urn:oasis:names:tc:opendocument:xmlns:style:1.0" xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0" xmlns:fo="urn:oasis:names:tc:opendocument:xmlns:xsl-fo-compatible:1.0" office:version="1.3"><office:styles><style:default-style style:family="paragraph"><style:paragraph-properties fo:orphans="2" fo:widows="2"/><style:text-properties fo:font-size="11pt" fo:language="de" fo:country="DE"/></style:default-style></office:styles><office:automatic-styles/><office:master-styles/></office:document-styles>`;

const CONTENT_TEXT = `<?xml version="1.0" encoding="UTF-8"?>
<office:document-content xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0" xmlns:table="urn:oasis:names:tc:opendocument:xmlns:table:1.0" office:version="1.3"><office:body><office:text><text:p/></office:text></office:body></office:document-content>`;

const CONTENT_SHEET = `<?xml version="1.0" encoding="UTF-8"?>
<office:document-content xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" xmlns:table="urn:oasis:names:tc:opendocument:xmlns:table:1.0" xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0" office:version="1.3"><office:body><office:spreadsheet><table:table table:name="Tabelle1"><table:table-column table:number-columns-repeated="5"/><table:table-row><table:table-cell office:value-type="string"><text:p/></table:table-cell></table:table-row></table:table></office:spreadsheet></office:body></office:document-content>`;

const CONTENT_SLIDES = `<?xml version="1.0" encoding="UTF-8"?>
<office:document-content xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" xmlns:draw="urn:oasis:names:tc:opendocument:xmlns:drawing:1.0" xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0" xmlns:svg="urn:oasis:names:tc:opendocument:xmlns:svg-compatible:1.0" office:version="1.3"><office:automatic-styles/><office:body><office:presentation><draw:page draw:name="Folie 1"><draw:frame draw:name="Titel" svg:x="2cm" svg:y="6cm" svg:width="21cm" svg:height="3cm"><draw:text-box><text:p>Klicken, um den Titel hinzuzufügen</text:p></draw:text-box></draw:frame></draw:page></office:presentation></office:body></office:document-content>`;

async function buildOdf(mime: string, content: string): Promise<Buffer> {
  const zip = new JSZip();
  // mimetype zuerst und unkomprimiert
  zip.file('mimetype', mime, { compression: 'STORE' });
  zip.file('META-INF/manifest.xml', manifest(mime, []));
  zip.file('content.xml', content);
  zip.file('styles.xml', STYLES_TEXT);
  zip.file('meta.xml', META);
  zip.file('settings.xml', SETTINGS);
  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
}

export const emptyOdt = (): Promise<Buffer> =>
  buildOdf('application/vnd.oasis.opendocument.text', CONTENT_TEXT);
export const emptyOds = (): Promise<Buffer> =>
  buildOdf('application/vnd.oasis.opendocument.spreadsheet', CONTENT_SHEET);
export const emptyOdp = (): Promise<Buffer> =>
  buildOdf('application/vnd.oasis.opendocument.presentation', CONTENT_SLIDES);
