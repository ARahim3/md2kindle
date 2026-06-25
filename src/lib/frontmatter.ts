// Minimal, dependency-free YAML-ish front-matter extractor.
// Handles the common `key: value` block delimited by `---` lines that AI tools
// and static-site generators emit. It is intentionally simple — we only need a
// handful of scalar fields (title, author, language, cover).

export interface FrontMatter {
  data: Record<string, string>;
  body: string;
}

const FM_RE = /^﻿?---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*\r?\n?/;

export function parseFrontMatter(src: string): FrontMatter {
  const m = src.match(FM_RE);
  if (!m) return { data: {}, body: src };

  const data: Record<string, string> = {};
  for (const rawLine of m[1].split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const idx = line.indexOf(':');
    if (idx === -1) continue;
    const key = line.slice(0, idx).trim().toLowerCase();
    let value = line.slice(idx + 1).trim();
    // Strip a single pair of surrounding quotes.
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (key) data[key] = value;
  }
  return { data, body: src.slice(m[0].length) };
}
