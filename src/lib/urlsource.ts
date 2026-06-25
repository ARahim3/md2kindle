// Fetch a page/document by URL for conversion.

import { fetchText } from './net';
import { absolutizeUrls } from './html';
import type { SourceKind } from './types';

/**
 * Fetch the content at `url`. For HTML we rewrite relative URLs to absolute (so
 * images resolve); Markdown is returned verbatim.
 */
export async function fetchSource(url: string, kind: SourceKind): Promise<string> {
  const text = await fetchText(url);
  return kind === 'html' ? absolutizeUrls(text, url) : text;
}
