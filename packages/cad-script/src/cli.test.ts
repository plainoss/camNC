import { execFile } from 'node:child_process';
import { access, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, it, onTestFinished } from 'vitest';

const packageDir = fileURLToPath(new URL('../', import.meta.url));

function check(file: string, out: string, svg: string) {
  return new Promise<{ code: number; report: { ok: boolean; typeErrors?: string[]; scriptError?: string } }>((resolve, reject) => {
    execFile(
      process.execPath,
      ['node_modules/vite-node/vite-node.mjs', '--config', 'vite.config.ts', 'src/cli.ts', file, '--out', out, '--svg', svg],
      { cwd: packageDir },
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

async function outputs() {
  const dir = await mkdtemp(path.join(tmpdir(), 'cad-script-cli-'));
  onTestFinished(() => rm(dir, { recursive: true, force: true }));
  const out = path.join(dir, 'document.json');
  const svg = path.join(dir, 'drawing.svg');
  const passing = path.join(packageDir, 'examples/plate.cad.ts');
  expect(await check(passing, out, svg)).toEqual({ code: 0, report: expect.objectContaining({ ok: true }) });
  expect(JSON.parse(await readFile(out, 'utf8'))).toHaveProperty('parts');
  expect(await readFile(svg, 'utf8')).toMatch(/^<svg /);
  return { dir, out, svg };
}

it.each([
  ['typeErrors', "export default () => { const value: number = 'invalid'; };"],
  ['scriptError', "export default () => { throw new Error('script bug'); };"],
  ['scriptError', "throw new Error('top-level bug');\nexport default () => {};"],
])(
  'removes stale outputs after a %s failure and tolerates missing outputs',
  async (field, source) => {
    const { dir, out, svg } = await outputs();
    const file = path.join(dir, 'bad.cad.ts');
    const neighbor = path.join(dir, 'keep.json');
    await writeFile(file, source);
    await writeFile(neighbor, 'keep');

    for (let run = 0; run < 2; run++) {
      const { code, report } = await check(file, out, svg);
      expect(code).toBe(1);
      expect(report.ok).toBe(false);
      expect(report[field as 'typeErrors' | 'scriptError']).toBeTruthy();
      await expect(access(out)).rejects.toMatchObject({ code: 'ENOENT' });
      await expect(access(svg)).rejects.toMatchObject({ code: 'ENOENT' });
      expect(await readFile(neighbor, 'utf8')).toBe('keep');
    }
  },
  60000
);

it('removes the stale document but keeps a newly rendered SVG when expectations fail', async () => {
  const { dir, out, svg } = await outputs();
  const previousSvg = await readFile(svg, 'utf8');
  const file = path.join(dir, 'wrong-size.cad.ts');
  await writeFile(
    file,
    `import { design } from '@wbcnc/cad-script';
export default design(d => {
  const part = d.part('Small');
  part.profile.rect({ at: [0, 0], w: 40, h: 30 });
  part.expect({ size: [100, 80] });
});
`
  );

  const { code, report } = await check(file, out, svg);
  expect(code).toBe(1);
  expect(report.ok).toBe(false);
  await expect(access(out)).rejects.toMatchObject({ code: 'ENOENT' });
  const currentSvg = await readFile(svg, 'utf8');
  expect(currentSvg).toMatch(/^<svg /);
  expect(currentSvg).toContain('Small');
  expect(currentSvg).not.toBe(previousSvg);
}, 60000);

it('prints the full report of a saved design, as its golden report has it', async () => {
  const design = path.join(packageDir, 'fixtures/designs/tray.json');
  const stdout = await new Promise<string>((resolve, reject) =>
    execFile(
      process.execPath,
      ['node_modules/vite-node/vite-node.mjs', '--config', 'vite.config.ts', 'src/cli.ts', '--from', design, '--report', 'full'],
      { cwd: packageDir },
      (error, out) => (error ? reject(error) : resolve(out))
    )
  );
  expect(stdout).toBe(await readFile(design.replace(/\.json$/, '.report.json'), 'utf8'));
}, 60000);

it('says in the full report why a script editing a saved design stopped', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'cad-script-cli-'));
  onTestFinished(() => rm(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'bad.cad.ts');
  await writeFile(
    file,
    `import { design } from '@wbcnc/cad-script';
export default design(d => {
  d.part('Bad', { thickness: -1 });
});
`
  );
  const design = path.join(packageDir, 'fixtures/designs/tray.json');
  const { code, stdout } = await new Promise<{ code: number; stdout: string }>((resolve, reject) =>
    execFile(
      process.execPath,
      ['node_modules/vite-node/vite-node.mjs', '--config', 'vite.config.ts', 'src/cli.ts', file, '--from', design, '--report', 'full'],
      { cwd: packageDir },
      (error, out) => {
        const code = error?.code ?? 0;
        if (typeof code !== 'number') return reject(error);
        resolve({ code, stdout: out });
      }
    )
  );
  expect(code).toBe(1);
  const report = JSON.parse(stdout);
  expect(report).toMatchObject({ ok: false, status: 'solved', scriptError: expect.stringMatching(/thickness/i) });
  // The design is reported as it was before the script.
  expect(report.design.name).toBe('tray');
}, 60000);
