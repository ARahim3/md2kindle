// Assemble a valid EPUB 3 package (with an NCX fallback for older readers and
// KDP) entirely in memory with JSZip.

import JSZip from 'jszip';
import type { Chapter } from './chapters';
import type { ImageAsset } from './images';
import { xmlEscape, epubTimestamp } from './xml';

export interface CoverInput {
  data: Uint8Array;
  mediaType: string;
}

export interface BuildEpubParams {
  title: string;
  author: string;
  language: string;
  chapters: Chapter[];
  images: ImageAsset[];
  cover?: CoverInput | null;
}

// The reading stylesheet. The hyphenation kill-switch is the headline feature:
// no more weird hyphenated words breaking the reading flow on Kindle.
const STYLESHEET = `@charset "utf-8";

html { -webkit-hyphens: none; hyphens: none; }

body {
  margin: 4% 5%;
  line-height: 1.5;
  text-align: left;
  word-spacing: normal;
  hyphens: none;
  -webkit-hyphens: none;
  -moz-hyphens: none;
  -ms-hyphens: none;
  -epub-hyphens: none;
  adobe-hyphenate: none;
}

h1, h2, h3, h4, h5, h6 {
  line-height: 1.2;
  hyphens: none;
  -webkit-hyphens: none;
  page-break-after: avoid;
  break-after: avoid;
}
h1 { font-size: 1.7em; margin: 1em 0 0.6em; }
h2 { font-size: 1.4em; margin: 1.2em 0 0.5em; }
h3 { font-size: 1.2em; margin: 1em 0 0.4em; }

p { margin: 0 0 0.8em; orphans: 2; widows: 2; }
a { color: inherit; text-decoration: underline; }

img { max-width: 100%; height: auto; }
figure { margin: 1em 0; text-align: center; page-break-inside: avoid; break-inside: avoid; }
figcaption { font-size: 0.85em; font-style: italic; margin-top: 0.4em; }

pre {
  white-space: pre-wrap;
  word-wrap: break-word;
  overflow-wrap: break-word;
  background: #f3f1ec;
  padding: 0.6em 0.8em;
  border-radius: 4px;
  font-size: 0.85em;
  line-height: 1.4;
}
code { font-family: "Courier New", monospace; }
:not(pre) > code { background: #f0eee8; padding: 0.1em 0.3em; border-radius: 3px; font-size: 0.9em; }

blockquote {
  margin: 1em 0;
  padding-left: 1em;
  border-left: 3px solid #999;
  color: #333;
  font-style: italic;
}

table { border-collapse: collapse; margin: 1em 0; width: 100%; font-size: 0.9em; }
th, td { border: 1px solid #bbb; padding: 0.4em 0.6em; text-align: left; }
th { background: #f0eee8; }

hr { border: none; border-top: 1px solid #bbb; margin: 1.5em 0; }
ul, ol { margin: 0 0 0.8em 1.4em; }

.md2k-math-img { vertical-align: middle; }
.md2k-math-block { text-align: center; margin: 1em 0; page-break-inside: avoid; break-inside: avoid; }
.md2k-math-block .md2k-math-img { display: inline-block; }
.md2k-missing { color: #b00; font-style: italic; font-size: 0.85em; }

.task-list-item { list-style: none; }
.task-list-item-checkbox { margin-right: 0.4em; }
.footnotes { font-size: 0.85em; border-top: 1px solid #bbb; margin-top: 2em; padding-top: 1em; }
`;

const CONTAINER_XML = `<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>
`;

function extForMedia(mediaType: string): string {
  if (mediaType === 'image/jpeg') return 'jpg';
  if (mediaType === 'image/png') return 'png';
  if (mediaType === 'image/gif') return 'gif';
  if (mediaType === 'image/webp') return 'webp';
  return 'img';
}

function chapterDoc(lang: string, title: string, body: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" xml:lang="${xmlEscape(lang)}" lang="${xmlEscape(lang)}">
<head>
  <meta charset="utf-8"/>
  <title>${xmlEscape(title)}</title>
  <link rel="stylesheet" type="text/css" href="style.css"/>
</head>
<body>
${body}
</body>
</html>`;
}

function coverDoc(lang: string, coverHref: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" xml:lang="${xmlEscape(lang)}">
<head>
  <meta charset="utf-8"/>
  <title>Cover</title>
  <style>html,body{margin:0;padding:0;height:100%;text-align:center;}img{max-width:100%;max-height:100%;}</style>
</head>
<body epub:type="cover">
  <div><img src="${coverHref}" alt="Cover"/></div>
</body>
</html>`;
}

