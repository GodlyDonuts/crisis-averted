import { createServer } from 'node:http';
import { createReadStream, existsSync, statSync } from 'node:fs';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';

const scriptsDir = dirname(fileURLToPath(import.meta.url));
const frontendRoot = join(dirname(scriptsDir), 'frontend');
const root = join(frontendRoot, 'out');
const port = Number(process.env.PORT || process.argv[2] || 3000);
const types = new Map(Object.entries({
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.wasm': 'application/wasm', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.txt': 'text/plain; charset=utf-8',
  '.woff2': 'font/woff2', '.geojson': 'application/geo+json; charset=utf-8',
}));

if (!existsSync(root)) {
  console.error('frontend/out does not exist. Run npm run build first.');
  process.exit(1);
}

createServer((request, response) => {
  const url = new URL(request.url || '/', 'http://localhost');
  let pathname = decodeURIComponent(url.pathname);
  if (pathname === '/crisis-averted') pathname = '/';
  if (pathname.startsWith('/crisis-averted/')) pathname = pathname.slice('/crisis-averted'.length);
  let file = normalize(join(root, pathname));
  if (!file.startsWith(root)) { response.writeHead(403); response.end(); return; }
  if (!existsSync(file) && !extname(file)) file = join(file, 'index.html');
  if (existsSync(file) && statSync(file).isDirectory()) file = join(file, 'index.html');
  if (!existsSync(file)) file = join(root, 'index.html');
  const extension = extname(file);
  const immutable = pathname.startsWith('/_next/static/') || ['.png', '.jpg', '.jpeg', '.wasm', '.woff2'].includes(extension);
  response.writeHead(200, {
    'content-type': types.get(extension) || 'application/octet-stream',
    'cache-control': immutable ? 'public, max-age=31536000, immutable' : 'no-cache',
  });
  createReadStream(file).pipe(response);
}).listen(port, () => console.log(`God's Eye static export: http://localhost:${port}/`));
