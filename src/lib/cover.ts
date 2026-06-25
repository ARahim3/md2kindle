// Generate a clean, typographic cover image on a canvas. Literary-press feel:
// warm paper, a thin double rule, a small kicker, the title in Fraunces, and the
// author below a short accent rule.

import { canvasToBlob } from './rasterize';

const PAPER = '#f4efe6';
const INK = '#1c1a17';

async function ensureFonts(): Promise<void> {
  const fonts = (document as Document & { fonts?: FontFaceSet }).fonts;
  if (!fonts) return;
  try {
    await Promise.all([
      fonts.load('700 120px "Newsreader"'),
      fonts.load('italic 700 120px "Newsreader"'),
      fonts.load('600 40px "IBM Plex Mono"'),
    ]);
    await fonts.ready;
  } catch {
    /* fall back to system serifs */
  }
}

function wrapLines(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number,
): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let line = '';
  for (const w of words) {
    const test = line ? `${line} ${w}` : w;
    if (ctx.measureText(test).width > maxWidth && line) {
      lines.push(line);
      line = w;
    } else {
      line = test;
    }
  }
  if (line) lines.push(line);
  return lines;
}

function drawSpacedText(
  ctx: CanvasRenderingContext2D,
  text: string,
  cx: number,
  y: number,
  spacing: number,
): void {
  const widths = [...text].map((ch) => ctx.measureText(ch).width + spacing);
  const total = widths.reduce((a, b) => a + b, 0) - spacing;
  let x = cx - total / 2;
  for (let i = 0; i < text.length; i++) {
    ctx.fillText(text[i], x + widths[i] / 2 - spacing / 2, y);
    x += widths[i];
  }
}

export async function generateCover(
  title: string,
  author: string,
  accent = '#c1440e',
): Promise<Blob> {
  await ensureFonts();

  const W = 1600;
  const H = 2560;
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas 2D context unavailable');

  // Paper
  ctx.fillStyle = PAPER;
  ctx.fillRect(0, 0, W, H);

  // Faint paper speckle for texture
  ctx.fillStyle = 'rgba(28,26,23,0.025)';
  for (let i = 0; i < 1400; i++) {
    ctx.fillRect(Math.random() * W, Math.random() * H, 2, 2);
  }

  // Double rule frame
  const m = 120;
  ctx.strokeStyle = INK;
  ctx.lineWidth = 4;
  ctx.strokeRect(m, m, W - 2 * m, H - 2 * m);
  ctx.strokeStyle = accent;
  ctx.lineWidth = 2;
  ctx.strokeRect(m + 18, m + 18, W - 2 * m - 36, H - 2 * m - 36);

  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';

  // Kicker
  ctx.fillStyle = accent;
  ctx.font = '600 32px "IBM Plex Mono", monospace';
  drawSpacedText(ctx, 'MARKDOWN EDITION', W / 2, m + 150, 8);

  // Title (auto-fit)
  const maxTextWidth = W - 2 * m - 160;
  let size = 162;
  let lines: string[] = [];
  for (; size >= 64; size -= 6) {
    ctx.font = `700 ${size}px "Newsreader", Georgia, serif`;
    lines = wrapLines(ctx, title, maxTextWidth);
    if (lines.length <= 5) break;
  }
  ctx.fillStyle = INK;
  const lineHeight = size * 1.12;
  const blockHeight = lines.length * lineHeight;
  let y = H / 2 - blockHeight / 2 + size;
  for (const line of lines) {
    ctx.fillText(line, W / 2, y);
    y += lineHeight;
  }

  // Accent rule under the title
  const ruleY = y + 20;
  ctx.strokeStyle = accent;
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.moveTo(W / 2 - 90, ruleY);
  ctx.lineTo(W / 2 + 90, ruleY);
  ctx.stroke();

  // Author
  ctx.fillStyle = INK;
  ctx.font = '500 40px "IBM Plex Mono", monospace';
  drawSpacedText(ctx, author.toUpperCase(), W / 2, ruleY + 90, 4);

  // Footer mark
  ctx.fillStyle = 'rgba(28,26,23,0.55)';
  ctx.font = '500 30px "IBM Plex Mono", monospace';
  drawSpacedText(ctx, 'md2kindle', W / 2, H - m - 70, 3);

  return canvasToBlob(canvas, 'image/jpeg', 0.92);
}
