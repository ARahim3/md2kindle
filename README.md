# md2kindle

**Turn Markdown or HTML into a clean, Kindle-ready EPUB — entirely in your browser.**
Diagrams, equations and images included. Nothing is ever uploaded.

## Why this exists

A lot of what's worth reading now begins life as a Markdown or HTML file. You ask
an AI to explain a topic, draft a guide, or walk you through a paper, and what comes
back is genuinely good — but it's stuck in a chat window or a `.md` on your laptop,
in front of the same bright screen you've been staring at all day.

If you love reading on a Kindle — the matte e-ink, no notifications, the way a long
piece finally settles down and feels like a *book* — there's no tidy way to get that
text onto the device. So you end up emailing yourself a wall of plain text, or
fighting a converter that mangles the diagrams and equations.

md2kindle is for exactly that moment. Hand it the Markdown (or a link, or the raw
HTML) and it gives back a clean EPUB — images, diagrams and math intact — ready to
send to your Kindle and read the way you'd read a book.

> **Why EPUB only?** Amazon's *Send to Kindle* stopped accepting MOBI on
> 18 March 2025. Modern Kindles take a DRM-free EPUB and convert it on-device.
> EPUB is also the only format that can be produced 100% client-side — which is
> what keeps your documents private.

---

## Features

- **100% on-device.** All conversion runs in your browser. Your text and images
  never leave the tab — no server, no upload.
- **Markdown *or* HTML.** Upload or paste either. For HTML, an optional
  [Readability](https://github.com/mozilla/readability) pass strips nav, ads and
  footers down to just the article (great for saved blog posts).
- **Import a blog by URL.** Paste a link; the page (and its images) are fetched,
  cleaned with Readability, and bound. See [URL fetching](#url-fetching) for how
  this works across hosts.
- **Images, kept intact** — embedded (`data:`) images, remote URLs, and local
  files supplied alongside the Markdown.
- **Mermaid diagrams** — \`\`\`mermaid code blocks are rendered and embedded as
  crisp images.
- **Math** — `$inline$`, `$$display$$`, and `\(...\)` / `\[...\]`, typeset with
  MathJax. Equations are sized in `em` so they scale with the reader's font.
- **Raw SVG** — inline `<svg>` figures are rasterised and embedded too.
- **Reader-friendly defaults** — a clean reading stylesheet: hyphenation off so
  words don't break mid-line, and code wraps instead of running off the screen.
- **Real chapters & table of contents** — auto-split on headings (configurable),
  with a navigable EPUB TOC and an NCX fallback.
- **Auto cover** — a clean typographic cover is generated for you (or upload your
  own).
- **Front matter aware** — `title`, `author`, `language` are read from YAML front
  matter when present.

## Bringing in your content

Pick a format (**Markdown** or **HTML**), then one of four ways to supply it:

| Mode | Use it for |
|------|------------|
| **Paste** | Quick notes, or a copied HTML page. |
| **URL** | Fetch a web page (or raw file) by link — images and all. |
| **Single file** | One `.md` or `.html`. |
| **File + images** | Pick the document together with its image files (matched by name). |
| **Folder** | Drop a whole folder; relative image paths (`images/fig.png`) resolve automatically. |

### URL fetching

Browsers block cross-origin `fetch()` (CORS), so importing an arbitrary URL
needs a tiny server-side helper that fetches the page (and proxies its images).
That helper ships with the app and the client feature-detects it, giving three
tiers:

| Host | URL import |
|------|-----------|
| **Local** (`npm run dev` / `npm run preview`) | **Full** — built into the dev/preview server. |
| **Vercel** | **Full** — the included `api/fetch.ts` Edge function. |
| **GitHub Pages** (static) | **Limited** — direct browser fetch only, so just CORS-enabled sites. Everything else still works. |

Upload & paste are always 100% on-device. The URL helper only ever sees the
public link you give it; the public Vercel function additionally refuses
private/loopback hosts (basic SSRF guard).

## Getting the book onto your Kindle

1. Convert and download the `.epub`.
2. Email it to your personal **`@kindle.com`** address, or use the **Send to
   Kindle** app / web page. Amazon converts it for your device automatically.

---

## Development

```bash
npm install
npm run dev        # start the dev server
npm run build      # type-check + production build to dist/
npm run preview    # preview the production build on :4173
```

### Tests

```bash
npm run test:deps  # smoke-test external dependency contracts (Node)

# End-to-end (drives a real browser, generates an EPUB, validates it):
npm run build && npm run preview &   # serve the build on :4173
npm run test:e2e                     # requires: npx playwright install chromium
```

## Tech

[markdown-it](https://github.com/markdown-it/markdown-it) ·
[mermaid](https://mermaid.js.org/) ·
[MathJax](https://www.mathjax.org/) ·
[DOMPurify](https://github.com/cure53/DOMPurify) ·
[JSZip](https://stuk.github.io/jszip/) · React + Vite + TypeScript.

The heavy conversion engine (MathJax, mermaid, JSZip) is lazy-loaded on first
use, so the page itself loads fast. Because mermaid and canvas rasterisation need
the DOM, conversion runs on the main thread with progress reporting between
stages.

## How it works

```
Markdown
  └─ front matter → title / author / language
  └─ markdown-it (+ footnotes, task lists, math plugin) → HTML
       └─ DOMPurify → safe DOM
            ├─ resolve <img> (data: / remote / local files) → embed
            ├─ raw <svg>           → rasterise → PNG
            ├─ mermaid code blocks → render → PNG
            └─ $math$ / $$math$$   → MathJax → SVG → PNG
       └─ split into chapters + rewrite in-document anchors
       └─ assemble EPUB 3 (JSZip): OPF · nav.xhtml · NCX · stylesheet · images
EPUB ⬇
```

## Deploy

- **GitHub Pages** — push to `main`; the included workflow
  (`.github/workflows/deploy.yml`) builds and publishes automatically. Enable
  Pages → "GitHub Actions" in the repo settings. `vite.config.ts` uses
  `base: './'`, so it works from a project sub-path.
- **Vercel** — import the repo; the Vite preset works out of the box (build
  command `npm run build`, output `dist`).

## Notes & limits

- Remote images require permissive CORS to be fetched from the browser.
- Math and diagrams are embedded as raster PNGs (rendered at 2× for sharpness on
  300 ppi screens) so they look identical on every Kindle generation.
- The output targets EPUB 3 with an NCX fallback; it was validated for structure
  and XHTML well-formedness, but not run through `epubcheck` here (no JRE in the
  build environment).

## License

MIT
