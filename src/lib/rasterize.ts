// Convert an SVG string into a PNG Blob via a canvas. Shared by the mermaid,
// MathJax and raw-<svg> code paths so diagrams and equations all become raster
// images that every Kindle generation renders identically.

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Failed to load SVG for rasterisation'));
    img.src = url;
  });
}

function canvasToBlob(canvas: HTMLCanvasElement, type = 'image/png', quality?: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('canvas.toBlob returned null'))),
      type,
      quality,
    );
  });
}

/** Ensure the root <svg> declares the namespace and explicit pixel dimensions. */
function normaliseSvg(svg: string, width: number, height: number): string {
  let s = svg.trim();
  if (!/\sxmlns=/.test(s)) {
    s = s.replace(/<svg/, '<svg xmlns="http://www.w3.org/2000/svg"');
  }
  s = s.replace(/<svg([^>]*?)>/, (_m, attrs: string) => {
    const cleaned = attrs.replace(/\s(?:width|height)="[^"]*"/g, '');
    return `<svg${cleaned} width="${width}" height="${height}">`;
  });
  return s;
}

export async function svgToPngBlob(
  svg: string,
  width: number,
  height: number,
  background?: string,
): Promise<Blob> {
  const w = Math.max(1, Math.round(width));
  const h = Math.max(1, Math.round(height));
  const sized = normaliseSvg(svg, w, h);
  const url = URL.createObjectURL(new Blob([sized], { type: 'image/svg+xml;charset=utf-8' }));
  try {
    const img = await loadImage(url);
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas 2D context unavailable');
    if (background) {
      ctx.fillStyle = background;
      ctx.fillRect(0, 0, w, h);
    }
    ctx.drawImage(img, 0, 0, w, h);
    return await canvasToBlob(canvas, 'image/png');
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** Best-effort intrinsic size of an SVG from its viewBox or width/height. */
export function measureSvg(svg: string): { width: number; height: number } {
  const vb = svg.match(/viewBox\s*=\s*"([^"]+)"/);
  if (vb) {
    const parts = vb[1].trim().split(/[\s,]+/).map(Number);
    if (parts.length === 4 && parts[2] > 0 && parts[3] > 0) {
      return { width: parts[2], height: parts[3] };
    }
  }
  const w = svg.match(/\bwidth\s*=\s*"([\d.]+)/);
  const h = svg.match(/\bheight\s*=\s*"([\d.]+)/);
  return {
    width: w ? parseFloat(w[1]) : 800,
    height: h ? parseFloat(h[1]) : 600,
  };
}

export { canvasToBlob };
