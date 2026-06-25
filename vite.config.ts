import { defineConfig, type Plugin, type Connect } from 'vite';
import react from '@vitejs/plugin-react';
import type { IncomingMessage, ServerResponse } from 'node:http';

// A same-origin fetch endpoint for the URL-import feature, available during
// `vite dev` and `vite preview`. It fetches server-side (Node, no CORS) and can
// proxy a page's images too. Locally this is your own machine, so there is no
// SSRF guard here — the public Vercel function (api/fetch.ts) is the one that
// blocks private/loopback hosts.
async function handleFetch(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const url = new URL(req.url || '', 'http://localhost');
  if (url.searchParams.get('ping')) {
    res.setHeader('x-md2k-proxy', '1');
    res.end('ok');
    return;
  }
  const target = url.searchParams.get('url');
  if (!target || !/^https?:\/\//i.test(target)) {
    res.statusCode = 400;
    res.end('Bad or missing url');
    return;
  }
  try {
    const upstream = await fetch(target, {
      redirect: 'follow',
      headers: { 'user-agent': 'Mozilla/5.0 md2kindle/1.0' },
    });
    const buf = Buffer.from(await upstream.arrayBuffer());
    res.statusCode = upstream.status;
    res.setHeader('x-md2k-proxy', '1');
    res.setHeader('content-type', upstream.headers.get('content-type') || 'application/octet-stream');
    res.end(buf);
  } catch (err) {
    res.statusCode = 502;
    res.setHeader('x-md2k-proxy', '1');
    res.end(`Upstream fetch failed: ${(err as Error).message}`);
  }
}

const fetchEndpoint: Connect.NextHandleFunction = (req, res, next) => {
  if (req.url && req.url.startsWith('/api/fetch')) {
    handleFetch(req, res).catch(() => {
      res.statusCode = 500;
      res.end('error');
    });
    return;
  }
  next();
};

function fetchProxyPlugin(): Plugin {
  return {
    name: 'md2kindle-fetch-proxy',
    configureServer(server) {
      server.middlewares.use(fetchEndpoint);
    },
    configurePreviewServer(server) {
      server.middlewares.use(fetchEndpoint);
    },
  };
}

// base: './' makes the build portable — works on GitHub Pages project paths
// (https://user.github.io/md2kindle/) and at a domain root (Vercel) alike.
export default defineConfig({
  base: './',
  plugins: [react(), fetchProxyPlugin()],
  worker: {
    format: 'es',
  },
  build: {
    target: 'es2020',
    chunkSizeWarningLimit: 2000,
  },
});
