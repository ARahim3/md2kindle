// End-to-end test: drive the built app in a real browser, generate an EPUB from
// the bundled sample (math + mermaid + raw SVG + table), then validate the
// resulting package structure and the well-formedness of every XHTML file.
import { chromium } from 'playwright';
import JSZip from 'jszip';

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

await browser.close();
console.log(failures === 0 ? '\n✅ E2E PASSED' : `\n❌ E2E FAILED (${failures})`);
process.exit(failures === 0 ? 0 : 1);
