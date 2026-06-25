// Split the transformed document into chapter files and rewrite in-document
// anchor links so they keep working once content lives across multiple files.

import type { ChapterSplit } from './types';

export interface Chapter {
  id: string; // manifest id, e.g. ch-0001
  title: string;
  filename: string; // e.g. chapter-0001.xhtml
  body: string; // serialised XHTML (inner <body> content)
}

type Level = 0 | 1 | 2;

export function resolveSplitLevel(mode: ChapterSplit, container: HTMLElement): Level {
  const h1 = container.querySelectorAll('h1').length;
  const h2 = container.querySelectorAll('h2').length;
  switch (mode) {
    case 'none':
      return 0;
    case 'h1':
      return h1 >= 1 ? 1 : 0;
    case 'h2':
      return h2 >= 1 ? 2 : 0;
    case 'auto':
    default:
      if (h1 >= 2) return 1;
      if (h2 >= 2) return 2;
      if (h1 === 1 && h2 >= 1) return 2;
      return 0;
  }
}

interface Group {
  title: string;
  nodes: Node[];
}

function hasMeaningfulContent(nodes: Node[]): boolean {
  return nodes.some(
    (n) => n.nodeType === Node.ELEMENT_NODE || (n.textContent || '').trim().length > 0,
  );
}

function groupNodes(container: HTMLElement, level: Level, docTitle: string): Group[] {
  const children = Array.from(container.childNodes);
  if (level === 0) {
    return [{ title: docTitle, nodes: children }];
  }

  const tag = level === 1 ? 'H1' : 'H2';
  const groups: Group[] = [];
  const pre: Node[] = [];

  for (const node of children) {
    if (node.nodeType === Node.ELEMENT_NODE && (node as Element).tagName === tag) {
      groups.push({ title: (node.textContent || 'Untitled').trim(), nodes: [node] });
    } else if (groups.length) {
      groups[groups.length - 1].nodes.push(node);
    } else {
      pre.push(node);
    }
  }

  if (!groups.length) {
    return [{ title: docTitle, nodes: children }];
  }
  if (hasMeaningfulContent(pre)) {
    groups.unshift({ title: docTitle, nodes: pre });
  }
  return groups;
}

function collectIds(nodes: Node[]): string[] {
  const ids: string[] = [];
  for (const node of nodes) {
    if (node.nodeType !== Node.ELEMENT_NODE) continue;
    const el = node as Element;
    if (el.id) ids.push(el.id);
    el.querySelectorAll('[id]').forEach((d) => d.id && ids.push(d.id));
  }
  return ids;
}

function serializeNodes(nodes: Node[]): string {
  const ser = new XMLSerializer();
  return nodes
    .map((n) => ser.serializeToString(n))
    .join('')
    .trim();
}

export function splitIntoChapters(
  container: HTMLElement,
  mode: ChapterSplit,
  docTitle: string,
): Chapter[] {
  const level = resolveSplitLevel(mode, container);
  const groups = groupNodes(container, level, docTitle);

  const filenames = groups.map((_, i) => `chapter-${String(i + 1).padStart(4, '0')}.xhtml`);

  // id -> chapter filename, for cross-file anchor rewriting.
  const idToFile = new Map<string, string>();
  groups.forEach((g, i) => {
    for (const id of collectIds(g.nodes)) idToFile.set(id, filenames[i]);
  });

  // Rewrite `#id` links to `file#id` (operates on live nodes pre-serialisation).
  groups.forEach((g) => {
    for (const node of g.nodes) {
      if (node.nodeType !== Node.ELEMENT_NODE) continue;
      const el = node as Element;
      const anchors: Element[] = [];
      if (el.tagName === 'A' && (el.getAttribute('href') || '').startsWith('#')) anchors.push(el);
      el.querySelectorAll('a[href^="#"]').forEach((a) => anchors.push(a));
      for (const a of anchors) {
        const href = a.getAttribute('href') || '';
        const file = idToFile.get(href.slice(1));
        if (file) a.setAttribute('href', `${file}${href}`);
      }
    }
  });

  return groups.map((g, i) => ({
    id: `ch-${String(i + 1).padStart(4, '0')}`,
    title: g.title || docTitle,
    filename: filenames[i],
    body: serializeNodes(g.nodes),
  }));
}
