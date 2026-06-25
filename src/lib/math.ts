// TeX -> SVG using MathJax. We use the lite adaptor (no DOM dependency) and the
// 'local' font cache so each returned SVG is fully self-contained and can be
// rasterised on its own.

import { mathjax } from 'mathjax-full/js/mathjax.js';
import { TeX } from 'mathjax-full/js/input/tex.js';
import { SVG } from 'mathjax-full/js/output/svg.js';
import { liteAdaptor } from 'mathjax-full/js/adaptors/liteAdaptor.js';
import { RegisterHTMLHandler } from 'mathjax-full/js/handlers/html.js';
import { AllPackages } from 'mathjax-full/js/input/tex/AllPackages.js';

const adaptor = liteAdaptor();
RegisterHTMLHandler(adaptor);

const texInput = new TeX({ packages: AllPackages });
const svgOutput = new SVG({ fontCache: 'local' });
const doc = mathjax.document('', { InputJax: texInput, OutputJax: svgOutput });

export interface MathSvg {
  svg: string;
  /** Intrinsic dimensions in MathJax `ex` units. */
  widthEx: number;
  heightEx: number;
  /** Baseline offset in `ex` (typically negative). */
  valignEx: number;
}

function parseEx(value: string | null): number {
  if (!value) return 0;
  const m = value.match(/([-\d.]+)\s*ex/);
  return m ? parseFloat(m[1]) : 0;
}

export function texToSvg(tex: string, display: boolean): MathSvg {
  // The lite adaptor's node types are internal; `any` keeps this readable
  // without fighting MathJax's private LiteElement typings.
  const container: any = doc.convert(tex, { display });
  const svgNode: any = adaptor.firstChild(container);
  const svg: string = adaptor.outerHTML(svgNode);
  const widthEx = parseEx(adaptor.getAttribute(svgNode, 'width'));
  const heightEx = parseEx(adaptor.getAttribute(svgNode, 'height'));
  const style: string = adaptor.getAttribute(svgNode, 'style') || '';
  const vMatch = style.match(/vertical-align:\s*([-\d.]+)\s*ex/);
  return {
    svg,
    widthEx: widthEx || 1,
    heightEx: heightEx || 1,
    valignEx: vMatch ? parseFloat(vMatch[1]) : 0,
  };
}
