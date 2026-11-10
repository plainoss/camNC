import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { createCadDocument } from '@wbcnc/cad';
import { describe, expect, it } from 'vitest';
import { editCad } from '../edit';
import { assessCadTask } from './assess';
import { cadSavedTask, cadSavedTasks } from './catalogue';
import { cadTaskDirectory, loadCadTaskStart, recordedCadTaskModel } from './files';
import { compareCadTaskRuns, runCadTask } from './run';
import type { CadSavedTask, CadTaskCandidate, CadTaskModel } from './types';

const task: CadSavedTask = {
  id: 'test',
  request: 'A board.',
  source: 'whole-piece-requirement',
  start: null,
  outcomes: ['The check passes.'],
  review: [],
};
const candidate = (document = createCadDocument()): CadTaskCandidate => ({
  document,
  ok: true,
  parts: [],
  report: { ok: true, status: 'solved', errors: [], warnings: [], parts: [] },
});
const model = (next: CadTaskModel['next']): CadTaskModel => ({ id: 'test-model', next });

describe('saved modelling tasks', () => {
  it('keeps nine verbatim historical turns and three whole-piece inputs, all self-contained', async () => {
    expect(
      cadSavedTasks
        .filter(task => task.source === 'chat-trial')
        .map(task => task.id)
        .sort()
    ).toEqual(['A1', 'A2', 'A3', 'B1', 'B2', 'C1', 'C2', 'C3', 'H1']);
    expect(cadSavedTasks.filter(task => task.source === 'whole-piece-requirement')).toHaveLength(3);
    expect(new Set(cadSavedTasks.map(task => task.id)).size).toBe(cadSavedTasks.length);
    for (const task of cadSavedTasks) {
      expect(task.outcomes.length).toBeGreaterThan(0);
      if (task.start) expect((await loadCadTaskStart(task))?.parts.length).toBeGreaterThan(0);
      for (const attachment of task.attachments ?? [])
        expect((await readFile(new URL(attachment.file, cadTaskDirectory), 'utf8')).length).toBeGreaterThan(0);
    }
    expect(cadSavedTask('A1').request).toBe(cadSavedTask('H1').request);
    expect(() => cadSavedTask('missing')).toThrow('Unknown saved task');
  });

  it('replays a valid resize against geometric outcomes and preserved IDs', async () => {
    const saved = cadSavedTask('A1');
    const input = await loadCadTaskStart(saved);
    const original = JSON.stringify(input);
    const result = await runCadTask(saved, input, await recordedCadTaskModel(saved), {
      check: async (file, start) => editCad(start, (await import(/* @vite-ignore */ pathToFileURL(file).href)).default),
    });
    expect(result.status).toBe('passed');
    expect(result.checks).toBe(1);
    expect(result.assessment?.checks.every(check => check.passed)).toBe(true);
    expect(JSON.stringify(input)).toBe(original);
  }, 60_000);

  it('rejects a passing check that drops all bench housings', async () => {
    const saved = cadSavedTask('B2');
    const start = await loadCadTaskStart(saved);
    const file = new URL('recordings/B2/offer.cad.ts', cadTaskDirectory);
    const output = await editCad(start, (await import(/* @vite-ignore */ file.href)).default);
    expect(output.ok).toBe(true);
    const assessment = assessCadTask(saved, start, output);
    expect(assessment.automaticPass).toBe(false);
    expect(assessment.checks.find(check => check.description.includes('housings'))?.passed).toBe(false);
  }, 60_000);

  it('distinguishes required human review from a verified pass', async () => {
    let turns = 0;
    const run = await runCadTask(
      { ...task, review: ['A person compares the outline with the picture.'] },
      null,
      model(async () => (++turns === 1 ? { kind: 'check', script: 'first' } : { kind: 'propose', message: 'Here it is.' })),
      { check: async () => candidate() }
    );
    expect(run.status).toBe('needs-review');
    expect(compareCadTaskRuns([run])[0].outcomes).toMatchObject({ passed: 0, 'needs-review': 1 });
  });

  it('rejects a second cupboard proposal that changes the first through an external cut-parts step', async () => {
    const saved = cadSavedTask('A3'),
      start = (await loadCadTaskStart(saved))!;
    const unchanged = await editCad(start, () => {});
    expect(assessCadTask(saved, start, unchanged).checks.find(check => check.description.includes('evaluated geometry'))?.passed).toBe(
      true
    );
    const changed = structuredClone(unchanged);
    changed.parts[0].holes.push([
      { x: 50, y: 50 },
      { x: 60, y: 50 },
      { x: 60, y: 60 },
      { x: 50, y: 60 },
    ]);
    const assessment = assessCadTask(saved, start, changed);
    expect(changed.document.parts).toEqual(unchanged.document.parts);
    expect(assessment.checks.find(check => check.description.includes('evaluated geometry'))?.passed).toBe(false);
  }, 60_000);

  it('rejects blind pockets added to untouched siblings even when only the middle shelf has a cable hole', async () => {
    const saved = cadSavedTask('A2'),
      start = (await loadCadTaskStart(saved))!;
    const correct = await editCad(start, d => {
      const copy = d.existingCopy('Shelf 2'),
        sketch = copy.sketchOn('top');
      sketch.circle({ at: [400, 244], d: 60 });
      copy.cut(sketch.regionAt(400, 244), { depth: 'through' });
    });
    expect(correct.ok).toBe(true);
    expect(assessCadTask(saved, start, correct).automaticPass).toBe(true);
    const damaged = await editCad(correct.document, d => {
      const shelf = d.part('Shelf'),
        sketch = shelf.sketchOn('top');
      sketch.circle({ at: [100, 100], d: 10 });
      shelf.cut(sketch.regionAt(100, 100), { depth: 3 });
    });
    expect(damaged.ok).toBe(true);
    const assessment = assessCadTask(saved, start, damaged);
    expect(assessment.checks.find(check => check.description.includes('Only the middle'))?.passed).toBe(true);
    expect(assessment.checks.find(check => check.description.includes('complete original material'))?.passed).toBe(false);
    expect(assessment.automaticPass).toBe(false);
  }, 60_000);
});

