// Post-render DOM transforms over the rendered markdown container.
//
// Order matters: we resolve author-supplied images and raw <svg> first, then
// generate diagram/equation images (which already carry final images/* paths,
// so they must not pass through the image resolver again).

import { slugify, uniqueSlug } from './slug';
import { AssetRegistry, resolveSource, type FileIndex } from './images';
import { svgToPngBlob, measureSvg } from './rasterize';
import { renderMermaid } from './mermaid';
import { texToSvg } from './math';

// Math sizing. 1 MathJax `ex` ≈ 0.5em in CSS; we size the <img> in em so the
// equation scales with the reader's chosen font size on the Kindle. The PNG is
// rasterised at a higher pixel density so it stays crisp on 300ppi screens.
const EM_PER_EX = 0.5;
const PX_PER_EX = 22;
// Diagrams render at 2x their intrinsic size for crispness, capped to a sane max.
const DIAGRAM_SCALE = 2;
const DIAGRAM_MAX_PX = 2400;

export interface TransformResult {
  images: number;
  diagrams: number;
  equations: number;
}

async function toBytes(blob: Blob): Promise<Uint8Array> {
  return new Uint8Array(await blob.arrayBuffer());
}

function markMissing(img: Element, src: string, warnings: string[]): void {
  const note = img.ownerDocument.createElement('span');
  note.className = 'md2k-missing';
  note.textContent = `⟮ missing image: ${src} ⟯`;
  img.replaceWith(note);
  warnings.push(`Image not found: ${src}`);
}

export function assignHeadingIds(container: HTMLElement): void {
  const used = new Set<string>();
  container.querySelectorAll('h1, h2, h3, h4, h5, h6').forEach((h) => {
    const existing = h.getAttribute('id');
    if (existing) {
      used.add(existing);
      return;
    }
    h.setAttribute('id', uniqueSlug(slugify(h.textContent || 'section'), used));
  });
}

async function processRawSvg(container: HTMLElement, registry: AssetRegistry): Promise<number> {
  // Raw author-written <svg>. Runs AFTER processImages so the <img> we emit here
  // (already pointing at images/*) is never re-resolved.
  const svgs = Array.from(container.querySelectorAll('svg'));
  let count = 0;
  for (const svg of svgs) {
    const text = new XMLSerializer().serializeToString(svg);
    const { width, height } = measureSvg(text);
    const scale = Math.min(DIAGRAM_SCALE, DIAGRAM_MAX_PX / Math.max(width, height, 1));
    const blob = await svgToPngBlob(text, width * scale, height * scale, '#ffffff');
    const asset = registry.add(await toBytes(blob), 'image/png');
    const img = svg.ownerDocument.createElement('img');
    img.setAttribute('src', asset.href);
    img.setAttribute('alt', svg.getAttribute('aria-label') || 'figure');
    svg.replaceWith(img);
    count++;
  }
  return count;
}

async function processImages(
  container: HTMLElement,
  registry: AssetRegistry,
  index: FileIndex,
  warnings: string[],
): Promise<number> {
  let count = 0;
  const imgs = Array.from(container.querySelectorAll('img'));
  for (const img of imgs) {
    const src = img.getAttribute('src') || '';
    if (!src) continue;
    try {
      const resolved = await resolveSource(src, index);
      if (!resolved) {
        markMissing(img, src, warnings);
        continue;
      }
      let { data, mediaType } = resolved;
      if (mediaType === 'image/svg+xml') {
        const text = new TextDecoder().decode(data);
        const { width, height } = measureSvg(text);
        const scale = Math.min(DIAGRAM_SCALE, DIAGRAM_MAX_PX / Math.max(width, height, 1));
        const blob = await svgToPngBlob(text, width * scale, height * scale, '#ffffff');
        data = await toBytes(blob);
        mediaType = 'image/png';
      }
      const asset = registry.add(data, mediaType, `src:${src}`);
      img.setAttribute('src', asset.href);
      if (!img.getAttribute('alt')) img.setAttribute('alt', '');
      count++;
    } catch (err) {
      warnings.push(`Could not load image "${src}": ${(err as Error).message}`);
      markMissing(img, src, warnings);
    }
  }
  return count;
}

