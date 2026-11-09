import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { WorkflowResult } from './workflow';

/** Exact source snapshots are separate from candidate-derived output, so reference tools cannot confuse them. */
export async function writeWorkflowArtifacts(result: WorkflowResult, directory: string) {
  await mkdir(directory, { recursive: true });
  const checkpoints = [];
  for (const row of result.checkpoints) {
    if (!/^[a-z0-9-]+$/.test(row.id)) throw new Error(`Checkpoint ID is not a safe artifact name: ${row.id}`);
    const sourceFile = `${row.id}.source.json`;
    const solvedFile = row.solvedDocument ? `${row.id}.candidate.json` : undefined;
    await writeFile(path.join(directory, sourceFile), row.sourceText);
    if (solvedFile) await writeFile(path.join(directory, solvedFile), `${JSON.stringify(row.solvedDocument, null, 1)}\n`);
    checkpoints.push({
      workflowId: result.id,
      checkpointId: row.id,
      status: row.status,
      sourceFile,
      sourceSha256: row.sourceSha256,
      ...(solvedFile && { solvedFile, solvedCoordinates: row.solvedCoordinates }),
      bodies: row.bodies,
    });
  }
  const manifest = { version: 1, workflowId: result.id, status: result.status, scope: result.scope, checkpoints };
  const report = {
    id: result.id,
    name: result.name,
    status: result.status,
    scope: result.scope,
    totalMs: result.totalMs,
    firstFailure: result.firstFailure ?? null,
    checkpoints: result.checkpoints.map(row => ({ id: row.id, status: row.status, checks: row.checks, timings: row.timings })),
  };
  await writeFile(path.join(directory, 'checkpoints.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  await writeFile(path.join(directory, 'report.json'), `${JSON.stringify(report, null, 2)}\n`);
  return { manifest, report };
}
