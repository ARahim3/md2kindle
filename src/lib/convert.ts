// The orchestrator: markdown + supplied files + options -> EPUB Blob.
// Runs on the main thread (mermaid and canvas rasterisation both need the DOM),
// yielding between heavy stages so the progress UI can paint.

import type { ConvertOptions, ConvertResult, ProgressFn } from './types';
import { parseFrontMatter } from './frontmatter';
import { renderMarkdown } from './markdown';
import { extractHtml } from './html';
import { AssetRegistry, buildFileIndex } from './images';
import { transform } from './transform';
import { splitIntoChapters } from './chapters';
import { generateCover } from './cover';
import { buildEpub, type CoverInput } from './epub';
import { slugify } from './slug';

const nextFrame = (): Promise<void> =>
  new Promise((resolve) => requestAnimationFrame(() => resolve()));

function firstHeading(markdown: string): string | null {
  const m = markdown.match(/^#{1,6}[ \t]+(.+?)[ \t]*#*\s*$/m);
  return m ? m[1].trim() : null;
}

function countWords(text: string): number {
  const t = text.trim();
  return t ? t.split(/\s+/).length : 0;
}

async function coverFromOptions(
  opts: ConvertOptions,
  title: string,
  author: string,
  onProgress: ProgressFn,
): Promise<CoverInput | null> {
  if (opts.cover.mode === 'none') return null;
  if (opts.cover.mode === 'upload') {
    if (!opts.cover.image) return null;
    const data = new Uint8Array(await opts.cover.image.arrayBuffer());
    return { data, mediaType: opts.cover.image.type || 'image/jpeg' };
  }
  onProgress({ stage: 'Designing cover', pct: 0.85 });
  const blob = await generateCover(title, author, opts.cover.accent);
  return { data: new Uint8Array(await blob.arrayBuffer()), mediaType: 'image/jpeg' };
}

export async function convert(opts: ConvertOptions, onProgress: ProgressFn): Promise<ConvertResult> {
  const warnings: string[] = [];

  // Produce sanitised HTML plus any title/author/language we can derive from the
  // source itself (front matter for Markdown; <title>/byline for HTML).
  let html: string;
  let srcTitle: string | undefined;
  let srcAuthor: string | undefined;
  let srcLang: string | undefined;

  if (opts.kind === 'html') {
    onProgress({ stage: 'Extracting article', pct: 0.05 });
    await nextFrame();
    const ex = extractHtml(opts.content, opts.readability ?? true);
    html = ex.html;
    srcTitle = ex.title;
    srcAuthor = ex.author;
  } else {
    onProgress({ stage: 'Reading front matter', pct: 0.02 });
    const { data: fm, body } = parseFrontMatter(opts.content);
    onProgress({ stage: 'Rendering Markdown', pct: 0.08 });
    await nextFrame();
    html = renderMarkdown(body);
    srcTitle = fm.title || firstHeading(body) || undefined;
    srcAuthor = fm.author || fm.creator || undefined;
    srcLang = fm.language || fm.lang || undefined;
  }

  const title = (opts.title || srcTitle || 'Untitled').trim();
  const author = (opts.author || srcAuthor || 'Unknown').trim();
  const language = (opts.language || srcLang || 'en').trim();

  const container = document.createElement('div');
  container.innerHTML = html;

  const registry = new AssetRegistry();
  const fileIndex = buildFileIndex(opts.files);

  const { images, diagrams, equations } = await transform(
    container,
    registry,
    fileIndex,
    warnings,
    (stage, pct) => onProgress({ stage, pct }),
  );

  onProgress({ stage: 'Splitting chapters', pct: 0.8 });
  await nextFrame();
  const chapters = splitIntoChapters(container, opts.chapterSplit, title);

  const cover = await coverFromOptions(opts, title, author, onProgress);

  onProgress({ stage: 'Packaging EPUB', pct: 0.92 });
  await nextFrame();
  const epub = await buildEpub({
    title,
    author,
    language,
    chapters,
    images: registry.images,
    cover,
  });

  onProgress({ stage: 'Done', pct: 1 });
  return {
    epub,
    filename: `${slugify(title)}.epub`,
    warnings,
    stats: {
      chapters: chapters.length,
      images,
      diagrams,
      equations,
      words: countWords(container.textContent || ''),
    },
  };
}