function navDoc(lang: string, chapters: Chapter[]): string {
  const items = chapters
    .map((c) => `      <li><a href="${c.filename}">${xmlEscape(c.title)}</a></li>`)
    .join('\n');
  const first = chapters[0]?.filename ?? 'chapter-0001.xhtml';
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" xml:lang="${xmlEscape(lang)}">
<head>
  <meta charset="utf-8"/>
  <title>Contents</title>
  <link rel="stylesheet" type="text/css" href="style.css"/>
</head>
<body>
  <nav epub:type="toc" id="toc">
    <h1>Contents</h1>
    <ol>
${items}
    </ol>
  </nav>
  <nav epub:type="landmarks" hidden="hidden">
    <ol>
      <li><a epub:type="toc" href="nav.xhtml">Table of Contents</a></li>
      <li><a epub:type="bodymatter" href="${first}">Begin Reading</a></li>
    </ol>
  </nav>
</body>
</html>`;
}

function ncxDoc(lang: string, uuid: string, title: string, chapters: Chapter[]): string {
  const points = chapters
    .map(
      (c, i) =>
        `    <navPoint id="np-${i + 1}" playOrder="${i + 1}">
      <navLabel><text>${xmlEscape(c.title)}</text></navLabel>
      <content src="${c.filename}"/>
    </navPoint>`,
    )
    .join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>
<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1" xml:lang="${xmlEscape(lang)}">
  <head>
    <meta name="dtb:uid" content="urn:uuid:${uuid}"/>
    <meta name="dtb:depth" content="1"/>
    <meta name="dtb:totalPageCount" content="0"/>
    <meta name="dtb:maxPageNumber" content="0"/>
  </head>
  <docTitle><text>${xmlEscape(title)}</text></docTitle>
  <navMap>
${points}
  </navMap>
</ncx>`;
}

function opfDoc(
  p: BuildEpubParams,
  uuid: string,
  hasCover: boolean,
  coverImageHref: string,
  coverMediaType: string,
): string {
  const manifest: string[] = [
    '    <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>',
    '    <item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>',
    '    <item id="css" href="style.css" media-type="text/css"/>',
  ];
  if (hasCover) {
    manifest.push(
      `    <item id="cover-image" href="${coverImageHref}" media-type="${coverMediaType}" properties="cover-image"/>`,
      '    <item id="cover-page" href="cover.xhtml" media-type="application/xhtml+xml"/>',
    );
  }
  for (const c of p.chapters) {
    manifest.push(
      `    <item id="${c.id}" href="${c.filename}" media-type="application/xhtml+xml"/>`,
    );
  }
  for (const a of p.images) {
    manifest.push(`    <item id="${a.id}" href="${a.href}" media-type="${a.mediaType}"/>`);
  }

  const spine: string[] = [];
  if (hasCover) spine.push('    <itemref idref="cover-page" linear="yes"/>');
  for (const c of p.chapters) spine.push(`    <itemref idref="${c.id}"/>`);

  const coverMeta = hasCover ? '\n    <meta name="cover" content="cover-image"/>' : '';

  return `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="bookid" xml:lang="${xmlEscape(p.language)}">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="bookid">urn:uuid:${uuid}</dc:identifier>
    <dc:title>${xmlEscape(p.title)}</dc:title>
    <dc:creator>${xmlEscape(p.author)}</dc:creator>
    <dc:language>${xmlEscape(p.language)}</dc:language>
    <meta property="dcterms:modified">${epubTimestamp()}</meta>${coverMeta}
  </metadata>
  <manifest>
${manifest.join('\n')}
  </manifest>
  <spine toc="ncx">
${spine.join('\n')}
  </spine>
</package>`;
}

export async function buildEpub(p: BuildEpubParams): Promise<Blob> {
  const uuid =
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(16).slice(2)}`;

  const hasCover = !!p.cover;
  const coverMediaType = p.cover?.mediaType || 'image/jpeg';
  const coverImageHref = `cover.${extForMedia(coverMediaType)}`;

  const zip = new JSZip();
  // mimetype MUST be first and stored uncompressed.
  zip.file('mimetype', 'application/epub+zip', { compression: 'STORE' });
  zip.file('META-INF/container.xml', CONTAINER_XML);

  zip.file('OEBPS/content.opf', opfDoc(p, uuid, hasCover, coverImageHref, coverMediaType));
  zip.file('OEBPS/nav.xhtml', navDoc(p.language, p.chapters));
  zip.file('OEBPS/toc.ncx', ncxDoc(p.language, uuid, p.title, p.chapters));
  zip.file('OEBPS/style.css', STYLESHEET);

  if (p.cover) {
    zip.file('OEBPS/cover.xhtml', coverDoc(p.language, coverImageHref));
    zip.file(`OEBPS/${coverImageHref}`, p.cover.data);
  }

  for (const c of p.chapters) {
    zip.file(`OEBPS/${c.filename}`, chapterDoc(p.language, c.title, c.body));
  }
  for (const a of p.images) {
    zip.file(`OEBPS/${a.href}`, a.data);
  }

  return zip.generateAsync({
    type: 'blob',
    mimeType: 'application/epub+zip',
    compression: 'DEFLATE',
    compressionOptions: { level: 9 },
  });
}
