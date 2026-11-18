import { createHash } from 'node:crypto';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { connect, createServer } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { createInterface } from 'node:readline';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { openPage, startDevServer } from './harness.mjs';

const root = path.dirname(fileURLToPath(import.meta.url));
const IDLE_LIMIT_MS = 30 * 60_000;

/** Short and per-checkout: Unix socket paths have a low length limit, and worktrees each run their own session. */
export const socketPath = (checkout = root) =>
  path.join(tmpdir(), `camnc-spec-${createHash('sha256').update(checkout).digest('hex').slice(0, 10)}.sock`);

export function assertLocalUrl(url) {
  if (!['localhost', '127.0.0.1', '[::1]'].includes(new URL(url).hostname)) throw new Error(`A session only drives a local dev server, not ${url}`);
}

/**
 * One open page driven a line at a time. A line is a scenario step, or one of the session's own commands. Every line
 * gets one result object, and the page stays exactly where the last line left it.
 */
export function createSession({ open, outDir }) {
  let current = null;
  const opened = async () => (current ??= await open());
  const closePage = async () => {
    const page = current;
    current = null;
    await page?.close();
  };
  const artifact = async (name, extension, write) => {
    if (!/^[\w.-]+$/.test(name)) throw new Error(`A name can only use letters, digits, dots and dashes: ${name}`);
    await mkdir(outDir, { recursive: true });
    const file = path.join(outDir, `${name}.${extension}`);
    await write(file);
    return file;
  };
  const commands = {
    state: async ({ adapter }) => ({ state: await adapter.state() }),
    expect: async ({ adapter }, rest) => {
      const failures = await adapter.check(JSON.parse(rest));
      return { ok: !failures.length, failures };
    },
    frame: async ({ adapter }, rest) => {
      const svg = await adapter.frame();
      if (!svg) throw new Error('There is no sketch canvas on this page');
      return { file: await artifact(rest || 'frame', 'svg', file => writeFile(file, svg)) };
    },
    shot: async ({ page }, rest) => ({ file: await artifact(rest || 'shot', 'png', file => page.screenshot({ path: file })) }),
    render: async ({ adapter, page }, rest) => {
      const files = [];
      for (const view of rest ? rest.split(/\s+/) : ['iso']) {
        // `page` is the page as it is, for a state outside the Part Studio such as the Plan stage.
        if (view !== 'page') await adapter.step(`view ${view}`);
        files.push(await artifact(view, 'png', file => page.screenshot({ path: file })));
      }
      const { parts } = await adapter.state();
      return { files, parts: parts.length };
    },
  };
  const run = async line => {
    const text = line.trim();
    const started = Date.now();
    const space = text.indexOf(' ');
    const verb = space < 0 ? text : text.slice(0, space);
    const rest = space < 0 ? '' : text.slice(space + 1).trim();
    let result;
    try {
      if (verb === 'reset') {
        await closePage();
        await opened();
        result = { ok: true };
      } else {
        const { adapter, page } = await opened();
        if (!(await adapter.inDemo())) throw new Error('This page left demo mode, so the session refuses to drive it. Use reset.');
        if (commands[verb]) {
          await adapter.settle();
          result = { ok: true, ...(await commands[verb]({ adapter, page }, rest)) };
        } else {
          await adapter.step(text);
          await adapter.settle();
          result = { ok: true, state: await adapter.state() };
        }
      }
    } catch (error) {
      // Whatever a failed step left on screen is what the agent needs to see next.
      const state = await current?.adapter.state().catch(() => undefined);
      result = { ok: false, error: String(error.message).split('\n').slice(0, 12).join('\n'), state };
    }
    const errors = current?.runtime.splice(0) ?? [];
    return { line: text, ...result, ...(errors.length && { errors }), ms: Date.now() - started };
  };
  /** The page as it is now, unsettled, as a render writes it after a failed step. Null when there is no page. */
  const screenshot = async name => (current ? artifact(name, 'png', file => current.page.screenshot({ path: file })) : null);
  return { run, screenshot, close: closePage };
}

function parseArgs(args) {
  const options = { url: null, headed: false, listen: false, domain: 'sketch' };
  for (let i = 0; i < args.length; i++) {
    const flag = args[i];
    if (flag === '--') continue;
    if (flag === '--url') options.url = args[++i];
    else if (flag === '--headed') options.headed = true;
    else if (flag === '--listen') options.listen = true;
    else if (flag === '--domain') options.domain = args[++i];
    else throw new Error(`Unknown option: ${flag}`);
  }
  if (options.url) assertLocalUrl(options.url);
  return options;
}

