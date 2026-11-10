import { readFile, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { parseCadDocument } from '@wbcnc/cad';
import type { CadSavedTask, CadTaskAction, CadTaskModel } from './types';

export const cadTaskDirectory = new URL('../../fixtures/tasks/', import.meta.url);

export async function loadCadTaskStart(task: CadSavedTask) {
  return task.start ? parseCadDocument(JSON.parse(await readFile(new URL(task.start, cadTaskDirectory), 'utf8'))) : null;
}

/** Replays the recorded attempts in their original order, through the current API and checker. */
export async function recordedCadTaskModel(task: CadSavedTask): Promise<CadTaskModel> {
  if (!task.recording) throw new Error(`Task ${task.id} has no recorded model run.`);
  const directory = new URL(`${task.recording.directory}/`, cadTaskDirectory);
  const attempts = (await readdir(directory)).filter(file => /^\d+\.cad\.ts$/.test(file)).sort((a, b) => parseInt(a) - parseInt(b));
  let next = 0;
  return {
    id: task.recording.model,
    async next(): Promise<CadTaskAction> {
      const file = attempts[next++];
      if (!file) return { kind: 'propose', message: 'Recorded offer; the saved outcomes decide whether it meets the request.' };
      return { kind: 'check', script: fileURLToPath(new URL(file, directory)) };
    },
  };
}
