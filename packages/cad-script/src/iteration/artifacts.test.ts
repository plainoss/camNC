import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createPlateDocument } from '@wbcnc/cad';
import { expect, it } from 'vitest';
import { runCadWorkflow } from './workflow';
import { writeWorkflowArtifacts } from './artifacts';

it('exports exact source bytes separately from candidate coordinates and names incomplete prefixes', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'cad-workflow-'));
  try {
    const result = await runCadWorkflow(
      {
        id: 'plate',
        name: 'Plate',
        create: () => createPlateDocument(),
        checkpoints: [
          {
            id: 'first',
            checks: [{ layer: 'geometry', description: 'One body exists.', expected: 1, actual: context => context.parts.length }],
          },
          { id: 'later', unsupported: 'Not implemented', checks: [] },
        ],
      },
      { through: 'first' }
    );
    const { manifest, report } = await writeWorkflowArtifacts(result, directory);
    expect(report.scope).toBe('prefix');
    const checkpoint = manifest.checkpoints[0];
    const source = await readFile(path.join(directory, checkpoint.sourceFile));
    expect(createHash('sha256').update(source).digest('hex')).toBe(checkpoint.sourceSha256);
    expect(checkpoint.sourceFile).not.toBe(checkpoint.solvedFile);
    expect(checkpoint.solvedCoordinates).toBe('candidate-derived');
    expect(JSON.parse(await readFile(path.join(directory, 'report.json'), 'utf8')).checkpoints).toHaveLength(1);
    expect(JSON.parse(await readFile(path.join(directory, 'checkpoints.json'), 'utf8')).scope).toBe('prefix');
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