/** A session on a real browser, starting its own dev server unless given `url`. */
export async function browserSession(options) {
  let server = null;
  let browser = null;
  const open = async () => {
    if (!options.url) {
      server = await startDevServer();
      options.url = server.url;
    }
    browser ??= await createRequire(import.meta.url)('playwright').chromium.launch({ headless: !options.headed });
    // `studio` adds the Part Studio steps and state; `sketch` is lighter, reading no saved studio state per line.
    if (!['sketch', 'studio'].includes(options.domain ?? 'sketch')) throw new Error(`Unknown domain: ${options.domain}`);
    const { createAdapter } = await import(`./adapters/${options.domain ?? 'sketch'}.mjs`);
    const { context, page, runtime } = await openPage(browser, options.viewport);
    try {
      const adapter = await createAdapter(page, options.url);
      page.setDefaultTimeout(8000);
      return { adapter, page, runtime, close: () => context.close() };
    } catch (error) {
      await context.close();
      throw error;
    }
  };
  const outDir = options.outDir ?? fileURLToPath(new URL('../../test-results/spec-session/', import.meta.url));
  const session = createSession({ open, outDir });
  return {
    run: session.run,
    screenshot: session.screenshot,
    close: async () => {
      await session.close();
      await browser?.close();
      server?.stop();
    },
  };
}

/** Lines from a pipe or a terminal. The exit code says whether every line worked, so CI can use it. */
async function runStdin(options) {
  const session = await browserSession(options);
  let failed = false;
  for await (const line of createInterface({ input: process.stdin })) {
    if (!line.trim()) continue;
    if (line.trim() === 'quit') break;
    const result = await session.run(line);
    failed ||= !result.ok;
    console.log(JSON.stringify(result));
  }
  await session.close();
  process.exitCode = failed ? 1 : 0;
}

/** Stays up between commands, for callers that can't hold stdin open. Stops after `quit`, a signal, or 30 idle minutes. */
async function listen(options) {
  const file = socketPath();
  const alive = await new Promise(resolve => {
    const probe = connect(file);
    probe.once('connect', () => (probe.destroy(), resolve(true)));
    probe.once('error', () => resolve(false));
  });
  if (alive) throw new Error('A session is already running for this checkout. Send it `quit` first.');
  await rm(file, { force: true });
  const session = await browserSession(options);
  let queue = Promise.resolve();
  let idle;
  let stopping = false;
  const stop = async () => {
    if (stopping) return;
    stopping = true;
    clearTimeout(idle);
    server.close();
    await queue.catch(() => {});
    await session.close();
    await rm(file, { force: true });
    process.exit(0);
  };
  const touch = () => {
    clearTimeout(idle);
    idle = setTimeout(stop, IDLE_LIMIT_MS);
  };
  const server = createServer(socket => {
    socket.on('error', () => {});
    createInterface({ input: socket }).on('line', line => {
      touch();
      if (!line.trim()) return;
      // One at a time, in arrival order: two clients can't interleave a gesture.
      queue = queue.then(async () => {
        if (line.trim() === 'quit') {
          socket.end(`${JSON.stringify({ line: 'quit', ok: true })}\n`);
          void stop();
          return;
        }
        const result = await session.run(line);
        if (!socket.destroyed) socket.write(`${JSON.stringify(result)}\n`);
      });
    });
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(file, resolve);
  });
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
  touch();
  console.log(JSON.stringify({ listening: file }));
}

/** Sends each line and prints its result. Retries briefly, because the session may have only just been started. */
async function send(lines) {
  const file = socketPath();
  const socket = await new Promise((resolve, reject) => {
    const started = Date.now();
    const attempt = () => {
      const candidate = connect(file);
      candidate.once('connect', () => resolve(candidate));
      candidate.once('error', error => {
        if (Date.now() - started > 5000) reject(new Error(`No session is running for this checkout (${error.code}). Start one with --listen.`));
        else setTimeout(attempt, 200);
      });
    };
    attempt();
  });
  const replies = createInterface({ input: socket })[Symbol.asyncIterator]();
  let failed = false;
  for (const line of lines) {
    socket.write(`${line}\n`);
    const { value, done } = await replies.next();
    if (done) throw new Error(`The session closed before answering: ${line}`);
    failed ||= JSON.parse(value).ok === false;
    console.log(value);
  }
  socket.end();
  process.exitCode = failed ? 1 : 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2).filter(arg => arg !== '--');
  try {
    if (args[0] === 'send') await send(args.slice(1));
    else {
      const options = parseArgs(args);
      await (options.listen ? listen(options) : runStdin(options));
    }
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
}
