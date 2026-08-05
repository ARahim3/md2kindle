// Recognising an arXiv paper from whatever the user pasted.
//
// Kept apart from `arxiv.ts` (the LaTeXML extractor) because this runs in the UI
// on every keystroke and so ships in the initial bundle, while the extractor
// belongs to the lazy-loaded conversion engine.
//
// arXiv has published HTML beside the PDF for LaTeX submissions since December
// 2023. Older papers simply 404, which is how the UI detects "no HTML for this".

const NEW_ID = /^\d{4}\.\d{4,5}(v\d+)?$/;
const OLD_ID = /^[a-z-]+(\.[A-Za-z]{2})?\/\d{7}(v\d+)?$/;

const ARXIV_HOST = /(^|\.)(arxiv\.org|ar5iv\.org|doi\.org)$/i;

/**
 * Extract an arXiv id from a bare id, an `arXiv:` reference, an arXiv DOI, or an
 * arxiv.org/ar5iv link (`/abs/`, `/pdf/`, `/html/`). Returns null if `input`
 * doesn't identify an arXiv paper — including for non-arXiv URLs, so the caller
 * can fall back to fetching the URL as given.
 */
export function parseArxivId(input: string): string | null {
  let s = input.trim();
  if (!s) return null;

  const looksLikeUrl =
    /^https?:\/\//i.test(s) || /^(\/\/|www\.)/i.test(s) || ARXIV_HOST.test(s.split('/')[0]);

  if (looksLikeUrl) {
    let u: URL;
    try {
      u = new URL(/^https?:\/\//i.test(s) ? s : `https://${s.replace(/^\/\//, '')}`);
    } catch {
      return null;
    }
    if (!ARXIV_HOST.test(u.hostname)) return null;
    s = decodeURIComponent(u.pathname)
      .replace(/^\/+/, '')
      .replace(/\/+$/, '')
      .replace(/\.pdf$/i, '')
      .replace(/^(abs|pdf|html|format|ps)\//i, '');
  }

  s = s
    .replace(/^arxiv\s*[:\s]\s*/i, '')
    .replace(/^(doi:)?10\.48550\/arxiv\./i, '')
    .trim();

  return NEW_ID.test(s) || OLD_ID.test(s) ? s : null;
}

/** The HTML rendering of a paper. 404s when arXiv has no HTML for it. */
export function arxivHtmlUrl(id: string): string {
  return `https://arxiv.org/html/${id}`;
}
