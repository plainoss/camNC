import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { access, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, it, onTestFinished } from 'vitest';
const packageDir = fileURLToPath(new URL('../../', import.meta.url));
async function directory() {
  const dir = await mkdtemp(path.join(tmpdir(), 'cad-iteration-cli-'));
  onTestFinished(() => rm(dir, { recursive: true, force: true }));
  return dir;
}
function run(args: string[], base: string) {
  return new Promise<{ code: number; report: any }>((resolve, reject) => {
    execFile(
      process.execPath,
      ['node_modules/vite-node/vite-node.mjs', '--config', 'vite.config.ts', 'src/iteration/cli.ts', ...args],
      { cwd: packageDir, env: { ...process.env, INIT_CWD: base }, maxBuffer: 4 * 1024 * 1024 },
      (error, stdout) => {
        const code = error?.code ?? 0;
        if (typeof code !== 'number') return reject(error);
        try {
          resolve({ code, report: JSON.parse(stdout) });
        } catch (error) {
          reject(error);
        }
      }
    );
  });
}
// These cases launch isolated Node processes; allow their startup under parallel package tests.
it('lists all available workflows without solving or writing artifacts, and filters an explicit selection', async () => {
  const base = await directory(),
    all = await run(['--list'], base);
  expect(all.code).toBe(0);
  expect(all.report.workflows.map((w: any) => w.key)).toEqual([
    'cupboard',
    'divided-tray',
    'fitted-joints',
    'radial-stool',
    'tray-missing-tool',
    'joint-unconstrained',
  ]);
  expect(all.report.workflows.slice(0, 3).every((w: any) => w.checkpoints.length === 8)).toBe(true);
  expect(all.report.workflows[3].checkpoints).toHaveLength(6);
  expect(all.report.workflows.slice(0, 4).every((w: any) => w.unsupportedCheckpoints.length === 0)).toBe(true);
  expect(all.report.workflows.slice(4).every((w: any) => w.unsupportedCheckpoints.length === 1)).toBe(true);
  const selected = await run(['--workflow', 'fitted-joints', '--list'], base);
  expect(selected.report.workflows.map((w: any) => w.key)).toEqual(['fitted-joints']);
  await expect(access(path.join(base, 'test-results'))).rejects.toThrow();
}, 20_000);
it('keeps cabinet default and separates another workflow output while naming a prefix honestly', async () => {
  const base = await directory(),
    cabinet = await run(['--through', 'assembled'], base);
  expect(cabinet).toMatchObject({ code: 0, report: { id: 'cupboard-regeneration', scope: 'prefix', status: 'passed' } });
  const cabinetFile = path.join(base, 'test-results/cad-iteration/core/report.json'),
    before = await readFile(cabinetFile, 'utf8');
  const joints = await run(['--workflow', 'fitted-joints', '--through', 'grow-finger-count'], base);
  expect(joints).toMatchObject({ code: 0, report: { id: 'fitted-joints-regeneration', scope: 'prefix', status: 'passed' } });
  expect(joints.report.checkpoints).toHaveLength(4);
  expect(joints.report.artifacts).toBe(path.join(base, 'test-results/cad-iteration/core/fitted-joints'));
  expect(await readFile(cabinetFile, 'utf8')).toBe(before);
}, 20_000);
it('exports the complete selected tray sources with exact hashes to an explicit output directory', async () => {
  const base = await directory(),
    out = path.join(base, 'tray-output'),
    result = await run(['--workflow', 'divided-tray', '--out', out], base);
  expect(result).toMatchObject({ code: 0, report: { id: 'divided-tray-regeneration', scope: 'complete', status: 'passed' } });
  expect(result.report.checkpoints).toHaveLength(8);
  const manifest = JSON.parse(await readFile(result.report.checkpointManifest, 'utf8'));
  const selected = manifest.checkpoints.find((c: any) => c.checkpointId === 'selected-third-divider'),
    bytes = await readFile(path.join(out, selected.sourceFile));
  expect(createHash('sha256').update(bytes).digest('hex')).toBe(selected.sourceSha256);
  expect(JSON.parse(bytes.toString()).partCuts[0].tools[0]).toMatch(/:2$/);
}, 20_000);
it('keeps incomplete diagnostics at exit2 and rejects unknown selectors as structured source failures', async () => {
  const base = await directory();
  const diagnostic = await run(['--workflow', 'tray-missing-tool'], base);
  expect(diagnostic).toMatchObject({
    code: 2,
    report: { status: 'unsupported', firstFailure: { checkpoint: 'missing-selected-tool', layer: 'source' } },
  });
  const unknown = await run(['--workflow', 'not-a-workflow'], base);
  expect(unknown).toMatchObject({ code: 1, report: { status: 'failed', scope: 'incomplete', firstFailure: { layer: 'source' } } });
  expect(unknown.report.firstFailure.message).toContain('divided-tray');
}, 20_000);
