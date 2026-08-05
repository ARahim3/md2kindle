// HTML input: optionally extract the main article with Mozilla Readability
// (strips nav, sidebars, ads, footers), then sanitise. Falls back to the full
// <body> if Readability can't find a meaningful article.
//
// LaTeXML papers (arXiv, ar5iv) take a dedicated path — see `arxiv.ts` for why
// Readability is the wrong tool for them.

import { Readability } from '@mozilla/readability';
import { sanitizeHtml } from './markdown';
import { mathmlToPlaceholders } from './mathml';
import { extractLatexmlArticle } from './arxiv';

export interface HtmlExtract {
  html: string;
  title?: string;
  author?: string;
}

function metaContent(doc: Document, selector: string): string | undefined {
  return doc.querySelector(selector)?.getAttribute('content')?.trim() || undefined;
}

/**
 * Lift TeX out of any MathML, then sanitise. Order matters: sanitisation drops
 * the attributes and wrappers the TeX lives in (see `mathml.ts`).
 */
function finish(html: string): string {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  mathmlToPlaceholders(doc);
  return sanitizeHtml(doc.body.innerHTML);
}

export function extractHtml(raw: string, useReadability: boolean): HtmlExtract {
  const doc = new DOMParser().parseFromString(raw, 'text/html');

  const docTitle = doc.querySelector('title')?.textContent?.trim();
  const metaAuthor =
    metaContent(doc, 'meta[name="author"]') ||
    metaContent(doc, 'meta[property="article:author"]');

  // A research paper's markup is known exactly, so read it directly rather than
  // letting Readability's heuristics guess at it (they delete every display
  // equation). Independent of the Readability toggle: there is nothing to strip.
  const paper = extractLatexmlArticle(doc);
  if (paper) {
    return {
      html: finish(paper.html),
      title: paper.title || docTitle,
      author: paper.author || metaAuthor,
    };
  }

  if (useReadability) {
    try {
      // Readability mutates its input, so hand it a clone and keep `doc` intact.
      const article = new Readability(doc.cloneNode(true) as Document).parse();
      if (article?.content && (article.textContent || '').trim().length > 200) {
        return {
          html: finish(article.content),
          title: (article.title || docTitle) ?? undefined,
          author: (article.byline || metaAuthor) ?? undefined,
        };
      }
    } catch {
      /* fall through to the full-body path */
    }
  }

  const body = doc.body ? doc.body.innerHTML : raw;
  const firstH1 = doc.querySelector('h1')?.textContent?.trim();
  return {
    html: finish(body),
    title: docTitle || firstH1 || undefined,
    author: metaAuthor,
  };
}

/**
 * Rewrite relative URLs in a fetched page to absolute, against `baseUrl`, so
 * images and links keep working once the page is detached from its origin.
 *
 * A page's own `<base href>` wins over the URL we fetched it from — that is what
 * the browser does, and pages that rely on it (arXiv serves `/html/<id>` with a
 * `<base href="/html/<id>v1/">`) otherwise resolve every image one directory too
 * high and lose the lot.
 */
export function absolutizeUrls(html: string, baseUrl: string): string {
  const doc = new DOMParser().parseFromString(html, 'text/html');

  let base = baseUrl;
  const declared = doc.querySelector('base[href]')?.getAttribute('href');
  if (declared) {
    try {
      base = new URL(declared, baseUrl).href;
    } catch {
      /* malformed <base>: stay with the fetch URL */
    }
  }

  const abs = (v: string): string | null => {
    try {
      return new URL(v, base).href;
    } catch {
      return null;
    }
  };
  const fixAttr = (el: Element, attr: string) => {
    const v = el.getAttribute(attr);
    if (!v) return;
    const a = abs(v);
    if (a) el.setAttribute(attr, a);
  };

  doc.querySelectorAll('a[href]').forEach((el) => fixAttr(el, 'href'));
  doc.querySelectorAll('source[src]').forEach((el) => fixAttr(el, 'src'));
  doc.querySelectorAll('img').forEach((img) => {
    // Prefer src; if a responsive image only has srcset, promote its first URL.
    if (!img.getAttribute('src')) {
      const srcset = img.getAttribute('srcset');
      const first = srcset?.split(',')[0]?.trim().split(/\s+/)[0];
      if (first) img.setAttribute('src', first);
    }
    img.removeAttribute('srcset'); // we rasterise a single source
    fixAttr(img, 'src');
  });

  return doc.documentElement.outerHTML;
}
