import { useCallback, useEffect, useRef, useState } from 'react';
import {
  droppedToSupplied,
  pickedToSupplied,
  isMarkdownName,
  isHtmlName,
  isImageName,
} from './lib/fileio';
import type {
  InputMode,
  SourceKind,
  ChapterSplit,
  SuppliedFile,
  ConvertResult,
  ProgressUpdate,
} from './lib/types';
import { SAMPLE_MD, SAMPLE_HTML } from './sample';

interface SrcDoc {
  name: string;
  text: string;
}

type Palette = 'warm' | 'eink' | 'oldbook';

const PALETTES: { id: Palette; label: string }[] = [
  { id: 'warm', label: 'Warm' },
  { id: 'eink', label: 'E-ink' },
  { id: 'oldbook', label: 'Old book' },
];

const FORMATS: { id: SourceKind; label: string }[] = [
  { id: 'markdown', label: 'Markdown' },
  { id: 'html', label: 'HTML' },
];

const MODES: { id: InputMode; label: string; hint: string }[] = [
  { id: 'paste', label: 'Paste', hint: 'Paste your text straight in — best for quick documents.' },
  { id: 'url', label: 'URL', hint: 'Fetch a web page (or raw file) by link, images and all.' },
  { id: 'file', label: 'Single file', hint: 'Choose one document file from your device.' },
  { id: 'files', label: 'File + images', hint: 'Pick the document with its image files (matched by name).' },
  { id: 'folder', label: 'Folder', hint: 'Drop a whole folder; relative image paths resolve automatically.' },
];

const SPLIT_LABELS: Record<ChapterSplit, string> = {
  auto: 'Automatic (recommended)',
  h1: 'Split on every Heading 1',
  h2: 'Split on every Heading 2',
  none: 'Single flowing document',
};

const COVER_NOTES: Record<'auto' | 'upload' | 'none', string> = {
  auto: 'A typeset cover is generated from your title and author — in the press style of this page.',
  upload: 'Use your own JPG or PNG. It is embedded straight into the EPUB.',
  none: 'Ship without a cover. Your Kindle library will show a plain spine.',
};

const REPO_URL = 'https://github.com/ARahim3/md2kindle';

function GitHubMark() {
  return (
    <svg viewBox="0 0 16 16" width="18" height="18" fill="currentColor" aria-hidden="true">
      <path d="M8 0C3.58 0 0 3.58 0 8a8 8 0 0 0 5.47 7.59c.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82a7.65 7.65 0 0 1 2-.27c.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8 8 0 0 0 16 8c0-4.42-3.58-8-8-8z" />
    </svg>
  );
}

function ProofMarks() {
  return (
    <>
      {(['tl', 'tr', 'bl', 'br'] as const).map((c) => (
        <span key={c} className={`pm ${c}`} />
      ))}
    </>
  );
}

