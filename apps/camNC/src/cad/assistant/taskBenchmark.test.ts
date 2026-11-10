import { parseCadDocument } from '@wbcnc/cad';
import { expect, it } from 'vitest';
import { cadSavedTask } from '../../../../../packages/cad-script/src/tasks/catalogue';
import startJson from '../../../../../packages/cad-script/fixtures/designs/task-start-cupboard-three-shelves.json?raw';
import { benchmarkAssistantTask } from './taskBenchmark';
import { checkScriptInBrowser } from './scriptCheck';
import { defaultProvider } from './keyStore';
import type { AssistantMessage } from './provider';

it('assesses the offered cached candidate rather than the last executed script', async () => {
  const source = parseCadDocument(JSON.parse(startJson));
  const calls = ['d => {}', 'd => { d.variable("width", "600mm"); }', 'd => {}'];
  let next = 0;
  const benchmark = await benchmarkAssistantTask(cadSavedTask('A1'), source, {
    config: { ...defaultProvider, model: 'recorded' },
    key: 'recorded',
    signal: new AbortController().signal,
    examples: {},
    check: (script, base, signal) => checkScriptInBrowser(base, script, { signal }),
    request: async (): Promise<AssistantMessage> => {
      const script = calls[next++];
      return script === undefined
        ? { role: 'assistant', text: 'Proposal: 800 mm wide, 900 mm tall and three evenly spaced shelves.' }
        : { role: 'assistant', text: '', calls: [{ id: String(next), name: 'check_design', arguments: { source: script } }] };
    },
  });
  expect(benchmark.result.status).toBe('proposal');
  expect(benchmark.result.checks).toBe(2);
  expect(benchmark.result.usage.reusedChecks).toBe(1);
  expect(benchmark.assessment?.automaticPass).toBe(true);
  expect(benchmark.assessment?.checks.find(check => check.description.startsWith('Width is'))?.passed).toBe(true);
  // The caller's saved design is never mutated, even by the intermediate rejected result.
  expect(source).toEqual(JSON.parse(startJson));
}, 30_000);
