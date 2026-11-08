import { access, mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { afterAll, beforeAll, expect, it } from 'vitest';

const packageDir = fileURLToPath(new URL('../', import.meta.url));
let dir: string;
let client: Client;

beforeAll(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'cad-script-mcp-'));
  // Started the way an agent's MCP config starts it.
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: ['node_modules/vite-node/vite-node.mjs', '--config', 'vite.config.ts', 'src/mcpMain.ts', '--dir', dir],
    cwd: packageDir,
    stderr: 'ignore',
  });
  client = new Client({ name: 'test', version: '0.0.1' });
  await client.connect(transport);
}, 30_000);

afterAll(async () => {
  await client?.close();
  await rm(dir, { recursive: true, force: true });
});

const texts = (result: Awaited<ReturnType<Client['callTool']>>) =>
  (result.content as { type: string; text: string }[]).map(item => item.text);

it('offers the guide, the examples and the check', async () => {
  const { tools } = await client.listTools();
  expect(tools.map(tool => tool.name).sort()).toEqual(['cad_script_example', 'cad_script_guide', 'check_design', 'read_design']);
  const [guide] = texts(await client.callTool({ name: 'cad_script_guide', arguments: {} }));
  expect(guide).toContain('d.cutParts');
  expect(guide).toMatch(/Examples, readable with cad_script_example: .*cupboard/);
  const [cupboard] = texts(await client.callTool({ name: 'cad_script_example', arguments: { name: 'cupboard' } }));
  expect(cupboard).toContain("from '@wbcnc/cad-script'");
});

it('checks a design and writes it for CAM, then removes it when an edit breaks it', async () => {
  const plate = await readFile(path.join(packageDir, 'examples/plate.cad.ts'), 'utf8');
  const passed = await client.callTool({ name: 'check_design', arguments: { name: 'plate', source: plate } });
  expect(passed.isError).toBe(false);
  expect(JSON.parse(texts(passed)[0]!)).toMatchObject({ ok: true });
  expect(JSON.parse(await readFile(path.join(dir, 'plate.json'), 'utf8'))).toHaveProperty('parts');
  expect(await readFile(path.join(dir, 'plate.svg'), 'utf8')).toMatch(/^<svg /);
  expect(texts(await client.callTool({ name: 'read_design', arguments: { name: 'plate' } }))[0]).toBe(plate);

  const broken = await client.callTool({
    name: 'check_design',
    arguments: { name: 'plate', source: "export default () => { const value: number = 'invalid'; };" },
  });
  expect(broken.isError).toBe(true);
  expect(JSON.parse(texts(broken)[0]!)).toMatchObject({ ok: false, typeErrors: [expect.stringMatching(/^line 1:/)] });
  await expect(access(path.join(dir, 'plate.json'))).rejects.toMatchObject({ code: 'ENOENT' });
}, 60_000);

it('removes the last revision when a script throws before it runs', async () => {
  const plate = await readFile(path.join(packageDir, 'examples/plate.cad.ts'), 'utf8');
  expect((await client.callTool({ name: 'check_design', arguments: { name: 'thrown', source: plate } })).isError).toBe(false);
  const result = await client.callTool({
    name: 'check_design',
    arguments: { name: 'thrown', source: "throw new Error('top-level bug');\nexport default () => {};\n" },
  });
  expect(result.isError).toBe(true);
  expect(texts(result).join('\n')).toContain('top-level bug');
  await expect(access(path.join(dir, 'thrown.json'))).rejects.toMatchObject({ code: 'ENOENT' });
  await expect(access(path.join(dir, 'thrown.svg'))).rejects.toMatchObject({ code: 'ENOENT' });
}, 60_000);

it("says so when a design checks out but can't be written", async () => {
  const plate = await readFile(path.join(packageDir, 'examples/plate.cad.ts'), 'utf8');
  await mkdir(path.join(dir, 'blocked.json'));
  const result = await client.callTool({ name: 'check_design', arguments: { name: 'blocked', source: plate } });
  expect(result.isError).toBe(true);
  expect(texts(result).join('\n')).toMatch(/EISDIR/);
}, 60_000);

it('refuses a name that would reach outside its folder', async () => {
  const result = await client.callTool({ name: 'read_design', arguments: { name: '../secrets' } });
  expect(result.isError).toBe(true);
});
