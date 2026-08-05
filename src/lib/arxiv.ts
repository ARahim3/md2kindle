// Pulling a clean article out of the LaTeXML markup that arXiv (and ar5iv)
// generate for a paper. Recognising an arXiv id lives in `arxivid.ts`.
//
// Why a dedicated extractor rather than Readability: LaTeXML wraps every display
// equation in a <table class="ltx_equation">, and Readability's table cleaning
// deletes all of them — a paper loses every numbered equation. It also reads the
// byline off the first citation instead of the author block. The markup is fully
// predictable, so we take the article verbatim and strip the page chrome by hand.

export interface PaperExtract {
  html: string;
  title?: string;
  author?: string;
}

// Page furniture that is navigation, not paper.
const CHROME = [
  '.ltx_page_navbar',
  '.ltx_page_footer',
  '.ltx_page_logo',
  'nav.ltx_TOC',
  '.ltx_toclist',
  '#alerts',
  '.package-alerts',
  '.ltx_ERROR',
  'script',
  'style',
  'noscript',
  'button', // arXiv injects "Report issue for preceding element" buttons
].join(',');

// LaTeXML nests each top-level section in a wrapper element, which hides its
// heading from the chapter splitter — that only groups on the container's own
// children, so the whole paper would land in a single chapter.
const SECTION_WRAPPERS = [
  'section.ltx_section',
  'section.ltx_appendix',
  'section.ltx_bibliography',
  'section.ltx_acknowledgements',
  'div.ltx_abstract',
  'section.ltx_abstract',
].join(',');

function flattenSections(article: Element): void {
  for (const wrapper of Array.from(article.querySelectorAll(SECTION_WRAPPERS))) {
    // Only the outermost level: subsections stay nested, as they aren't split points.
    if (wrapper.parentElement !== article) continue;
    wrapper.replaceWith(...Array.from(wrapper.childNodes));
  }
}

// A LaTeXML byline is one run of text: author names first, then <br>-separated
// affiliation and email lines. Nothing marks where the names stop, so we read
// lines until one names a place rather than a person.
const AFFILIATION =
  /@|\b(universit|institut|laborator|college|department|school|academia|academy|centre|center|corporation|hospital|gmbh|inc\.|ltd)/i;

/** Byline lines, with the affiliation superscripts that would otherwise glue
 *  stray digits onto the names removed. */
function bylineLines(person: Element): string[] {
  const clone = person.cloneNode(true) as Element;
  clone.querySelectorAll('sup').forEach((sup) => sup.remove());
  clone.querySelectorAll('br').forEach((br) => br.replaceWith('\n'));
  return (clone.textContent || '').split('\n');
}

function authorsFrom(root: Element): string | undefined {
  const names: string[] = [];

  for (const person of Array.from(root.querySelectorAll('.ltx_authors .ltx_personname'))) {
    for (const line of bylineLines(person)) {
      if (AFFILIATION.test(line)) break;
      // LaTeXML runs co-authors together inside one line, separated by the wide
      // space \and produces — so split before collapsing whitespace.
      for (const part of line.split(/\s{2,}/)) {
        const name = part.replace(/\s+/g, ' ').trim().replace(/[,;]$/, '');
        if (name && !names.includes(name)) names.push(name);
      }
    }
  }

  if (!names.length) return undefined;
  // Papers with a cast of dozens would otherwise swamp the cover and the
  // library listing.
  return names.length > 6 ? `${names.slice(0, 6).join(', ')} et al.` : names.join(', ');
}

/**
 * Rebuild `<table class="ltx_equation">` as a plain centred block. A Kindle
 * renders a four-cell layout table badly (and our stylesheet gives every table
 * full-width borders), while the equation itself is just one image.
 */
function unwrapEquations(root: Element, doc: Document): void {
  for (const table of Array.from(root.querySelectorAll('table.ltx_equation'))) {
    const block = doc.createElement('div');
    block.className = 'md2k-eq';

    // One line per row, so `align` environments keep their line breaks.
    for (const row of Array.from(table.querySelectorAll('tr'))) {
      const line = doc.createElement('div');
      line.className = 'md2k-eq-line';
      let number: Element | null = null;

      for (const cell of Array.from(row.children)) {
        if (cell.classList.contains('ltx_eqn_eqno')) {
          number = cell;
          continue;
        }
        while (cell.firstChild) line.appendChild(cell.firstChild);
      }

      const tag = number?.textContent?.trim();
      if (tag) {
        const eqno = doc.createElement('span');
        eqno.className = 'md2k-eqno';
        eqno.textContent = tag;
        line.appendChild(eqno);
      }
      if (line.childNodes.length) block.appendChild(line);
    }

    if (block.childNodes.length) table.replaceWith(block);
    else table.remove();
  }
}

/**
 * Title and byline only, without rebuilding the article — cheap enough for the
 * form to peek at a paper while the reader is still deciding to convert it.
 * Returns null for every page that isn't a LaTeXML paper.
 */
export function latexmlMetadata(doc: Document): { title?: string; author?: string } | null {
  const article = doc.querySelector('article.ltx_document');
  if (!article) return null;
  return {
    title:
      article.querySelector('.ltx_title_document')?.textContent?.replace(/\s+/g, ' ').trim() ||
      undefined,
    author: authorsFrom(article),
  };
}

/**
 * If `doc` is a LaTeXML paper (arXiv / ar5iv), return its article stripped of
 * page chrome, plus the title and byline. Returns null for every other page so
 * the caller falls through to the normal HTML path.
 */
export function extractLatexmlArticle(doc: Document): PaperExtract | null {
  const source = doc.querySelector('article.ltx_document');
  if (!source) return null;

  const article = source.cloneNode(true) as Element;
  article.querySelectorAll(CHROME).forEach((el) => el.remove());

  const { title, author } = latexmlMetadata(doc)!;

  // LaTeXML titles the abstract with an <h6>; promote it so it earns a place in
  // the table of contents alongside the <h2> sections.
  const abstractTitle = article.querySelector('h6.ltx_title_abstract');
  if (abstractTitle) {
    const h2 = doc.createElement('h2');
    h2.className = abstractTitle.className;
    h2.innerHTML = abstractTitle.innerHTML;
    abstractTitle.replaceWith(h2);
  }

  unwrapEquations(article, doc);
  flattenSections(article);

  return { html: article.innerHTML, title: title || undefined, author };
}
