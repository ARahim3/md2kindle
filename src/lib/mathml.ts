// MathML -> the same TeX placeholder the Markdown math plugin emits.
//
// Pages that typeset maths server-side — LaTeXML (arXiv, ar5iv), Pandoc, KaTeX —
// ship presentation MathML with the original TeX riding alongside it, either in
// an `alttext` attribute or in <annotation encoding="application/x-tex">. Lifting
// that TeX into a placeholder sends the equation through the MathJax -> PNG path
// we already use for Markdown, so it renders identically on every Kindle
// generation instead of depending on the device's patchy MathML support.
//
// This runs BEFORE sanitisation on purpose. DOMPurify's MathML profile allows
// neither `alttext` nor the <semantics>/<annotation> wrappers, but it keeps the
// text of the elements it strips — so untouched MathML spills its raw LaTeX and
// its screen-reader prose straight into the body text.

import { MATH_CLASS } from './markdown';

const TEX_ENCODING = /^(application\/x-tex|math\/tex|text\/x-tex|tex|latex)$/i;

function texSource(math: Element): string {
  const alt = math.getAttribute('alttext');
  if (alt && alt.trim()) return alt.trim();
  for (const a of Array.from(math.getElementsByTagName('annotation'))) {
    if (!TEX_ENCODING.test(a.getAttribute('encoding') || '')) continue;
    const tex = (a.textContent || '').trim();
    if (tex) return tex;
  }
  return '';
}

/**
 * Replace every <math> carrying a recoverable TeX source with a math
 * placeholder. MathML we can't recover TeX from is left in place, minus the
 * annotation subtrees whose text would otherwise leak into the prose.
 *
 * Returns the number of equations converted.
 */
export function mathmlToPlaceholders(root: ParentNode): number {
  const doc = (root as Element).ownerDocument ?? (root as Document);
  let count = 0;

  for (const math of Array.from(root.querySelectorAll('math'))) {
    const tex = texSource(math);
    if (!tex) {
      math.querySelectorAll('annotation, annotation-xml').forEach((a) => a.remove());
      continue;
    }

    const span = doc.createElement('span');
    span.className = MATH_CLASS;
    // URI-encoded so the LaTeX survives attribute serialisation, matching what
    // the Markdown math plugin produces.
    span.setAttribute('data-tex', encodeURIComponent(tex));
    span.setAttribute(
      'data-display',
      math.getAttribute('display') === 'block' || math.getAttribute('mode') === 'display' ? '1' : '0',
    );

    // KaTeX hides MathML behind .katex-mathml purely for accessibility and paints
    // the visible equation as a .katex-html twin; replacing the whole .katex
    // wrapper keeps us from rendering the same equation twice.
    (math.closest('.katex') ?? math).replaceWith(span);
    count++;
  }

  return count;
}
