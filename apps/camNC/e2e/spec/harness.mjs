import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));

/** A port nothing is using, so runs from different worktrees don't collide. */
function freePort() {
  return new Promise((resolve, reject) => {
    const probe = createServer();
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const { port } = probe.address();
      probe.close(() => resolve(port));
    });
  });
}

/** Own a dev server, so one command runs everything, locally and in CI. */
export async function startDevServer() {
  const port = await freePort();
  const url = `http://127.0.0.1:${port}`;
  const server = spawn('pnpm', ['vite', '--port', String(port), '--host', '127.0.0.1', '--strictPort'], {
    cwd: path.resolve(root, '../..'),
    env: { ...process.env, CAMNC_SKIP_TYPECHECK: '1' },
    stdio: 'ignore',
    detached: true,
  });
  const started = Date.now();
  for (;;) {
    const ready = await fetch(url).then(response => response.ok).catch(() => false);
    if (ready) break;
    assert(Date.now() - started < 120_000, 'The dev server did not start');
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  return { url, stop: () => process.kill(-server.pid) };
}

/** A fresh browser context, so nothing saved carries over, with its runtime errors collected. */
export async function openPage(browser) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, locale: 'en-US' });
  const page = await context.newPage();
  // A cold Vite server can still compile lazy editor modules after DOMContentLoaded.
  page.setDefaultTimeout(45000);
  const runtime = [];
  page.on('pageerror', error => runtime.push(`page error: ${error.message}`));
  page.on('console', message => {
    if (message.type() === 'error') runtime.push(`console error: ${message.text()}`);
  });
  return { context, page, runtime };
}
