// Read an EPUB we just produced back into something renderable, entirely in the
// browser with the JSZip we already ship — no EPUB-reader dependency.
//
// We unzip the package, follow container.xml -> the OPF, then walk the spine in
// order. Each spine document's <body> is handed back as HTML with its image
// references rewritten to blob: URLs. The output stylesheet (style.css) comes
// back as text so the reader can render the book in its *own* CSS — the same
// content that lands on the Kindle.

import JSZip from 'jszip';

export interface ReadDoc {
  /** manifest id / spine idref */
  id: string;
  /** the document's own filename, e.g. chapter-0002.xhtml (for in-book links) */
  file: string;
  /** chapter title (from <title>, falls back to first heading) */
  title: string;
  /** inner-<body> HTML, image src rewritten to blob: URLs */
  html: string;
  /** true for the cover page (epub:type="cover") */
  isCover: boolean;
}

export interface ReadBook {
  title: string;
  /** spine order, ready to render */
  docs: ReadDoc[];
  /** the EPUB's output stylesheet, verbatim */
  css: string;
  /** revoke every blob: URL we minted */
  dispose: () => void;
}

/** Resolve `rel` against directory `base` (which ends in '/'), collapsing ./ and ../ */
function resolvePath(base: string, rel: string): string {
  const out: string[] = [];
  for (const seg of (base + rel).split('/')) {
    if (seg === '' || seg === '.') continue;
    if (seg === '..') out.pop();
    else out.push(seg);
  }
  return out.join('/');
}

function dirOf(path: string): string {
  const i = path.lastIndexOf('/');
  return i === -1 ? '' : path.slice(0, i + 1);
}

export async function readEpub(blob: Blob): Promise<ReadBook> {
  const zip = await JSZip.loadAsync(blob);
  const parser = new DOMParser();
  const urls: string[] = [];
  const blobUrl = (bytes: Uint8Array, type: string): string => {
    const u = URL.createObjectURL(new Blob([bytes as BlobPart], { type }));
    urls.push(u);
    return u;
  };
  const text = async (path: string): Promise<string> => {
    const f = zip.file(path);
    return f ? f.async('string') : '';
  };

  // container.xml -> OPF path
  const container = parser.parseFromString(
    await text('META-INF/container.xml'),
    'application/xml',
  );
  const opfPath =
    container.querySelector('rootfile')?.getAttribute('full-path') || 'OEBPS/content.opf';
  const opfDir = dirOf(opfPath);

  const opf = parser.parseFromString(await text(opfPath), 'application/xml');

  // manifest: id -> { path, type }
  const manifest = new Map<string, { path: string; type: string }>();
  opf.querySelectorAll('manifest > item').forEach((it) => {
    const id = it.getAttribute('id');
    const href = it.getAttribute('href');
    if (!id || !href) return;
    manifest.set(id, {
      path: resolvePath(opfDir, href),
      type: it.getAttribute('media-type') || '',
    });
  });

  // Mint blob: URLs for every image, keyed by their in-zip path.
  const imageUrl = new Map<string, string>();
  for (const { path, type } of manifest.values()) {
    if (!type.startsWith('image/')) continue;
    const f = zip.file(path);
    if (f) imageUrl.set(path, blobUrl(await f.async('uint8array'), type));
  }

  // The stylesheet (there is exactly one).
  let css = '';
  for (const { path, type } of manifest.values()) {
    if (type === 'text/css') {
      css = await text(path);
      break;
    }
  }

  const bookTitle =
    opf.querySelector('metadata > *|title, metadata title')?.textContent?.trim() || 'Untitled';

  // Walk the spine in order, building renderable docs.
  const docs: ReadDoc[] = [];
  const itemrefs = Array.from(opf.querySelectorAll('spine > itemref'));
  for (const ref of itemrefs) {
    const idref = ref.getAttribute('idref');
    if (!idref) continue;
    const item = manifest.get(idref);
    if (!item || item.type !== 'application/xhtml+xml') continue;

    const doc = parser.parseFromString(await text(item.path), 'text/html');
    const body = doc.body;
    if (!body) continue;

    const docDir = dirOf(item.path);
    body.querySelectorAll('img').forEach((img) => {
      const src = img.getAttribute('src');
      if (!src || /^(https?:|data:|blob:)/i.test(src)) return;
      const u = imageUrl.get(resolvePath(docDir, src));
      if (u) img.setAttribute('src', u);
    });

    const isCover =
      body.getAttribute('epub:type') === 'cover' || /(^|\/)cover\.x?html$/i.test(item.path);
    const heading = body.querySelector('h1, h2, h3')?.textContent?.trim();
    const title = doc.title?.trim() || heading || (isCover ? 'Cover' : 'Untitled');

    docs.push({
      id: idref,
      file: item.path.split('/').pop() || item.path,
      title,
      html: body.innerHTML,
      isCover,
    });
  }

  return {
    title: bookTitle,
    docs,
    css,
    dispose: () => urls.forEach((u) => URL.revokeObjectURL(u)),
  };
}
