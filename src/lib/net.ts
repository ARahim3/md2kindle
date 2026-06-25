// Network access for the URL-import feature.
//
// All requests go through a same-origin endpoint (`/api/fetch`) when one is
// available — the Vite dev/preview server provides it locally, and a Vercel Edge
// function provides it in production. That endpoint fetches server-side, so it
// sidesteps browser CORS (and can proxy a page's images too).
//
// When no endpoint exists (e.g. a static GitHub Pages deploy), we fall back to a
// direct browser fetch, which only succeeds for CORS-enabled targets.

const PROXY = '/api/fetch';

let proxyProbe: Promise<boolean> | undefined;

/** Is our server-side fetch endpoint available on this host? (probed once) */
export function hasProxy(): Promise<boolean> {
  if (!proxyProbe) {
    proxyProbe = (async () => {
      try {
        const r = await fetch(`${PROXY}?ping=1`);
        return r.ok && r.headers.get('x-md2k-proxy') === '1';
      } catch {
        return false;
      }
    })();
  }
  return proxyProbe;
}

function proxied(url: string): string {
  return `${PROXY}?url=${encodeURIComponent(url)}`;
}

function guessType(url: string): string {
  const ext = url.split(/[?#]/)[0].split('.').pop()?.toLowerCase() ?? '';
  return (
    {
      png: 'image/png',
      jpg: 'image/jpeg',
      jpeg: 'image/jpeg',
      gif: 'image/gif',
      webp: 'image/webp',
      svg: 'image/svg+xml',
      bmp: 'image/bmp',
    }[ext] ?? 'application/octet-stream'
  );
}

export async function fetchText(url: string): Promise<string> {
  const target = (await hasProxy()) ? proxied(url) : url;
  const r = await fetch(target);
  if (!r.ok) throw new Error(`Could not fetch the page (HTTP ${r.status}).`);
  return r.text();
}

export async function fetchBytes(url: string): Promise<{ data: Uint8Array; mediaType: string }> {
  const target = (await hasProxy()) ? proxied(url) : url;
  const r = await fetch(target, { mode: 'cors' });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const ct = r.headers.get('content-type')?.split(';')[0]?.trim();
  return { data: new Uint8Array(await r.arrayBuffer()), mediaType: ct || guessType(url) };
}
