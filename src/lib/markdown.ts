// Markdown -> sanitised HTML.
//
// Math is NOT rendered here. Instead the math plugin emits lightweight
// placeholder <span>s carrying the (URI-encoded) LaTeX source, which the
// transform step later rasterises with MathJax. This keeps the markdown layer
// pure and gives us full control over how equations end up in the EPUB.

import MarkdownIt from 'markdown-it';
import footnote from 'markdown-it-footnote';
import taskLists from 'markdown-it-task-lists';
import DOMPurify from 'dompurify';

export const MATH_CLASS = 'md2k-math';

function mathPlaceholder(tex: string, display: boolean): string {
  // URI-encode so the LaTeX (with <, >, &, quotes, backslashes) survives both
  // HTML attribute serialisation and DOMPurify untouched.
  const enc = encodeURIComponent(tex);
  return `<span class="${MATH_CLASS}" data-tex="${enc}" data-display="${display ? '1' : '0'}"></span>`;
}

const SPACE = new Set([0x20, 0x09, 0x0a, 0x0d]);

/** Parse `$...$` (inline) or `$$...$$` (display) starting at `start` (a `$`). */
function parseDollar(
  src: string,
  start: number,
  max: number,
): { content: string; end: number; display: boolean } | null {
  const display = src.charCodeAt(start + 1) === 0x24;
  const mlen = display ? 2 : 1;
  let pos = start + mlen;
  if (pos >= max) return null;

  // For inline `$`, the opening delimiter must not be followed by whitespace.
  if (!display && SPACE.has(src.charCodeAt(pos))) return null;

  while (pos < max) {
    const c = src.charCodeAt(pos);
    if (c === 0x5c) {
      // Skip an escaped character (covers `\\`, `\$`, `\}` ...).
      pos += 2;
      continue;
    }
    if (c === 0x24) {
      if (display) {
        if (src.charCodeAt(pos + 1) === 0x24) {
          const content = src.slice(start + mlen, pos);
          if (!content.trim()) return null;
          return { content, end: pos + 2, display: true };
        }
        pos += 1;
        continue;
      }
      // Inline close: not preceded by whitespace, not followed by a digit
      // (so prices like "$5 and $10" stay literal).
      if (SPACE.has(src.charCodeAt(pos - 1))) {
        pos += 1;
        continue;
      }
      const after = src.charCodeAt(pos + 1);
      if (after >= 0x30 && after <= 0x39) {
        pos += 1;
        continue;
      }
      const content = src.slice(start + mlen, pos);
      if (!content.trim()) return null;
      return { content, end: pos + 1, display: false };
    }
    pos += 1;
  }
  return null;
}

/** Parse `\(...\)` / `\[...\]` starting at `start` (a backslash). */
function parseBracket(
  src: string,
  start: number,
): { content: string; end: number; display: boolean } | null {
  const opener = src.charCodeAt(start + 1);
  const display = opener === 0x5b; // '['
  const close = display ? '\\]' : '\\)';
  const closeIdx = src.indexOf(close, start + 2);
  if (closeIdx === -1) return null;
  const content = src.slice(start + 2, closeIdx);
  if (!content.trim()) return null;
  return { content, end: closeIdx + 2, display };
}

function mathInlineRule(state: any, silent: boolean): boolean {
  const start: number = state.pos;
  const max: number = state.posMax;
  const src: string = state.src;
  const ch = src.charCodeAt(start);

  let parsed: { content: string; end: number; display: boolean } | null = null;
  if (ch === 0x24) {
    parsed = parseDollar(src, start, max);
  } else if (ch === 0x5c) {
    const next = src.charCodeAt(start + 1);
    if (next === 0x28 || next === 0x5b) parsed = parseBracket(src, start);
  }
  if (!parsed) return false;

  if (!silent) {
    const token = state.push('math', 'span', 0);
    token.content = parsed.content;
    token.meta = { display: parsed.display };
  }
  state.pos = parsed.end;
  return true;
}

function mathPlugin(md: MarkdownIt): void {
  md.inline.ruler.before('escape', 'math', mathInlineRule);
  md.renderer.rules.math = (tokens, idx) => {
    const t = tokens[idx];
    return mathPlaceholder(t.content, !!(t.meta && t.meta.display));
  };
}

const md = new MarkdownIt({
  html: true, // allow raw HTML / inline <svg>; sanitised below
  linkify: true,
  typographer: true, // smart quotes / dashes — nicer for long-form reading
  breaks: false,
});

md.use(footnote);
md.use(taskLists, { label: true });
md.use(mathPlugin);

// Permit relative paths, data: and blob: URIs (for embedded images) in addition
// to the usual safe schemes.
const ALLOWED_URI =
  /^(?:(?:https?|mailto|tel|callto|sms|data|blob):|[^a-z]|[a-z+.\-]+(?:[^a-z+.\-:]|$))/i;

/** Sanitise arbitrary HTML for safe inclusion in the EPUB (also used by the HTML input path). */
export function sanitizeHtml(html: string): string {
  return DOMPurify.sanitize(html, {
    USE_PROFILES: { html: true, svg: true, svgFilters: true, mathMl: true },
    ADD_ATTR: ['target', 'epub:type'],
    ALLOWED_URI_REGEXP: ALLOWED_URI,
  });
}

export function renderMarkdown(markdown: string): string {
  return sanitizeHtml(md.render(markdown));
}
