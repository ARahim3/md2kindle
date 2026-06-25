// An in-browser EPUB reader: it reads the .epub we just produced back (epubread)
// and paints it page-by-page in a sandboxed iframe styled with the book's own
// stylesheet — a faithful "read it here" preview, not a pixel Kindle clone.
//
// Pagination is the classic CSS multi-column slider: the content flows into
// viewport-wide columns and we translateX one viewport per "page turn".

import { useCallback, useEffect, useRef, useState } from 'react';
import type { ReadBook } from './lib/epubread';

type Palette = 'warm' | 'eink' | 'oldbook';
const PALETTES: { id: Palette; label: string }[] = [
  { id: 'warm', label: 'Warm' },
  { id: 'eink', label: 'E-ink' },
  { id: 'oldbook', label: 'Old book' },
];

const FS_MIN = 15;
const FS_MAX = 30;
const FS_KEY = 'md2k-reader-fs';

interface ReaderProps {
  epub: Blob;
  palette: Palette;
  onPalette: (p: Palette) => void;
  onClose: () => void;
}

interface Theme {
  paper: string;
  ink: string;
  accent: string;
}

function readTheme(): Theme {
  const cs = getComputedStyle(document.documentElement);
  return {
    paper: cs.getPropertyValue('--card').trim() || '#fff',
    ink: cs.getPropertyValue('--ink').trim() || '#222',
    accent: cs.getPropertyValue('--accent').trim() || '#bf4720',
  };
}

/** Margins (px) for the current screen size — the "page" gutters. */
function margins(w: number, h: number) {
  return {
    hM: Math.round(Math.min(70, Math.max(22, w * 0.082))),
    vM: Math.round(Math.min(54, Math.max(26, h * 0.055))),
  };
}

function buildDoc(css: string, bodyHTML: string, t: Theme): string {
  // The book's own stylesheet first, then reader overrides that set up paging.
  return `<!doctype html><html><head><meta charset="utf-8"/>
<link rel="preconnect" href="https://fonts.googleapis.com"/>
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin/>
<link href="https://fonts.googleapis.com/css2?family=Newsreader:ital,opsz,wght@0,6..72,400;0,6..72,500;0,6..72,600;1,6..72,400;1,6..72,500&display=swap" rel="stylesheet"/>
<style>${css}</style>
<style>
  html, body { margin: 0; padding: 0; height: 100%; overflow: hidden; background: ${t.paper}; color: ${t.ink}; -webkit-text-size-adjust: 100%; }
  body { font-family: 'Newsreader', Georgia, 'Times New Roman', serif; }
  a { color: ${t.accent}; }
  img, svg, table, pre { break-inside: avoid; }
  img { max-height: 82vh; }
  #md2k-page { box-sizing: border-box; transition: transform 0.28s cubic-bezier(0.2, 0.7, 0.2, 1); will-change: transform; }
  ::selection { background: ${t.accent}33; }
</style></head>
<body><div id="md2k-page">${bodyHTML}</div></body></html>`;
}

