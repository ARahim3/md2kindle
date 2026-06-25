// A self-contained demo document (no external images) that exercises
// front matter, math (all delimiter styles), a mermaid diagram, a raw inline
// SVG, a GFM table, a task list, code, and a blockquote.

export const SAMPLE_MD = `---
title: The Aurora Notebook
author: A. Curious Mind
language: en
---

# The Aurora Notebook

A short demonstration of **md2kindle** — Markdown to a Kindle-ready EPUB,
entirely in your browser. Nothing here is uploaded anywhere.

## Why on-device?

Your text never leaves this tab. Conversion runs locally, so private drafts
stay private. The output also disables hyphenation, so your reading flow on
Kindle stays smooth — no stray hyphenated words.

> "The best tool is the one that respects your data." — *someone sensible*

## A little mathematics

Inline math like $e^{i\\pi} + 1 = 0$ sits naturally in a sentence. Display math
is centered on its own line:

$$
\\int_{-\\infty}^{\\infty} e^{-x^2}\\,dx = \\sqrt{\\pi}
$$

You can also use the bracket form: \\( a^2 + b^2 = c^2 \\).

## A diagram

\`\`\`mermaid
flowchart LR
  A[Markdown] --> B{md2kindle}
  B --> C[EPUB]
  C --> D[(Kindle)]
\`\`\`

## A small figure

<svg xmlns="http://www.w3.org/2000/svg" width="260" height="120" viewBox="0 0 260 120" aria-label="badge">
  <rect width="260" height="120" rx="8" fill="#efe7d8"/>
  <circle cx="64" cy="60" r="34" fill="#c1440e"/>
  <text x="120" y="66" font-size="18" fill="#1c1a17">SVG &#8594; PNG</text>
</svg>

## A table &amp; a checklist

| Feature    | Status |
|------------|:------:|
| Diagrams   |   ✓    |
| Equations  |   ✓    |
| No hyphens |   ✓    |

- [x] Render Markdown
- [x] Embed images & diagrams
- [ ] Read it on the beach

---

Built with care. Enjoy the reading flow.
`;

// A full "blog page" with the usual boilerplate (nav, sidebar, footer) so the
// Readability cleanup has something to strip down to just the article.
export const SAMPLE_HTML = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8"/>
  <title>On Quiet Software — The Marginalia</title>
  <meta name="author" content="J. Reader"/>
</head>
<body>
  <header class="site-header">
    <nav><a href="/">Home</a> · <a href="/archive">Archive</a> · <a href="/about">About</a></nav>
  </header>
  <aside class="sidebar">
    <h3>Newsletter</h3>
    <p>Subscribe for weekly updates! Buy our course! Follow us everywhere!</p>
  </aside>
  <main>
    <article>
      <h1>On Quiet Software</h1>
      <p class="byline">By J. Reader · 6 min read</p>
      <p>The best tools disappear. They do their job and then get out of the way,
      leaving you alone with your work. This is a short note on building software
      that respects attention.</p>
      <h2>Respecting the reader</h2>
      <p>A reader's attention is borrowed, never owned. Every notification,
      interstitial, and autoplay is a small withdrawal from a finite account.</p>
      <blockquote>"Perfection is achieved not when there is nothing more to add,
      but when there is nothing left to take away."</blockquote>
      <h2>Doing one thing</h2>
      <p>Software that converts one format to another, with care, is quietly
      useful. It asks little and returns much.</p>
    </article>
  </main>
  <footer class="site-footer">
    <p>© The Marginalia. All rights reserved. Cookie policy · Privacy · Terms.</p>
  </footer>
</body>
</html>`;
