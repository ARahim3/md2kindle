// End-to-end test: drive the built app in a real browser, generate an EPUB from
// the bundled sample (math + mermaid + raw SVG + table), then validate the
// resulting package structure and the well-formedness of every XHTML file.
import { chromium } from 'playwright';
import JSZip from 'jszip';
import { parseArxivId, arxivHtmlUrl } from '../src/lib/arxivid.ts';

const BASE_URL = process.env.BASE_URL || 'http://localhost:4173';
let failures = 0;
const assert = (cond, msg) => {
  console.log(`${cond ? '✓' : '✗'} ${msg}`);
  if (!cond) failures++;
};

const browser = await chromium.launch();
const page = await browser.newPage();
page.on('console', (m) => {
  if (m.type() === 'error') console.log('  [page error]', m.text());
});

await page.goto(BASE_URL, { waitUntil: 'networkidle' });
await page.getByRole('button', { name: /Load a sample/ }).click();
await page.getByRole('button', { name: 'Bind the EPUB' }).click();

// Wait for the result (engine lazy-loads MathJax + mermaid, so allow time).
await page.getByText('Bound & ready to read.').waitFor({ timeout: 90000 });

assert((await page.locator('.warnings').count()) === 0, 'clean sample produces no warnings');

const href = await page.locator('a.download-btn').getAttribute('href');
assert(!!href && href.startsWith('blob:'), 'download link is a blob URL');

const b64 = await page.evaluate(async (url) => {
  const buf = new Uint8Array(await (await fetch(url)).arrayBuffer());
  let bin = '';
  for (let i = 0; i < buf.length; i++) bin += String.fromCharCode(buf[i]);
  return btoa(bin);
}, href);
const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
assert(bytes.length > 1000, `EPUB has bytes (${bytes.length})`);

// --- structural validation ---
const zip = await JSZip.loadAsync(bytes);
const names = Object.keys(zip.files);

assert((await zip.file('mimetype').async('string')) === 'application/epub+zip', 'mimetype correct');
assert(names.includes('META-INF/container.xml'), 'container.xml present');
assert(names.includes('OEBPS/content.opf'), 'content.opf present');
assert(names.includes('OEBPS/nav.xhtml'), 'nav.xhtml present');
assert(names.includes('OEBPS/toc.ncx'), 'toc.ncx present (EPUB2 fallback)');

const css = await zip.file('OEBPS/style.css').async('string');
assert(/hyphens:\s*none/.test(css), 'stylesheet disables hyphens');
assert(/-webkit-hyphens:\s*none/.test(css), 'stylesheet disables -webkit-hyphens');

const chapters = names.filter((n) => /OEBPS\/chapter-\d+\.xhtml$/.test(n));
assert(chapters.length >= 1, `has chapter files (${chapters.length})`);

const imgs = names.filter((n) => /^OEBPS\/images\/.+\.png$/.test(n));
// sample => 3 equations + 1 mermaid diagram + 1 raw SVG
assert(imgs.length >= 5, `embedded raster images for diagram/svg/math (${imgs.length})`);

assert(names.includes('OEBPS/cover.xhtml'), 'cover.xhtml present');
assert(names.some((n) => /^OEBPS\/cover\.(jpg|png)$/.test(n)), 'cover image present');

const opf = await zip.file('OEBPS/content.opf').async('string');
assert(/<dc:title>The Aurora Notebook<\/dc:title>/.test(opf), 'title from front matter in OPF');
assert(/<dc:creator>A. Curious Mind<\/dc:creator>/.test(opf), 'author from front matter in OPF');
assert(/properties="cover-image"/.test(opf), 'cover-image declared in manifest');

// --- XHTML well-formedness (parse each in the real browser) ---
const xhtmlFiles = names.filter((n) => n.endsWith('.xhtml') || n.endsWith('.opf') || n.endsWith('.ncx'));
let wellFormed = 0;
for (const name of xhtmlFiles) {
  const content = await zip.file(name).async('string');
  const errCount = await page.evaluate((src) => {
    const doc = new DOMParser().parseFromString(src, 'application/xml');
    return doc.getElementsByTagName('parsererror').length;
  }, content);
  if (errCount === 0) wellFormed++;
  else console.log(`    ✗ malformed: ${name}`);
}
assert(wellFormed === xhtmlFiles.length, `all ${xhtmlFiles.length} XML/XHTML files well-formed`);

