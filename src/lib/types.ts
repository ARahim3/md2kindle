// Shared types for the md2kindle conversion pipeline.

export type InputMode = 'paste' | 'url' | 'file' | 'files' | 'folder';

/** What kind of source the `content` is. */
export type SourceKind = 'markdown' | 'html';

/** A file the user supplied alongside the markdown (an image, usually). */
export interface SuppliedFile {
  /** Path relative to the dropped root (folder mode) or just the filename. */
  relPath: string;
  /** Bare filename (basename). */
  name: string;
  blob: Blob;
}

export type ChapterSplit = 'auto' | 'h1' | 'h2' | 'none';

export interface CoverOptions {
  mode: 'auto' | 'upload' | 'none';
  /** Used when mode === 'upload'. */
  image?: Blob | null;
  /** Accent colour for the auto-generated cover. */
  accent?: string;
}

export interface ConvertOptions {
  kind: SourceKind;
  /** Markdown or HTML, depending on `kind`. */
  content: string;
  /** HTML only: extract the main article with Readability (strip nav/ads). */
  readability?: boolean;
  files: SuppliedFile[];
  title: string;
  author: string;
  language: string;
  chapterSplit: ChapterSplit;
  cover: CoverOptions;
}

export interface ConvertStats {
  chapters: number;
  images: number;
  diagrams: number;
  equations: number;
  words: number;
}

export interface ConvertResult {
  epub: Blob;
  filename: string;
  warnings: string[];
  stats: ConvertStats;
}

export interface ProgressUpdate {
  stage: string;
  /** 0..1 */
  pct: number;
}

export type ProgressFn = (update: ProgressUpdate) => void;
