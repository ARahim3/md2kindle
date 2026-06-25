// Vercel Edge function: a same-origin fetch proxy for the URL-import feature.
// Deployed automatically by Vercel (any repo with an /api directory). It fetches
// server-side (no browser CORS) so the client can import a page and its images.
//
// Unlike the local Vite dev proxy, this is PUBLIC, so it refuses private /
// loopback hosts to avoid being used to probe internal networks (basic SSRF
// guard; redirects are followed by the platform, so treat as best-effort).

export const config = { runtime: 'edge' };

function isPrivateHost(hostname: string): boolean {
  const h = hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (h === 'localhost' || h.endsWith('.local') || h.endsWith('.internal')) return true;
  if (h === '::1' || h.startsWith('fc') || h.startsWith('fd') || h.startsWith('fe80')) return true;
  if (/^(127|10|0)\./.test(h)) return true;
  if (/^192\.168\./.test(h)) return true;
  if (/^169\.254\./.test(h)) return true;
  const m = h.match(/^172\.(\d+)\./);
  if (m && +m[1] >= 16 && +m[1] <= 31) return true;
  return false;
}

const PROXY_HEADER = { 'x-md2k-proxy': '1' };

export default async function handler(req: Request): Promise<Response> {
  const { searchParams } = new URL(req.url);

  if (searchParams.get('ping')) {
    return new Response('ok', { headers: PROXY_HEADER });
  }

  const target = searchParams.get('url');
  if (!target) {
    return new Response('Missing url', { status: 400, headers: PROXY_HEADER });
  }

  let parsed: URL;
  try {
    parsed = new URL(target);
  } catch {
    return new Response('Invalid url', { status: 400, headers: PROXY_HEADER });
  }
  if (!/^https?:$/.test(parsed.protocol) || isPrivateHost(parsed.hostname)) {
    return new Response('Blocked host', { status: 403, headers: PROXY_HEADER });
  }

  try {
    const upstream = await fetch(parsed.toString(), {
      redirect: 'follow',
      headers: { 'user-agent': 'Mozilla/5.0 (compatible; md2kindle/1.0)' },
    });
    const headers = new Headers(PROXY_HEADER);
    const ct = upstream.headers.get('content-type');
    if (ct) headers.set('content-type', ct);
    headers.set('cache-control', 'public, max-age=300');
    return new Response(upstream.body, { status: upstream.status, headers });
  } catch (err) {
    return new Response(`Upstream fetch failed: ${(err as Error).message}`, {
      status: 502,
      headers: PROXY_HEADER,
    });
  }
}