// Confirm a chapter actually references an embedded image (math/diagram made it in).
const chapterBodies = await Promise.all(chapters.map((c) => zip.file(c).async('string')));
assert(
  chapterBodies.some((b) => /images\/img-\d+\.png/.test(b)),
  'a chapter references an embedded image',
);

// ---------------------------------------------------------------------------
// HTML input path (Readability extraction)
// ---------------------------------------------------------------------------
await page.goto(BASE_URL, { waitUntil: 'networkidle' });
await page.getByRole('button', { name: 'HTML' }).click();
await page.getByRole('button', { name: /Load a sample blog page/ }).click();
await page.getByRole('button', { name: 'Bind the EPUB' }).click();
await page.getByText('Bound & ready to read.').waitFor({ timeout: 90000 });

const href2 = await page.locator('a.download-btn').getAttribute('href');
const b64b = await page.evaluate(async (url) => {
  const buf = new Uint8Array(await (await fetch(url)).arrayBuffer());
  let bin = '';
  for (let i = 0; i < buf.length; i++) bin += String.fromCharCode(buf[i]);
  return btoa(bin);
}, href2);
const zip2 = await JSZip.loadAsync(Uint8Array.from(atob(b64b), (c) => c.charCodeAt(0)));
const opf2 = await zip2.file('OEBPS/content.opf').async('string');
assert(/On Quiet Software/.test(opf2), 'HTML: title extracted from article');
assert(/<dc:creator>J\. Reader<\/dc:creator>/.test(opf2), 'HTML: author from byline/meta');

const chaps2 = Object.keys(zip2.files).filter((n) => /chapter-\d+\.xhtml$/.test(n));
assert(chaps2.length >= 1, `HTML: has chapter files (${chaps2.length})`);
const body2 = (await Promise.all(chaps2.map((c) => zip2.file(c).async('string')))).join('');
assert(/Respecting the reader/.test(body2), 'HTML: article body preserved');
assert(!/Cookie policy|Newsletter|Subscribe for weekly/.test(body2), 'HTML: Readability stripped nav/sidebar/footer');

// ---------------------------------------------------------------------------
// URL input path (server-side proxy fetch + relative image + Readability)
// ---------------------------------------------------------------------------
await page.goto(BASE_URL, { waitUntil: 'networkidle' });
await page.getByRole('button', { name: 'HTML' }).click();
await page.getByRole('button', { name: 'URL', exact: true }).click();
await page.locator('.url-input').fill(`${BASE_URL}/fixture/post.html`);
await page.getByRole('button', { name: 'Fetch' }).click();
await page.locator('.url-status.ok').waitFor({ timeout: 30000 });
await page.getByRole('button', { name: 'Bind the EPUB' }).click();
await page.getByText('Bound & ready to read.').waitFor({ timeout: 90000 });

const href3 = await page.locator('a.download-btn').getAttribute('href');
const b64c = await page.evaluate(async (url) => {
  const buf = new Uint8Array(await (await fetch(url)).arrayBuffer());
  let bin = '';
  for (let i = 0; i < buf.length; i++) bin += String.fromCharCode(buf[i]);
  return btoa(bin);
}, href3);
const zip3 = await JSZip.loadAsync(Uint8Array.from(atob(b64c), (c) => c.charCodeAt(0)));
const names3 = Object.keys(zip3.files);
const opf3 = await zip3.file('OEBPS/content.opf').async('string');
assert(/A Test Post/.test(opf3), 'URL: title extracted from fetched page');
const body3 = (
  await Promise.all(
    names3.filter((n) => /chapter-\d+\.xhtml$/.test(n)).map((c) => zip3.file(c).async('string')),
  )
).join('');
assert(/Second section/.test(body3), 'URL: article body preserved');
assert(!/Cookie policy|Sponsored|Subscribe/.test(body3), 'URL: Readability stripped boilerplate');
assert(
  names3.some((n) => /^OEBPS\/images\/.+\.png$/.test(n)),
  'URL: relative image was absolutised, proxied past CORS, and embedded',
);

