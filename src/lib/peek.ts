// Reading a source's own title/author/language without converting it.
//
// `convert.ts` derives the same fields, but only once you press Bind — too late
// to show you what the book is going to be called. Peeking lets the form fill
// itself in (and the cover preview show the real thing) the moment a source
// lands, so the remaining steps are a review rather than a form to complete.
//
// Deliberately light: no Readability, no markdown-it, nothing from the lazy
// conversion engine, so the form can load it on its own. That means the HTML
// side reads document-level metadata rather than re-running article extraction —
// which is fine, because whatever this fills into the fields is then passed back
// as an explicit override, so the book gets exactly what the form showed.

import { parseFrontMatter } from './frontmatter';
import { latexmlMetadata } from './arxiv';
import type { SourceKind } from './types';

export interface PeekedMetadata {
  title?: string;
  author?: string;
  language?: string;
}

/** First ATX heading in a Markdown document. */
export function firstHeading(markdown: string): string | null {
  const m = markdown.match(/^#{1,6}[ \t]+(.+?)[ \t]*#*\s*$/m);
  return m ? m[1].trim() : null;
}

/** Shared with `convert.ts` so the form and the book agree on what wins. */
export function markdownMetadata(fm: Record<string, string>, body: string): PeekedMetadata {
  return {
    title: fm.title || firstHeading(body) || undefined,
    author: fm.author || fm.creator || undefined,
    language: fm.language || fm.lang || undefined,
  };
}

function metaContent(doc: Document, selector: string): string | undefined {
  return doc.querySelector(selector)?.getAttribute('content')?.trim() || undefined;
}

function htmlMetadata(raw: string, useReadability: boolean): PeekedMetadata {
  const doc = new DOMParser().parseFromString(raw, 'text/html');

  const language = doc.documentElement.getAttribute('lang')?.trim() || undefined;
  const author =
    metaContent(doc, 'meta[name="author"]') || metaContent(doc, 'meta[property="article:author"]');

  // A paper states its own title and byline exactly; nothing here is a guess.
  const paper = latexmlMetadata(doc);
  if (paper?.title || paper?.author) {
    return { title: paper.title, author: paper.author || author, language };
  }

  // Readability derives a better title than <title> — it drops the trailing
  // " — Site Name" that most blogs append. We can't run it here (it is part of
  // the heavy conversion chunk), and filling the field turns a guess into an
  // override that would *replace* the better answer. So when it is going to run,
  // leave the title to it.
  return {
    title: useReadability ? undefined : doc.querySelector('title')?.textContent?.trim() || undefined,
    author,
    language,
  };
}

export function peekMetadata(
  content: string,
  kind: SourceKind,
  useReadability: boolean,
): PeekedMetadata {
  if (!content.trim()) return {};
  if (kind === 'html') return htmlMetadata(content, useReadability);
  const { data, body } = parseFrontMatter(content);
  return markdownMetadata(data, body);
}
