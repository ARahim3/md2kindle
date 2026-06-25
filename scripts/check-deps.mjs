// Smoke-test the external dependency contracts the engine relies on.
import { mathjax } from 'mathjax-full/js/mathjax.js';
import { TeX } from 'mathjax-full/js/input/tex.js';
import { SVG } from 'mathjax-full/js/output/svg.js';
import { liteAdaptor } from 'mathjax-full/js/adaptors/liteAdaptor.js';
import { RegisterHTMLHandler } from 'mathjax-full/js/handlers/html.js';
import { AllPackages } from 'mathjax-full/js/input/tex/AllPackages.js';
import MarkdownIt from 'markdown-it';
import footnote from 'markdown-it-footnote';
import taskLists from 'markdown-it-task-lists';
import JSZip from 'jszip';

let ok = true;
const assert = (cond, msg) => {
  console.log(`${cond ? '✓' : '✗'} ${msg}`);
  if (!cond) ok = false;
};

// --- MathJax (the lite-adaptor API used by src/lib/math.ts) ---
const adaptor = liteAdaptor();
RegisterHTMLHandler(adaptor);
const doc = mathjax.document('', {
  InputJax: new TeX({ packages: AllPackages }),
  OutputJax: new SVG({ fontCache: 'local' }),
});
const container = doc.convert('e^{i\\pi}+1=0', { display: false });
const svgNode = adaptor.firstChild(container);
const width = adaptor.getAttribute(svgNode, 'width');
const height = adaptor.getAttribute(svgNode, 'height');
const style = adaptor.getAttribute(svgNode, 'style');
const html = adaptor.outerHTML(svgNode);
assert(/[\d.]+ex/.test(width || ''), `MathJax width in ex: ${width}`);
assert(/[\d.]+ex/.test(height || ''), `MathJax height in ex: ${height}`);
assert(/vertical-align:\s*[-\d.]+ex/.test(style || ''), `MathJax vertical-align: ${style}`);
assert(html.startsWith('<svg'), `MathJax returns <svg> string (${html.slice(0, 30)}…)`);

// --- markdown-it + plugins ---
const md = new MarkdownIt({ html: true, typographer: true });
md.use(footnote);
md.use(taskLists, { label: true });
const out = md.render('# Hi\n\n- [x] done\n\nText[^1]\n\n[^1]: a note\n');
assert(out.includes('<h1'), 'markdown-it renders headings');
assert(/type="checkbox"/.test(out), 'task-lists plugin works');
assert(/footnote/.test(out), 'footnote plugin works');

// --- JSZip mimetype ordering ---
const zip = new JSZip();
zip.file('mimetype', 'application/epub+zip', { compression: 'STORE' });
zip.file('OEBPS/x.txt', 'hi');
const u8 = await zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' });
// "mimetype" must be the first entry name in the central/local header region.
const head = new TextDecoder().decode(u8.slice(0, 40));
assert(head.includes('mimetype'), 'JSZip writes mimetype first');
assert(head.includes('application/epub+zip'), 'mimetype stored uncompressed (readable in header)');

console.log(ok ? '\nALL DEPENDENCY CHECKS PASSED' : '\nSOME CHECKS FAILED');
process.exit(ok ? 0 : 1);