// ---------------------------------------------------------------------------
// arXiv: id parsing (pure), then a LaTeXML paper end to end
// ---------------------------------------------------------------------------
for (const [input, expected] of [
  ['2410.01383', '2410.01383'],
  [' 2410.01383v2 ', '2410.01383v2'],
  ['arXiv:2410.01383', '2410.01383'],
  ['https://arxiv.org/abs/2410.01383', '2410.01383'],
  ['https://arxiv.org/pdf/2410.01383v1.pdf', '2410.01383v1'],
  ['arxiv.org/abs/hep-th/9901001', 'hep-th/9901001'],
  ['math.GT/0309136', 'math.GT/0309136'],
  ['https://doi.org/10.48550/arXiv.2410.01383', '2410.01383'],
  ['https://example.com/post', null],
  ['https://arxiv.org/list/cs.CL/recent', null],
  ['hello world', null],
]) {
  assert(parseArxivId(input) === expected, `arXiv id: ${JSON.stringify(input)} -> ${expected}`);
}
assert(
  arxivHtmlUrl('2410.01383') === 'https://arxiv.org/html/2410.01383',
  'arXiv id maps to its HTML URL',
);

await page.goto(BASE_URL, { waitUntil: 'networkidle' });
await page.getByRole('button', { name: 'HTML' }).click();
await page.getByRole('button', { name: 'URL', exact: true }).click();
await page.locator('.url-input').fill(`${BASE_URL}/fixture/paper.html`);
await page.getByRole('button', { name: 'Fetch' }).click();
await page.locator('.url-status.ok').waitFor({ timeout: 30000 });
await page.getByRole('button', { name: 'Bind the EPUB' }).click();
await page.getByText('Bound & ready to read.').waitFor({ timeout: 90000 });

const href4 = await page.locator('a.download-btn').getAttribute('href');
const b64d = await page.evaluate(async (url) => {
  const buf = new Uint8Array(await (await fetch(url)).arrayBuffer());
  let bin = '';
  for (let i = 0; i < buf.length; i++) bin += String.fromCharCode(buf[i]);
  return btoa(bin);
}, href4);
const zip4 = await JSZip.loadAsync(Uint8Array.from(atob(b64d), (c) => c.charCodeAt(0)));
const names4 = Object.keys(zip4.files);
const opf4 = await zip4.file('OEBPS/content.opf').async('string');
const chaps4 = names4.filter((n) => /chapter-\d+\.xhtml$/.test(n));
const body4 = (await Promise.all(chaps4.map((c) => zip4.file(c).async('string')))).join('');

assert(/A Small Paper About Nothing/.test(opf4), 'arXiv: title from the LaTeXML document title');
assert(
  /<dc:creator>Ada Lovelace, Alan Turing<\/dc:creator>/.test(opf4),
  'arXiv: byline reads both authors, without affiliation superscripts',
);
// The <base href> points a directory deeper than the page. Without honouring it
// the figure resolves to a path that this host answers with its index.html, so
// check the embedded bytes really are a PNG rather than trusting the count.
assert(!/md2k-missing/.test(body4), 'arXiv: no missing images (<base href> honoured)');
// Target the <figure>'s own image — the equations are PNGs under images/ too.
const figSrc = /<figure[^>]*>[\s\S]*?<img[^>]*src="(images\/[^"]+)"/.exec(body4)?.[1];
const figureBytes = figSrc
  ? await zip4.file(`OEBPS/${figSrc}`).async('uint8array')
  : new Uint8Array();
assert(
  [0x89, 0x50, 0x4e, 0x47].every((b, i) => figureBytes[i] === b),
  'arXiv: the figure was fetched and embedded as a real PNG',
);
assert(/A cat, for scale/.test(body4), 'arXiv: figure caption preserved');

