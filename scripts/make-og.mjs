// Generates the 1200x630 social-share card.
//   node scripts/make-og.mjs                 -> warm  -> public/og-image.png
//   node scripts/make-og.mjs eink            -> e-ink -> public/og-image.png
//   node scripts/make-og.mjs eink /tmp/x.png -> e-ink -> custom path
import { chromium } from 'playwright';

const PALETTES = {
  warm: { paper: '#efe7db', paper2: '#e6dccb', card: '#f6f1e8', ink: '#221c16', soft: '#6f6456', line: '#d8ccb8', lineStrong: '#c8b89e', accent: '#bf4720', accentDeep: '#97330a' },
  eink: { paper: '#f1f0ea', paper2: '#e6e5dd', card: '#fbfaf6', ink: '#23231f', soft: '#6c6c63', line: '#d5d4ca', lineStrong: '#c6c5bb', accent: '#35352d', accentDeep: '#1f1f1b' },
  oldbook: { paper: '#e9e0cd', paper2: '#ded2ba', card: '#f1ead6', ink: '#2a2419', soft: '#6f6147', line: '#ccbe9f', lineStrong: '#bcae8f', accent: '#2c4858', accentDeep: '#1f3340' },
};

const paletteName = process.argv[2] || 'warm';
const outPath = process.argv[3] || new URL('../public/og-image.png', import.meta.url).pathname;
const P = PALETTES[paletteName];
if (!P) throw new Error(`Unknown palette: ${paletteName}`);

const PM = (pos) => {
  const c = `2px solid ${P.lineStrong}`;
  const m = { tl: `top:26px;left:26px;border-top:${c};border-left:${c}`, tr: `top:26px;right:26px;border-top:${c};border-right:${c}`, bl: `bottom:26px;left:26px;border-bottom:${c};border-left:${c}`, br: `bottom:26px;right:26px;border-bottom:${c};border-right:${c}` }[pos];
  return `<span style="position:absolute;width:18px;height:18px;${m}"></span>`;
};

const html = `<!doctype html><html><head><meta charset="utf-8">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Newsreader:ital,opsz,wght@0,6..72,600;1,6..72,600&family=IBM+Plex+Mono:wght@500;600&display=swap" rel="stylesheet">
<style>*{box-sizing:border-box;margin:0;padding:0}</style></head>
<body>
<div class="card" style="position:relative;width:1200px;height:630px;overflow:hidden;display:flex;align-items:center;justify-content:space-between;gap:56px;padding:72px 80px;font-family:Newsreader,Georgia,serif;background:radial-gradient(125% 75% at 50% -8%,${P.card} 0%,${P.paper} 52%,${P.paper2} 100%);">
  ${PM('tl')}${PM('tr')}${PM('bl')}${PM('br')}

  <div style="position:relative;max-width:660px;">
    <div style="font-family:'IBM Plex Mono',monospace;font-size:18px;font-weight:600;letter-spacing:0.32em;text-transform:uppercase;color:${P.accent};margin-bottom:26px;">Markdown · HTML → Kindle EPUB</div>

    <div style="display:flex;align-items:baseline;line-height:0.9;margin-bottom:24px;">
      <span style="font-family:'IBM Plex Mono',monospace;font-weight:600;font-size:96px;letter-spacing:-0.05em;color:${P.ink};">md</span>
      <span style="font-style:italic;font-weight:600;font-size:130px;color:${P.accent};margin:0 4px;">2</span>
      <span style="font-weight:600;font-size:130px;letter-spacing:-0.015em;color:${P.ink};">kindle</span>
    </div>

    <div style="display:flex;align-items:center;gap:16px;margin-bottom:26px;">
      <span style="width:54px;height:2px;background:${P.accent};"></span>
      <span style="font-style:italic;font-size:25px;color:${P.soft};">An on-device press</span>
    </div>

    <p style="font-size:30px;line-height:1.5;color:${P.ink};">Turn your Markdown or HTML — diagrams, equations and images and all — into a clean, Kindle-ready EPUB. Right in your browser; nothing is ever uploaded.</p>

    <div style="margin-top:30px;font-family:'IBM Plex Mono',monospace;font-size:19px;font-weight:600;color:${P.accentDeep};">md2kindle.vercel.app</div>
  </div>

  <div style="position:relative;flex:none;width:264px;height:372px;border-radius:24px;background:linear-gradient(160deg,${P.paper2},${P.paper});border:1px solid ${P.line};padding:16px;box-shadow:0 34px 56px -30px rgba(40,30,18,0.55),0 1px 0 rgba(255,255,255,0.5) inset;">
    <div style="height:100%;border-radius:9px;background:${P.card};border:1px solid ${P.line};display:flex;flex-direction:column;padding:28px 24px;">
      <span style="width:44px;height:4px;border-radius:3px;background:${P.accent};margin-bottom:auto;"></span>
      <div style="font-weight:600;font-size:28px;line-height:1.14;color:${P.ink};margin-bottom:13px;">The Aurora Notebook</div>
      <div style="font-family:'IBM Plex Mono',monospace;font-size:13px;letter-spacing:0.12em;text-transform:uppercase;color:${P.soft};margin-bottom:22px;">A. Curious Mind</div>
      <div style="display:flex;flex-direction:column;gap:9px;">
        <span style="height:3px;width:100%;background:${P.line};border-radius:3px;"></span>
        <span style="height:3px;width:82%;background:${P.line};border-radius:3px;"></span>
        <span style="height:3px;width:92%;background:${P.line};border-radius:3px;"></span>
        <span style="height:3px;width:68%;background:${P.line};border-radius:3px;"></span>
      </div>
    </div>
  </div>
</div>
</body></html>`;

const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 1260, height: 720 }, deviceScaleFactor: 1 });
await p.setContent(html, { waitUntil: 'networkidle' });
await p.evaluate(() => document.fonts.ready);
await p.waitForTimeout(400);
await p.locator('.card').screenshot({ path: outPath });
await b.close();
console.log(`wrote ${outPath} (${paletteName})`);
