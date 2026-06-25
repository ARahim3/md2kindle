// Render a mermaid code block to an SVG string (in the browser DOM — mermaid
// needs a document to measure text). The caller rasterises the SVG to PNG.

import mermaid from 'mermaid';
import { measureSvg } from './rasterize';

let initialised = false;
let counter = 0;

function init(): void {
  if (initialised) return;
  mermaid.initialize({
    startOnLoad: false,
    securityLevel: 'strict',
    theme: 'neutral',
    fontFamily: 'Georgia, "Times New Roman", serif',
    // CRITICAL: render labels as SVG <text>, not <foreignObject>. A foreignObject
    // in the SVG taints the canvas, which blocks toBlob() during rasterisation.
    htmlLabels: false,
    flowchart: { htmlLabels: false, useMaxWidth: false },
    class: { htmlLabels: false },
  });
  initialised = true;
}

export async function renderMermaid(
  code: string,
): Promise<{ svg: string; width: number; height: number }> {
  init();
  const id = `md2k-mermaid-${++counter}`;
  const { svg } = await mermaid.render(id, code.trim());
  const { width, height } = measureSvg(svg);
  return { svg, width, height };
}
