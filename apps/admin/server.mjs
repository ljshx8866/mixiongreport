import { createReadStream, existsSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join, normalize } from 'node:path';
import { Readable } from 'node:stream';

const root = join(process.cwd(), 'dist');
const types = { '.css': 'text/css', '.js': 'text/javascript', '.html': 'text/html', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon' };
createServer(async (request, response) => {
  if (request.url?.startsWith('/api/')) {
    try {
      const headers = Object.fromEntries(Object.entries(request.headers).filter(([key]) => key !== 'host').map(([key, value]) => [key, String(value)]));
      const upstream = await fetch(`http://api:3000${request.url}`, { method: request.method, headers, body: ['GET', 'HEAD'].includes(request.method ?? 'GET') ? undefined : Readable.toWeb(request), duplex: 'half' });
      response.writeHead(upstream.status, Object.fromEntries(upstream.headers));
      if (upstream.body) Readable.fromWeb(upstream.body).pipe(response); else response.end();
    } catch { response.writeHead(502).end('API upstream unavailable'); }
    return;
  }
  const path = normalize(request.url?.split('?')[0] ?? '/').replace(/^([/\\])+/, '');
  const file = join(root, path || 'index.html'); const target = existsSync(file) ? file : join(root, 'index.html');
  response.writeHead(200, { 'Content-Type': types[extname(target)] ?? 'application/octet-stream' });
  createReadStream(target).pipe(response);
}).listen(80);