async function processMermaid(
  container: HTMLElement,
  registry: AssetRegistry,
  warnings: string[],
): Promise<number> {
  let count = 0;
  const blocks = Array.from(container.querySelectorAll('code.language-mermaid'));
  for (const code of blocks) {
    const host = code.closest('pre') ?? code;
    const source = code.textContent || '';
    try {
      const { svg, width, height } = await renderMermaid(source);
      const scale = Math.min(DIAGRAM_SCALE, DIAGRAM_MAX_PX / Math.max(width, height, 1));
      const blob = await svgToPngBlob(svg, width * scale, height * scale, '#ffffff');
      const asset = registry.add(await toBytes(blob), 'image/png');
      const figure = host.ownerDocument.createElement('figure');
      figure.className = 'md2k-diagram';
      const img = host.ownerDocument.createElement('img');
      img.setAttribute('src', asset.href);
      img.setAttribute('alt', 'diagram');
      figure.appendChild(img);
      host.replaceWith(figure);
      count++;
    } catch (err) {
      warnings.push(`Mermaid diagram failed: ${(err as Error).message}`);
    }
  }
  return count;
}

async function processMath(
  container: HTMLElement,
  registry: AssetRegistry,
  warnings: string[],
): Promise<number> {
  let count = 0;
  const spans = Array.from(container.querySelectorAll('span.md2k-math'));
  for (const span of spans) {
    const tex = decodeURIComponent(span.getAttribute('data-tex') || '');
    const display = span.getAttribute('data-display') === '1';
    if (!tex.trim()) {
      span.remove();
      continue;
    }
    try {
      const m = texToSvg(tex, display);
      const blob = await svgToPngBlob(m.svg, m.widthEx * PX_PER_EX, m.heightEx * PX_PER_EX);
      const asset = registry.add(await toBytes(blob), 'image/png');
      const doc = span.ownerDocument;
      const img = doc.createElement('img');
      img.setAttribute('src', asset.href);
      img.setAttribute('alt', tex);
      const wEm = (m.widthEx * EM_PER_EX).toFixed(3);
      const hEm = (m.heightEx * EM_PER_EX).toFixed(3);

      if (display) {
        img.setAttribute('style', `height:${hEm}em;width:${wEm}em;`);
        img.className = 'md2k-math-img';
        const block = doc.createElement('div');
        block.className = 'md2k-math-block';
        block.appendChild(img);
        const parent = span.parentElement;
        if (parent && parent.tagName === 'P' && parent.childNodes.length === 1) {
          parent.replaceWith(block);
        } else {
          span.replaceWith(block);
        }
      } else {
        const vEm = (m.valignEx * EM_PER_EX).toFixed(3);
        img.setAttribute('style', `height:${hEm}em;width:${wEm}em;vertical-align:${vEm}em;`);
        img.className = 'md2k-math-img';
        span.replaceWith(img);
      }
      count++;
    } catch (err) {
      span.textContent = tex;
      warnings.push(`Equation failed: ${tex.slice(0, 48)} (${(err as Error).message})`);
    }
  }
  return count;
}

export async function transform(
  container: HTMLElement,
  registry: AssetRegistry,
  index: FileIndex,
  warnings: string[],
  onStage: (stage: string, pct: number) => void,
): Promise<TransformResult> {
  assignHeadingIds(container);

  onStage('Resolving images', 0.2);
  // Resolve author images first; only THEN generate images from raw SVG so the
  // generated <img> (pointing at images/*) is never mistaken for a broken link.
  let images = await processImages(container, registry, index, warnings);
  images += await processRawSvg(container, registry);

  onStage('Rendering diagrams', 0.45);
  const diagrams = await processMermaid(container, registry, warnings);

  onStage('Typesetting equations', 0.65);
  const equations = await processMath(container, registry, warnings);

  return { images, diagrams, equations };
}