export default function Reader({ epub, palette, onPalette, onClose }: ReaderProps) {
  const [book, setBook] = useState<ReadBook | null>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [errMsg, setErrMsg] = useState('');
  const [chapter, setChapter] = useState(0);
  const [page, setPage] = useState(0);
  const [pages, setPages] = useState(1);
  const [tocOpen, setTocOpen] = useState(false);
  const [fontSize, setFontSize] = useState(() => {
    const v = Number(typeof localStorage !== 'undefined' && localStorage.getItem(FS_KEY));
    return v >= FS_MIN && v <= FS_MAX ? v : 20;
  });

  const frameRef = useRef<HTMLIFrameElement>(null);
  const seqRef = useRef(0); // guards against out-of-order async renders
  const landingRef = useRef<'start' | 'end'>('start');
  const pageRef = useRef(0);
  pageRef.current = page;

  // --- load the epub once ---
  useEffect(() => {
    let live = true;
    let loaded: ReadBook | null = null;
    setStatus('loading');
    import('./lib/epubread')
      .then(({ readEpub }) => readEpub(epub))
      .then((b) => {
        if (!live) {
          b.dispose();
          return;
        }
        loaded = b;
        setBook(b);
        setStatus(b.docs.length ? 'ready' : 'error');
        if (!b.docs.length) setErrMsg('This book has no readable pages.');
      })
      .catch((e) => {
        if (live) {
          setErrMsg((e as Error)?.message || 'Could not open this EPUB.');
          setStatus('error');
        }
      });
    return () => {
      live = false;
      loaded?.dispose();
    };
  }, [epub]);

  // Lay the current chapter into columns and count the pages.
  const relayout = useCallback(() => {
    const frame = frameRef.current;
    const doc = frame?.contentDocument;
    const host = doc?.getElementById('md2k-page');
    if (!frame || !doc || !host) return;
    const w = frame.clientWidth;
    const h = frame.clientHeight;
    if (!w || !h) return;
    const { hM, vM } = margins(w, h);
    doc.body.style.fontSize = `${fontSize}px`;
    host.style.width = `${w}px`;
    host.style.height = `${h}px`;
    host.style.padding = `${vM}px ${hM}px`;
    host.style.columnWidth = `${w - 2 * hM}px`;
    host.style.columnGap = `${2 * hM}px`;
    host.style.columnFill = 'auto';
    // With gap == 2*hM and side padding == hM, one page step is exactly one viewport.
    const count = Math.max(1, Math.round(host.scrollWidth / w));
    setPages(count);
    const clamped = Math.min(pageRef.current, count - 1);
    pageRef.current = clamped;
    setPage(clamped);
    host.style.transform = `translateX(-${clamped * w}px)`;
  }, [fontSize]);

  // Render a chapter into the iframe, then measure once images + fonts settle.
  const renderChapter = useCallback(
    async (idx: number) => {
      const frame = frameRef.current;
      if (!frame || !book) return;
      const seq = ++seqRef.current;
      const doc = frame.contentDocument;
      if (!doc) return;
      doc.open();
      doc.write(buildDoc(book.css, book.docs[idx].html, readTheme()));
      doc.close();

      // Click-through navigation for in-book + external links.
      doc.addEventListener('click', (e) => {
        const a = (e.target as Element)?.closest?.('a[href]') as HTMLAnchorElement | null;
        if (!a) return;
        const href = a.getAttribute('href') || '';
        if (/^https?:/i.test(href)) {
          e.preventDefault();
          window.open(href, '_blank', 'noopener,noreferrer');
        } else if (href.includes('.xhtml')) {
          e.preventDefault();
          const file = (href.split('#')[0].split('/').pop() || '').trim();
          const target = book.docs.findIndex((d) => d.file === file);
          if (target >= 0) {
            landingRef.current = 'start';
            setChapter(target);
          }
        }
      });

      const imgs = Array.from(doc.images);
      await Promise.all(
        imgs.map((im) =>
          im.complete
            ? null
            : new Promise((r) => {
                im.addEventListener('load', r, { once: true });
                im.addEventListener('error', r, { once: true });
              }),
        ),
      );
      try {
        await Promise.race([
          (doc as Document).fonts?.ready,
          new Promise((r) => setTimeout(r, 1200)),
        ]);
      } catch {
        /* fonts API absent — measure anyway */
      }
      if (seq !== seqRef.current) return; // a newer render superseded us

      // Land on the first or last page depending on travel direction.
      pageRef.current = 0;
      relayout();
      if (landingRef.current === 'end') {
        const host = doc.getElementById('md2k-page');
        const w = frame.clientWidth;
        if (host && w) {
          const last = Math.max(0, Math.round(host.scrollWidth / w) - 1);
          pageRef.current = last;
          setPage(last);
          host.style.transform = `translateX(-${last * w}px)`;
        }
      }
    },
    [book, relayout],
  );

  // (Re)render whenever the chapter changes or the book first loads.
  useEffect(() => {
    if (status === 'ready') renderChapter(chapter);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, chapter, renderChapter]);

  // Font size: persist + reflow in place.
  useEffect(() => {
    try {
      localStorage.setItem(FS_KEY, String(fontSize));
    } catch {
      /* ignore */
    }
    if (status === 'ready') relayout();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fontSize]);

  // Live theme swap (no reflow needed — colours don't affect layout).
  useEffect(() => {
    const doc = frameRef.current?.contentDocument;
    if (!doc?.body) return;
    const t = readTheme();
    doc.documentElement.style.background = t.paper;
    doc.body.style.background = t.paper;
    doc.body.style.color = t.ink;
  }, [palette]);

  // Reflow on resize.
  useEffect(() => {
    let raf = 0;
    const onResize = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => status === 'ready' && relayout());
    };
    window.addEventListener('resize', onResize);
    return () => {
      window.removeEventListener('resize', onResize);
      cancelAnimationFrame(raf);
    };
  }, [status, relayout]);

  const applyPage = useCallback((p: number) => {
    const frame = frameRef.current;
    const host = frame?.contentDocument?.getElementById('md2k-page');
    if (!frame || !host) return;
    host.style.transform = `translateX(-${p * frame.clientWidth}px)`;
  }, []);

  const turn = useCallback(
    (dir: 1 | -1) => {
      if (!book) return;
      const next = page + dir;
      if (next >= 0 && next < pages) {
        pageRef.current = next;
        setPage(next);
        applyPage(next);
      } else if (dir === 1 && chapter < book.docs.length - 1) {
        landingRef.current = 'start';
        setChapter(chapter + 1);
      } else if (dir === -1 && chapter > 0) {
        landingRef.current = 'end';
        setChapter(chapter - 1);
      }
    },
    [book, page, pages, chapter, applyPage],
  );

  const jumpTo = useCallback((idx: number) => {
    landingRef.current = 'start';
    setTocOpen(false);
    setChapter(idx);
  }, []);

  // Keyboard: arrows / space / Esc.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        tocOpen ? setTocOpen(false) : onClose();
      } else if (e.key === 'ArrowRight' || e.key === ' ' || e.key === 'PageDown') {
        e.preventDefault();
        turn(1);
      } else if (e.key === 'ArrowLeft' || e.key === 'PageUp') {
        e.preventDefault();
        turn(-1);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [turn, onClose, tocOpen]);

  const adjustFont = (d: number) =>
    setFontSize((f) => Math.min(FS_MAX, Math.max(FS_MIN, f + d)));

  const totalDocs = book?.docs.length ?? 1;
  // Each chapter is one slice of the book; refine within the chapter by page so
  // the last page of the last chapter (and only then) reads 100%.
  const within = pages > 1 ? page / (pages - 1) : 0;
  const overall = Math.min(100, Math.round(((chapter + within) / totalDocs) * 100));
  const here = book?.docs[chapter];

  return (
    <div className="reader" role="dialog" aria-label="EPUB reader">
      <div className="reader-bar">
        <button className="rd-btn back" onClick={onClose}>
          ← Back
        </button>
        <div className="rd-title" title={book?.title}>
          {book?.title || 'Reading…'}
        </div>
        <div className="rd-tools">
          <div className="rd-palette">
            {PALETTES.map((p) => (
              <button
                key={p.id}
                className={palette === p.id ? 'active' : ''}
                onClick={() => onPalette(p.id)}
                title={`${p.label} palette`}
                aria-label={`${p.label} palette`}
              >
                {p.label[0]}
              </button>
            ))}
          </div>
          <div className="rd-font">
            <button onClick={() => adjustFont(-1)} disabled={fontSize <= FS_MIN} aria-label="Smaller text">
              A−
            </button>
            <button onClick={() => adjustFont(1)} disabled={fontSize >= FS_MAX} aria-label="Larger text">
              A+
            </button>
          </div>
          <button
            className={`rd-btn ${tocOpen ? 'active' : ''}`}
            onClick={() => setTocOpen((v) => !v)}
            disabled={status !== 'ready'}
          >
            ☰ Contents
          </button>
        </div>
      </div>

      <div className="reader-stage">
        <div className="device">
          <div className="device-screen">
            {status !== 'error' && <iframe ref={frameRef} className="reader-frame" title="Book page" />}

            {status === 'loading' && (
              <div className="reader-overlay">
                <span className="reader-spin" />
                <p>Opening the book…</p>
              </div>
            )}
            {status === 'error' && (
              <div className="reader-overlay">
                <p className="reader-err">{errMsg}</p>
                <button className="rd-btn" onClick={onClose}>
                  ← Back
                </button>
              </div>
            )}

            {status === 'ready' && (
              <>
                <button
                  className="nav-zone left"
                  onClick={() => turn(-1)}
                  aria-label="Previous page"
                  disabled={chapter === 0 && page === 0}
                >
                  <span className="chev">‹</span>
                </button>
                <button
                  className="nav-zone right"
                  onClick={() => turn(1)}
                  aria-label="Next page"
                  disabled={chapter === totalDocs - 1 && page === pages - 1}
                >
                  <span className="chev">›</span>
                </button>
              </>
            )}

            {tocOpen && book && (
              <div className="toc" onClick={() => setTocOpen(false)}>
                <div className="toc-panel" onClick={(e) => e.stopPropagation()}>
                  <div className="toc-head">Contents</div>
                  <ol>
                    {book.docs.map((d, i) => (
                      <li key={d.id}>
                        <button className={i === chapter ? 'active' : ''} onClick={() => jumpTo(i)}>
                          <span className="toc-n">{d.isCover ? '✦' : i + (book.docs[0]?.isCover ? 0 : 1)}</span>
                          <span className="toc-t">{d.title}</span>
                        </button>
                      </li>
                    ))}
                  </ol>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="reader-foot">
        <div className="rf-progress">
          <div className="rf-bar">
            <div className="rf-fill" style={{ width: `${overall}%` }} />
          </div>
        </div>
        <div className="rf-meta">
          <span className="rf-ch">{here?.title}</span>
          <span className="rf-pg">
            {status === 'ready' ? `page ${page + 1} / ${pages} · ${overall}%` : ''}
          </span>
        </div>
      </div>
    </div>
  );
}