// MathML must become images, and none of its annotation text may survive.
const prose4 = body4.replace(/alt="[^"]*"/g, '');
assert(!/<math/.test(prose4), 'arXiv: MathML replaced by rasterised equations');
assert(
  !/\\mathcal\{|start_POSTSUBSCRIPT|caligraphic_L/.test(prose4),
  'arXiv: no raw TeX or screen-reader text leaked into the prose',
);
assert(/md2k-eq-line/.test(body4), 'arXiv: display equation lifted out of its layout table');
assert(/\(1\)/.test(body4), 'arXiv: equation number kept');
assert(!/<table/.test(body4), 'arXiv: no equation layout tables remain');

// Section wrappers flattened, so headings reach the chapter splitter.
assert(chaps4.length >= 4, `arXiv: split into chapters (${chaps4.length})`);
const nav4 = await zip4.file('OEBPS/nav.xhtml').async('string');
for (const entry of ['Abstract', '1 Introduction', '2 The Equation', 'References']) {
  assert(nav4.includes(entry), `arXiv: "${entry}" in the table of contents`);
}
assert(/Notes on the Analytical Engine/.test(body4), 'arXiv: bibliography kept');
assert(
  !/Skip to main content|Generated by LaTeXML/.test(body4),
  'arXiv: page navbar and footer stripped',
);

// ---------------------------------------------------------------------------
// The title page fills itself in from the source (and respects your edits)
// ---------------------------------------------------------------------------
const titleField = () => page.locator('.field input').first();
const authorField = () => page.locator('.fields-row input').first();
const langField = () => page.locator('.fields-row input').nth(1);

await page.goto(BASE_URL, { waitUntil: 'networkidle' });
await page.getByRole('button', { name: 'HTML' }).click();
await page.getByRole('button', { name: 'URL', exact: true }).click();
await page.locator('.url-input').fill(`${BASE_URL}/fixture/paper.html`);
await page.getByRole('button', { name: 'Fetch' }).click();
await page.locator('.url-status.ok').waitFor({ timeout: 30000 });
await page.waitForTimeout(900);

assert(
  (await titleField().inputValue()) === 'A Small Paper About Nothing',
  'autofill: paper title lands in the title field',
);
assert(
  (await authorField().inputValue()) === 'Ada Lovelace, Alan Turing',
  'autofill: paper byline lands in the author field',
);
assert(
  (await page.locator('.er-title').textContent()) === 'A Small Paper About Nothing',
  'autofill: cover preview shows the real title, not the placeholder',
);

// An edited field must survive later peeks, and loading another source must
// replace only the values still untouched.
await titleField().fill('My Own Title');
await page.locator('.url-input').fill(`${BASE_URL}/fixture/post.html`);
await page.getByRole('button', { name: 'Fetch' }).click();
await page.locator('.url-status.ok').waitFor({ timeout: 30000 });
await page.waitForTimeout(900);
assert((await titleField().inputValue()) === 'My Own Title', 'autofill: never overwrites your edit');
assert(
  (await authorField().inputValue()) === 'E2E Bot',
  'autofill: an untouched field follows the new source',
);
// Readability derives a better title than <title>; pre-filling would override it.
await page.goto(BASE_URL, { waitUntil: 'networkidle' });
await page.getByRole('button', { name: 'HTML' }).click();
await page.getByRole('button', { name: /Load a sample blog page/ }).click();
await page.waitForTimeout(900);
assert(
  (await titleField().inputValue()) === '',
  'autofill: generic HTML title is left to Readability',
);

await page.goto(BASE_URL, { waitUntil: 'networkidle' });
await page.locator('textarea').fill('---\ntitle: Front Matter Wins\nauthor: A. Writer\nlanguage: fr\n---\n\n# Heading\n\nBody.');
await page.waitForTimeout(900);
assert((await titleField().inputValue()) === 'Front Matter Wins', 'autofill: Markdown front-matter title');
assert((await authorField().inputValue()) === 'A. Writer', 'autofill: Markdown front-matter author');
assert((await langField().inputValue()) === 'fr', 'autofill: Markdown front-matter language');

await page.locator('textarea').fill('# Just A Heading\n\nBody.');
await page.waitForTimeout(900);
assert(
  (await titleField().inputValue()) === 'Just A Heading',
  'autofill: falls back to the first heading',
);

await browser.close();
console.log(failures === 0 ? '\n✅ E2E PASSED' : `\n❌ E2E FAILED (${failures})`);
process.exit(failures === 0 ? 0 : 1);
