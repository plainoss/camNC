import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { expect, it, onTestFinished } from 'vitest';
import { parseCadDocument } from '@wbcnc/cad';
import { spatialReportFixture } from './spatialReport.testFixtures';

it('checks imported ordered copies and writes raw source plus the actual physical and CAM drawings', async () => {
  const f = spatialReportFixture(),
    directory = await mkdtemp(path.join(tmpdir(), 'cad-spatial-report-'));
  onTestFinished(() => rm(directory, { recursive: true, force: true }));
  const input = path.join(directory, 'source.json'),
    out = path.join(directory, 'saved.json'),
    svg = path.join(directory, 'flat.svg'),
    views = path.join(directory, 'views');
  const text = `${JSON.stringify(f.source, null, 1)}\n`;
  await writeFile(input, text);
  const result = await promisify(execFile)(
    process.execPath,
    [
      'node_modules/vite-node/vite-node.mjs',
      '--config',
      'vite.config.ts',
      'src/cli.ts',
      '--from',
      input,
      '--out',
      out,
      '--svg',
      svg,
      '--views',
      views,
      '--report',
      'full',
    ],
    { cwd: fileURLToPath(new URL('../', import.meta.url)), maxBuffer: 2 * 1024 * 1024 }
  );
  const report = JSON.parse(result.stdout);
  expect(report.ok, JSON.stringify(report.errors)).toBe(true);
  expect(report.spatial.physical.find((body: { id: string }) => body.id === f.reference).placement.position).toEqual([500, 0, 0]);
  expect(report.spatial.operationOrder).toEqual([f.first, f.move, f.second, f.consume]);
  expect(report.views[0].bounds).toEqual({ at: [0, -5], size: [600, 65] });
  const flat = await readFile(svg, 'utf8');
  expect(flat).toContain('Panel 3');
  expect(flat).toContain('class="notch"');
  expect(flat).not.toContain('Knife A');
  expect(await readFile(path.join(views, 'top.svg'), 'utf8')).toContain('data-body="Panel 3"');
  const saved = parseCadDocument(JSON.parse(await readFile(out, 'utf8')));
  expect(saved.parts[0]!.copies![1]!.placement!.position).toEqual([400, 0, 0]);
  expect(saved.parts[0]!.pattern).toEqual(f.source.parts[0]!.pattern);
  expect(saved.copyTransforms).toEqual(f.source.copyTransforms);
  expect(saved.parts.some(part => part.id === f.toolA)).toBe(true);
  expect(await readFile(input, 'utf8')).toBe(text);
}, 60000);