export default function App() {
  const [palette, setPalette] = useState<Palette>(
    () => (typeof localStorage !== 'undefined' && (localStorage.getItem('md2k-palette') as Palette)) || 'eink',
  );
  const [format, setFormat] = useState<SourceKind>('markdown');
  const [readability, setReadability] = useState(true);
  const [mode, setMode] = useState<InputMode>('paste');
  const [pasteText, setPasteText] = useState('');
  const [docs, setDocs] = useState<SrcDoc[]>([]);
  const [docIndex, setDocIndex] = useState(0);
  const [images, setImages] = useState<SuppliedFile[]>([]);
  const [drag, setDrag] = useState(false);

  const [url, setUrl] = useState('');
  const [fetchedContent, setFetchedContent] = useState('');
  const [urlStatus, setUrlStatus] = useState<'idle' | 'loading' | 'ok' | 'error'>('idle');
  const [urlError, setUrlError] = useState<string | null>(null);
  const [proxy, setProxy] = useState<boolean | null>(null);

  const [title, setTitle] = useState('');
  const [author, setAuthor] = useState('');
  const [language, setLanguage] = useState('en');
  const [chapterSplit, setChapterSplit] = useState<ChapterSplit>('auto');
  const [coverMode, setCoverMode] = useState<'auto' | 'upload' | 'none'>('auto');
  const [coverFile, setCoverFile] = useState<File | null>(null);

  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<ProgressUpdate | null>(null);
  const [result, setResult] = useState<ConvertResult | null>(null);
  const [downloadUrl, setDownloadUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const dirInputRef = useRef<HTMLInputElement>(null);

  const content =
    mode === 'paste' ? pasteText : mode === 'url' ? fetchedContent : docs[docIndex]?.text ?? '';
  const canConvert = content.trim().length > 0 && !busy;
  const activeMode = MODES.find((m) => m.id === mode)!;

  const plain = format === 'html' ? content.replace(/<[^>]+>/g, ' ') : content;
  const words = plain.trim() ? plain.trim().split(/\s+/).length : 0;
  const pages = Math.max(1, Math.ceil(words / 300));
  const minutes = Math.max(1, Math.ceil(words / 220));

  useEffect(() => {
    document.documentElement.dataset.palette = palette;
    try {
      localStorage.setItem('md2k-palette', palette);
    } catch {
      /* ignore */
    }
  }, [palette]);

  useEffect(() => {
    let live = true;
    import('./lib/net').then(({ hasProxy }) => hasProxy().then((ok) => live && setProxy(ok)));
    return () => {
      live = false;
    };
  }, []);

  const ingest = useCallback(
    async (supplied: SuppliedFile[]) => {
      const isDoc = format === 'html' ? isHtmlName : isMarkdownName;
      const docFiles = supplied.filter((f) => isDoc(f.name));
      const imgs = supplied.filter((f) => isImageName(f.name));
      const loaded = await Promise.all(
        docFiles.map(async (m) => ({ name: m.name, text: await m.blob.text() })),
      );
      setDocs(loaded);
      setDocIndex(0);
      setImages(imgs);
      setResult(null);
      if (loaded.length && !title) setTitle(loaded[0].name.replace(/\.[^.]+$/, ''));
    },
    [format, title],
  );

  const onDrop = useCallback(
    async (e: React.DragEvent) => {
      e.preventDefault();
      setDrag(false);
      await ingest(await droppedToSupplied(e.dataTransfer));
    },
    [ingest],
  );

  const onPick = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      if (e.target.files) await ingest(pickedToSupplied(e.target.files));
    },
    [ingest],
  );

  const fetchUrl = useCallback(async () => {
    if (!url.trim()) return;
    setUrlStatus('loading');
    setUrlError(null);
    setResult(null);
    try {
      const { fetchSource } = await import('./lib/urlsource');
      const text = await fetchSource(url.trim(), format);
      setFetchedContent(text);
      setUrlStatus('ok');
    } catch (err) {
      setUrlError((err as Error).message || 'Could not fetch that URL.');
      setUrlStatus('error');
    }
  }, [url, format]);

  const run = useCallback(async () => {
    setBusy(true);
    setError(null);
    setResult(null);
    if (downloadUrl) {
      URL.revokeObjectURL(downloadUrl);
      setDownloadUrl(null);
    }
    try {
      const { convert } = await import('./lib/convert');
      const res = await convert(
        {
          kind: format,
          content,
          readability,
          files: mode === 'paste' || mode === 'url' ? [] : images,
          title,
          author,
          language,
          chapterSplit,
          cover: { mode: coverMode, image: coverFile, accent: '#bf4720' },
        },
        setProgress,
      );
      setResult(res);
      setDownloadUrl(URL.createObjectURL(res.epub));
    } catch (err) {
      setError((err as Error).message || 'Conversion failed.');
    } finally {
      setBusy(false);
      setProgress(null);
    }
  }, [format, content, readability, images, mode, title, author, language, chapterSplit, coverMode, coverFile, downloadUrl]);

  const dirProps = mode === 'folder' ? ({ webkitdirectory: '', directory: '' } as any) : {};
  const switchFormat = (id: SourceKind) => {
    setFormat(id);
    setDocs([]);
    setImages([]);
    setFetchedContent('');
    setUrlStatus('idle');
    setResult(null);
  };

  return (
    <div className="wrap">
      <div className="topbar">
        <a
          className="gh-link"
          href={REPO_URL}
          target="_blank"
          rel="noopener noreferrer"
          aria-label="View source on GitHub"
          title="View source on GitHub"
        >
          <GitHubMark />
        </a>
        <div className="palette-switch">
          {PALETTES.map((p) => (
            <button
              key={p.id}
              className={palette === p.id ? 'active' : ''}
              onClick={() => setPalette(p.id)}
            >
              {p.label}
            </button>
          ))}
        </div>
      </div>

      <header className="masthead">
        <p className="masthead-kicker">Markdown, bound for the page</p>
        <div className="wordmark">
          <span className="wm-md">md</span>
          <span className="wm-2">2</span>
          <span className="wm-kindle">kindle</span>
        </div>
        <div className="rule">
          <span>An on-device press</span>
        </div>
        <p className="masthead-sub">
          Turn your Markdown or HTML — diagrams, equations, images and all — into a clean,
          Kindle-ready EPUB. Hyphenation is switched off for you, so the reading flow stays smooth.
        </p>
        <div className="seal">
          <span className="dot" />
          <b>100% ON YOUR DEVICE</b>
          <span style={{ opacity: 0.55 }}>·</span>
          <span>NOTHING IS EVER UPLOADED</span>
        </div>
      </header>

      <main className="steps">
        {/* I — Source */}
        <section className="step">
          <ProofMarks />
          <div className="step-head">
            <div className="step-head-l">
              <span className="step-num">I.</span>
              <h2 className="step-title">Your manuscript</h2>
            </div>
            <span className="step-hint">{activeMode.hint}</span>
          </div>

          <div className="source-controls">
            <div className="seg">
              {FORMATS.map((f) => (
                <button
                  key={f.id}
                  className={format === f.id ? 'active' : ''}
                  onClick={() => switchFormat(f.id)}
                >
                  {f.label}
                </button>
              ))}
            </div>
            {format === 'html' && (
              <label className="readability-toggle">
                <input
                  type="checkbox"
                  checked={readability}
                  onChange={(e) => setReadability(e.target.checked)}
                />
                Extract main article <span>(strip nav, ads &amp; footers)</span>
              </label>
            )}
          </div>

          <div className="modes">
            {MODES.map((m) => (
              <button
                key={m.id}
                className={`mode-btn ${mode === m.id ? 'active' : ''}`}
                onClick={() => setMode(m.id)}
              >
                {m.label}
              </button>
            ))}
          </div>

          {mode === 'paste' ? (
            <div className="galley">
              <div className="galley-bar">
                <span className="galley-dot" />
                <span className="galley-name">galley.{format === 'html' ? 'html' : 'md'}</span>
              </div>
              <textarea
                className="md-input"
                value={pasteText}
                onChange={(e) => setPasteText(e.target.value)}
                placeholder={
                  format === 'html'
                    ? 'Paste your HTML here…'
                    : '# Your title\n\nPaste your Markdown here…'
                }
                spellCheck={false}
              />
            </div>
          ) : mode === 'url' ? (
            <div className="url-mode">
              <div className="url-row">
                <input
                  type="url"
                  className="url-input"
                  placeholder="https://example.com/a-great-post"
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') fetchUrl();
                  }}
                />
                <button
                  className="fetch-btn"
                  onClick={fetchUrl}
                  disabled={!url.trim() || urlStatus === 'loading'}
                >
                  {urlStatus === 'loading' ? 'Fetching…' : 'Fetch'}
                </button>
              </div>
              {urlStatus === 'ok' && (
                <p className="url-status ok">
                  ✓ Loaded {fetchedContent.length.toLocaleString()} characters — ready to bind below.
                </p>
              )}
              {urlStatus === 'error' && <p className="url-status bad">{urlError}</p>}
              <div className={`fetch-badge ${proxy ? 'on' : proxy === false ? 'off' : ''}`}>
                {proxy === null
                  ? 'Checking the fetcher…'
                  : proxy
                    ? '● Server fetcher active — fetches any site and its images.'
                    : '○ Limited mode (this static host has no fetcher): only sites that allow cross-origin requests will load. Run locally or deploy to Vercel for full fetch.'}
              </div>
              <p className="url-hint">
                Pick <b>HTML</b> above for a normal web page, or <b>Markdown</b> for a raw .md link.
              </p>
            </div>
          ) : (
            <label
              className={`dropzone ${drag ? 'drag' : ''}`}
              onDragOver={(e) => {
                e.preventDefault();
                setDrag(true);
              }}
              onDragLeave={() => setDrag(false)}
              onDrop={onDrop}
            >
              <span className="big">
                {mode === 'folder' ? 'Drop a folder of documents' : 'Drop your file' + (mode === 'files' ? ' and its images' : '')}
              </span>
              <span className="small">drop it here · or click to browse</span>
              <input
                ref={dirInputRef}
                type="file"
                multiple={mode !== 'file'}
                accept={
                  mode === 'file'
                    ? format === 'html'
                      ? '.html,.htm,.xhtml'
                      : '.md,.markdown,.txt'
                    : undefined
                }
                onChange={onPick}
                {...dirProps}
              />
            </label>
          )}

          {mode !== 'paste' && mode !== 'url' && (docs.length > 0 || images.length > 0) && (
            <div className="filelist">
              {docs.map((d, i) => (
                <span key={`d${i}`} className="chip md">
                  ✎ {d.name}
                </span>
              ))}
              {images.map((f, i) => (
                <span key={`i${i}`} className="chip">
                  {f.relPath}
                </span>
              ))}
            </div>
          )}

          {docs.length > 1 && (
            <div className="md-picker field">
              <label>Use which file?</label>
              <div className="select-wrap">
                <select value={docIndex} onChange={(e) => setDocIndex(Number(e.target.value))}>
                  {docs.map((d, i) => (
                    <option key={i} value={i}>
                      {d.name}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          )}

          <div className="editor-foot">
            {mode === 'paste' && (
              <button
                className="ghost-btn"
                onClick={() => setPasteText(format === 'html' ? SAMPLE_HTML : SAMPLE_MD)}
              >
                {format === 'html'
                  ? '✦ Load a sample blog page (HTML)'
                  : '✦ Load a sample (math, a diagram & a table)'}
              </button>
            )}
            {words > 0 && (
              <span className="editor-meta">
                ≈ {words.toLocaleString()} words · ~{pages} Kindle pages · {minutes} min read
              </span>
            )}
          </div>
        </section>

        {/* II — Details */}
        <section className="step">
          <ProofMarks />
          <div className="step-head">
            <div className="step-head-l">
              <span className="step-num">II.</span>
              <h2 className="step-title">Title page &amp; structure</h2>
            </div>
            <span className="step-hint">Blank fields are filled in automatically.</span>
          </div>

          <div className="field">
            <label>Title</label>
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Auto — from front matter, first heading, or filename"
            />
          </div>
          <div className="fields-row">
            <div className="field">
              <label>Author</label>
              <input value={author} onChange={(e) => setAuthor(e.target.value)} placeholder="Unknown" />
            </div>
            <div className="field">
              <label>Language</label>
              <input value={language} onChange={(e) => setLanguage(e.target.value)} placeholder="en" />
            </div>
          </div>
          <div className="field">
            <label>Chapters &amp; table of contents</label>
            <div className="select-wrap">
              <select value={chapterSplit} onChange={(e) => setChapterSplit(e.target.value as ChapterSplit)}>
                {(Object.keys(SPLIT_LABELS) as ChapterSplit[]).map((k) => (
                  <option key={k} value={k}>
                    {SPLIT_LABELS[k]}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </section>

        {/* III — Cover */}
        <section className="step">
          <ProofMarks />
          <div className="step-head">
            <div className="step-head-l">
              <span className="step-num">III.</span>
              <h2 className="step-title">The cover</h2>
            </div>
            <span className="step-hint">Shown in your Kindle library.</span>
          </div>

          <div className="cover-layout">
            <div className="cover-controls">
              <div className="seg">
                {(['auto', 'upload', 'none'] as const).map((m) => (
                  <button key={m} className={coverMode === m ? 'active' : ''} onClick={() => setCoverMode(m)}>
                    {m === 'auto' ? 'Design one for me' : m === 'upload' ? 'Upload my own' : 'No cover'}
                  </button>
                ))}
              </div>
              {coverMode === 'upload' && (
                <div className="cover-upload">
                  <input type="file" accept="image/*" onChange={(e) => setCoverFile(e.target.files?.[0] ?? null)} />
                  {coverFile && <span> · {coverFile.name}</span>}
                </div>
              )}
              <p className="cover-note">{COVER_NOTES[coverMode]}</p>
            </div>

            <div className={`ereader ${coverMode === 'none' ? 'dim' : ''}`}>
              <div className="ereader-screen">
                <span className="er-accent" />
                <div className="er-title">{title || 'Your Title Here'}</div>
                <div className="er-author">{author || 'Unknown'}</div>
                <div className="er-lines">
                  <span style={{ width: '100%' }} />
                  <span style={{ width: '80%' }} />
                  <span style={{ width: '92%' }} />
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* Bind */}
        <div className="actions">
          <button className="btn-primary" disabled={!canConvert} onClick={run}>
            {busy ? 'Binding…' : 'Bind the EPUB'}
          </button>
          <div className="bind-note">EPUB · pressed entirely on this device</div>

          {busy && progress && (
            <div className="progress">
              <div className="progress-track">
                <div className="progress-fill" style={{ width: `${Math.round(progress.pct * 100)}%` }} />
              </div>
              <div className="progress-stage">{progress.stage}…</div>
            </div>
          )}

          {error && <div className="error">{error}</div>}

          {result && downloadUrl && (
            <div className="result">
              <h3>Bound &amp; ready to read.</h3>
              <div className="stats">
                <div className="stat">
                  <b>{result.stats.chapters}</b>
                  <span>Chapters</span>
                </div>
                <div className="stat">
                  <b>{result.stats.words.toLocaleString()}</b>
                  <span>Words</span>
                </div>
                <div className="stat">
                  <b>{result.stats.images}</b>
                  <span>Images</span>
                </div>
                <div className="stat">
                  <b>{result.stats.diagrams}</b>
                  <span>Diagrams</span>
                </div>
                <div className="stat">
                  <b>{result.stats.equations}</b>
                  <span>Equations</span>
                </div>
              </div>
              <a className="download-btn" href={downloadUrl} download={result.filename}>
                ↓ Download {result.filename}
              </a>
              <p className="send-note">
                Email it to your <b>@kindle.com</b> address, or use the Send to Kindle app.
              </p>
              {result.warnings.length > 0 && (
                <div className="warnings">
                  <b>{result.warnings.length} note(s):</b>
                  <ul>
                    {result.warnings.slice(0, 8).map((w, i) => (
                      <li key={i}>{w}</li>
                    ))}
                    {result.warnings.length > 8 && <li>…and {result.warnings.length - 8} more.</li>}
                  </ul>
                </div>
              )}
            </div>
          )}
        </div>
      </main>

      <footer className="colophon">
        <p className="source-line">
          <a href={REPO_URL} target="_blank" rel="noopener noreferrer">
            <GitHubMark /> <span>Open source — view on GitHub</span>
          </a>
        </p>
        <p className="tech">Built with markdown-it · mermaid · MathJax · Readability · JSZip — all running locally in your browser.</p>
        <p className="note">
          Modern Kindles accept EPUB directly (MOBI was retired in 2025). Hyphenation is disabled in
          the output for a smoother read.
        </p>
      </footer>
    </div>
  );
}
