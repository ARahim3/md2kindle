// Image asset registry + source resolution.
//
// Every image that ends up in the book (resolved local file, fetched remote
// URL, decoded data: URI, rasterised diagram or equation) is registered here
// and given a stable in-EPUB path under images/.

import type { SuppliedFile } from './types';
import { fetchBytes } from './net';

export interface ImageAsset {
  id: string;
  href: string; // e.g. images/img-0001.png
  mediaType: string;
  data: Uint8Array;
}

const MIME_EXT: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'image/svg+xml': 'svg',
  'image/bmp': 'bmp',
  'image/tiff': 'tiff',
};

const EXT_MIME: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  svg: 'image/svg+xml',
  bmp: 'image/bmp',
  tif: 'image/tiff',
  tiff: 'image/tiff',
};

export function mediaTypeFromName(name: string): string {
  const ext = name.split('.').pop()?.toLowerCase() ?? '';
  return EXT_MIME[ext] ?? 'application/octet-stream';
}

function extForMedia(mediaType: string): string {
  return MIME_EXT[mediaType] ?? 'bin';
}

export class AssetRegistry {
  readonly images: ImageAsset[] = [];
  private cache = new Map<string, ImageAsset>();
  private n = 0;

  /** Register raw bytes. `key` (e.g. the original src) enables deduplication. */
  add(data: Uint8Array, mediaType: string, key?: string): ImageAsset {
    if (key && this.cache.has(key)) return this.cache.get(key)!;
    const id = `img-${String(++this.n).padStart(4, '0')}`;
    const href = `images/${id}.${extForMedia(mediaType)}`;
    const asset: ImageAsset = { id, href, mediaType, data };
    this.images.push(asset);
    if (key) this.cache.set(key, asset);
    return asset;
  }
}

// ---------------------------------------------------------------------------
// Source resolution
// ---------------------------------------------------------------------------

export interface FileIndex {
  byRel: Map<string, SuppliedFile>;
  byBase: Map<string, SuppliedFile>;
}

function normRel(p: string): string {
  let s = p.trim();
  try {
    s = decodeURIComponent(s);
  } catch {
    /* leave as-is if it isn't valid percent-encoding */
  }
  return s.replace(/\\/g, '/').replace(/^\.\//, '').replace(/^\/+/, '');
}

function basename(p: string): string {
  return normRel(p).split('/').pop() ?? p;
}

export function buildFileIndex(files: SuppliedFile[]): FileIndex {
  const byRel = new Map<string, SuppliedFile>();
  const byBase = new Map<string, SuppliedFile>();
  for (const f of files) {
    // Register every path suffix ("a/b/c.png" -> "a/b/c.png", "b/c.png", "c.png")
    // so a markdown reference matches regardless of how many leading folders the
    // dropped directory added. First writer wins.
    const parts = normRel(f.relPath).split('/');
    for (let i = 0; i < parts.length; i++) {
      const suffix = parts.slice(i).join('/');
      if (!byRel.has(suffix)) byRel.set(suffix, f);
    }
    if (!byBase.has(f.name)) byBase.set(f.name, f);
  }
  return { byRel, byBase };
}

export interface ResolvedBytes {
  data: Uint8Array;
  mediaType: string;
}

function parseDataUri(src: string): ResolvedBytes | null {
  const m = src.match(/^data:([^;,]*)(;base64)?,([\s\S]*)$/i);
  if (!m) return null;
  const mediaType = m[1] || 'text/plain';
  const isBase64 = !!m[2];
  if (isBase64) {
    const bin = atob(m[3]);
    const data = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) data[i] = bin.charCodeAt(i);
    return { data, mediaType };
  }
  return { data: new TextEncoder().encode(decodeURIComponent(m[3])), mediaType };
}

async function fetchRemote(src: string): Promise<ResolvedBytes> {
  // Goes through the server-side proxy when available (so a fetched page's
  // cross-origin images aren't blocked by CORS), else a direct browser fetch.
  return fetchBytes(src);
}

async function fromSuppliedFile(file: SuppliedFile): Promise<ResolvedBytes> {
  const buf = new Uint8Array(await file.blob.arrayBuffer());
  const mediaType = file.blob.type || mediaTypeFromName(file.name);
  return { data: buf, mediaType };
}

/**
 * Resolve an image `src` to raw bytes. Returns null when a local file can't be
 * found (caller records a warning). Remote/data failures throw.
 */
export async function resolveSource(src: string, index: FileIndex): Promise<ResolvedBytes | null> {
  if (/^data:/i.test(src)) return parseDataUri(src);
  if (/^(https?:)?\/\//i.test(src)) return fetchRemote(src.replace(/^\/\//, 'https://'));

  const rel = normRel(src);
  const hit = index.byRel.get(rel) ?? index.byBase.get(basename(src));
  if (!hit) return null;
  return fromSuppliedFile(hit);
}