describe('bounded headless assistant loop', () => {
  it('repairs against a fresh copy of the original and supplies feedback', async () => {
    const start = createCadDocument('Original');
    let turns = 0;
    const seen: string[] = [];
    const run = await runCadTask(
      task,
      start,
      model(async context => {
        turns++;
        if (turns === 2) expect(context.feedback[0]).toMatchObject({ kind: 'error', attempt: 1, message: 'Bad option.' });
        return turns < 3 ? { kind: 'check', script: `try ${turns}` } : { kind: 'propose', message: 'Corrected.' };
      }),
      {
        check: async (_, source) => {
          seen.push(source!.name);
          source!.name = 'Mutated attempt';
          if (seen.length === 1) throw new Error('Bad option.');
          return candidate(source!);
        },
      }
    );
    expect(run.status).toBe('passed');
    expect(run.checks).toBe(2);
    expect(seen).toEqual(['Original', 'Original']);
    expect(start.name).toBe('Original');
  });

  it('stops repeated checks at the budget and never fabricates a proposal', async () => {
    let checks = 0;
    const run = await runCadTask(
      task,
      null,
      model(async () => ({ kind: 'check', script: 'again' })),
      {
        maxChecks: 2,
        check: async () => {
          checks++;
          return candidate();
        },
      }
    );
    expect(run.status).toBe('exhausted');
    expect(run.checks).toBe(2);
    expect(checks).toBe(2);
  });

  it('permits a question without executing a script', async () => {
    const run = await runCadTask(
      cadSavedTask('stool'),
      null,
      model(async () => ({ kind: 'question', message: 'What height and seat size do you want?' })),
      {
        check: async () => {
          throw new Error('Must not execute');
        },
      }
    );
    expect(run.status).toBe('question');
    expect(run.checks).toBe(0);
  });

  it('cannot offer a failed check or an old good candidate after a bad repair', async () => {
    for (const failure of ['returned', 'thrown']) {
      let turns = 0;
      let checks = 0;
      const run = await runCadTask(
        task,
        null,
        model(async () => (++turns <= 2 ? { kind: 'check', script: 'attempt' } : { kind: 'propose', message: 'Done.' })),
        {
          check: async () => {
            if (++checks === 1) return candidate();
            if (failure === 'thrown') throw new Error('Stopped');
            return { ...candidate(), ok: false, scriptError: 'Stopped' };
          },
        }
      );
      expect(run.status).toBe('failed');
    }
  });

  it('does not execute after cancellation while waiting for a model', async () => {
    const controller = new AbortController();
    let checks = 0;
    const run = await runCadTask(
      task,
      null,
      model(async () => {
        controller.abort();
        return { kind: 'check', script: 'late' };
      }),
      {
        signal: controller.signal,
        check: async () => {
          checks++;
          return candidate();
        },
      }
    );
    expect(run.status).toBe('cancelled');
    expect(checks).toBe(0);
  });

  it('rejects invalid budgets and records provider failures', async () => {
    const broken = model(async () => {
      throw new Error('Provider unavailable');
    });
    await expect(runCadTask(task, null, broken, { maxChecks: 0, check: async () => candidate() })).rejects.toThrow('maxChecks');
    expect((await runCadTask(task, null, broken, { check: async () => candidate() })).status).toBe('error');
  });
});
