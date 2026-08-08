// Refresh the self-hosted webfonts in src/fonts/ + regenerate src/fonts.css.
//
//   node scripts/fetch-fonts.mjs
//
// Asks fonts.googleapis.com for the same css2 request the page used to make,
// with a modern UA so it answers with woff2, then downloads every face and
// rewrites the @font-face rules to point at local files. unicode-range is kept
// verbatim, so browsers still fetch only the subsets they need.
//
// Only run this to pick up upstream font updates — the output is committed.

import fs from 'node:fs';
import path from 'node:path';

const CSS_URL =
  'https://fonts.googleapis.com/css2?family=Newsreader:ital,opsz,wght@0,6..72,400;0,6..72,500;0,6..72,600;0,6..72,700;1,6..72,400;1,6..72,500;1,6..72,600&family=IBM+Plex+Mono:wght@400;500;600&display=swap';

const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

// Vietnamese is ~200 KB and unreachable here; Cyrillic is ~29 KB and the
// auto-filled author field renders real names, so it earns its place.
const KEEP = new Set(['latin', 'latin-ext', 'cyrillic', 'cyrillic-ext']);

const OUT_DIR = new URL('../src/fonts/', import.meta.url);
const OUT_CSS = new URL('../src/fonts.css', import.meta.url);

const css = await (await fetch(CSS_URL, { headers: { 'user-agent': UA } })).text();

const faces = [...css.matchAll(/\/\*\s*([a-z-]+)\s*\*\/\s*@font-face\s*\{([\s\S]*?)\}/g)]
  .map((m) => {
    const body = m[2];
    const get = (k) => (body.match(new RegExp(`${k}:\\s*([^;]+);`))?.[1] || '').trim();
    return {
      subset: m[1],
      family: get('font-family').replace(/['"]/g, ''),
      style: get('font-style'),
      weight: get('font-weight'),
      url: body.match(/url\(([^)]+)\)/)?.[1],
      range: get('unicode-range'),
    };
  })
  .filter((f) => KEEP.has(f.subset) && f.url);

if (!faces.length) throw new Error('No @font-face blocks parsed — did the css2 response change shape?');

fs.rmSync(OUT_DIR, { recursive: true, force: true });
fs.mkdirSync(OUT_DIR, { recursive: true });

// Newsreader is variable: Google returns one identical file for weights
// 400–700, with the @font-face blocks differing only in declared font-weight.
// Group by URL so a shared file is downloaded and stored once — otherwise we
// commit the same 132 KB four times over.
const byUrl = new Map();
for (const f of faces) {
  if (!byUrl.has(f.url)) byUrl.set(f.url, []);
  byUrl.get(f.url).push(f);
}

let bytes = 0;
const fileFor = new Map();
for (const [url, group] of byUrl) {
  const { family, style, subset } = group[0];
  // Only name the weight when this file *is* one weight (a static face).
  const weight = group.length === 1 ? `-${group[0].weight}` : '';
  const name =
    `${family.toLowerCase().replace(/\s+/g, '-')}` +
    `${style === 'italic' ? '-italic' : ''}${weight}-${subset}.woff2`;
  const buf = Buffer.from(await (await fetch(url)).arrayBuffer());
  fs.writeFileSync(path.join(OUT_DIR.pathname, name), buf);
  bytes += buf.length;
  fileFor.set(url, name);
}

const rules = faces.map(
  (f) =>
    `@font-face {\n  font-family: '${f.family}';\n  font-style: ${f.style};\n` +
    `  font-weight: ${f.weight};\n  font-display: swap;\n` +
    `  src: url('./fonts/${fileFor.get(f.url)}') format('woff2');\n` +
    `  unicode-range: ${f.range};\n}`,
);

fs.writeFileSync(
  OUT_CSS,
  `/* Self-hosted Newsreader + IBM Plex Mono — GENERATED, do not edit by hand.\n` +
    ` * Regenerate with: node scripts/fetch-fonts.mjs\n` +
    ` *\n` +
    ` * Byte-identical to what fonts.googleapis.com serves. Self-hosting removes\n` +
    ` * the last third party from the page (Google saw every visitor's IP, which\n` +
    ` * sat badly beside "100% on your device") and drops a round-trip: a font\n` +
    ` * could not start downloading until the remote CSS had landed.\n` +
    ` *\n` +
    ` * unicode-range is preserved, so a visitor still fetches only the subsets\n` +
    ` * their glyphs need — the same bytes over the wire, one less domain.\n` +
    ` */\n\n${rules.join('\n\n')}\n`,
);

console.log(`${faces.length} faces across ${byUrl.size} files, ${Math.round(bytes / 1024)} KB -> src/fonts/`);
