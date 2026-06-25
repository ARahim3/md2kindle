// Browser file ingestion: file pickers (single, multi, directory) and
// drag-and-drop of files or whole folders (via the WebKit entries API).

import type { SuppliedFile } from './types';

export function isMarkdownName(name: string): boolean {
  return /\.(md|markdown|mdown|mkd|mkdn|txt)$/i.test(name);
}

export function isHtmlName(name: string): boolean {
  return /\.(html?|xhtml)$/i.test(name);
}

export function isImageName(name: string): boolean {
  return /\.(png|jpe?g|gif|webp|svg|bmp|tiff?)$/i.test(name);
}

interface WithRelPath {
  webkitRelativePath?: string;
}

function toSupplied(file: File, relPath: string): SuppliedFile {
  return { relPath: relPath || file.name, name: file.name, blob: file };
}

export function pickedToSupplied(list: FileList | File[]): SuppliedFile[] {
  return Array.from(list).map((f) =>
    toSupplied(f, (f as File & WithRelPath).webkitRelativePath || f.name),
  );
}

/* eslint-disable @typescript-eslint/no-explicit-any */
async function walkEntry(entry: any, prefix: string, out: SuppliedFile[]): Promise<void> {
  if (entry.isFile) {
    const file: File = await new Promise((res, rej) => entry.file(res, rej));
    out.push(toSupplied(file, prefix + file.name));
  } else if (entry.isDirectory) {
    const reader = entry.createReader();
    const all: any[] = [];
    await new Promise<void>((resolve) => {
      const read = () =>
        reader.readEntries(
          (batch: any[]) => {
            if (!batch.length) return resolve();
            all.push(...batch);
            read();
          },
          () => resolve(),
        );
      read();
    });
    for (const e of all) await walkEntry(e, `${prefix}${entry.name}/`, out);
  }
}

export async function droppedToSupplied(dt: DataTransfer): Promise<SuppliedFile[]> {
  const out: SuppliedFile[] = [];
  const items = Array.from(dt.items || []);
  const entries = items
    .map((it) => (typeof (it as any).webkitGetAsEntry === 'function' ? (it as any).webkitGetAsEntry() : null))
    .filter(Boolean);
  if (entries.length) {
    for (const e of entries) await walkEntry(e, '', out);
  } else {
    for (const f of Array.from(dt.files)) out.push(toSupplied(f, f.name));
  }
  return out;
}
