/**
 * Shared e2e helper (R2-2, A45): the HOST side of the embedding test — a
 * tiny static server on a FIXED port, bound to every interface, so the SAME
 * page is reachable at TWO origins (http://localhost:4199 and
 * http://127.0.0.1:4199) — an allow-listed one and a non-allow-listed one.
 * The app itself stays on the Playwright webServer (http://localhost:4173),
 * so the host page and the embedded app are always on DIFFERENT origins.
 */
import { createServer, type Server } from 'node:http';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
export const HOST_SERVER_PORT = 4199;
export const HOST_ORIGIN_ALLOWED = `http://localhost:${HOST_SERVER_PORT}`;
export const HOST_ORIGIN_STRANGER = `http://127.0.0.1:${HOST_SERVER_PORT}`;
/** The embedded app's origin (the Playwright webServer). */
export const APP_ORIGIN = 'http://localhost:4173';

let server: Server | null = null;
let started: Promise<void> | null = null;

export async function startHostServer(): Promise<void> {
  started ??= new Promise<void>((resolve, reject) => {
    const html = readFileSync(join(HERE, '..', 'fixtures', 'host', 'host.html'), 'utf-8');
    const png = readFileSync(join(HERE, '..', '..', 'fixtures', 'images', 'clean01.png'));
    server = createServer((req, res) => {
      const path = (req.url ?? '/').split('?')[0];
      if (path === '/host.html' || path === '/') {
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
        res.end(html);
      } else if (path === '/fixture.png') {
        res.writeHead(200, { 'content-type': 'image/png' });
        res.end(png);
      } else {
        res.writeHead(404, { 'content-type': 'text/plain' });
        res.end('not found');
      }
    });
    // '::' with dual-stack: reachable at both 127.0.0.1 and localhost (::1).
    server
      .listen(HOST_SERVER_PORT, '::')
      .once('listening', () => resolve())
      .once('error', reject);
  });
  await started;
}

export async function stopHostServer(): Promise<void> {
  await new Promise<void>((resolve) => {
    if (!server) return resolve();
    server.close(() => resolve());
    server = null;
    started = null;
  });
}
