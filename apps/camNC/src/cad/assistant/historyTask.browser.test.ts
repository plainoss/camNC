import { parseCadDocument } from '@wbcnc/cad';
import { expect, it } from 'vitest';
import { cadSavedTask } from '../../../../../packages/cad-script/src/tasks/catalogue';
import startJson from '../../../../../packages/cad-script/fixtures/designs/task-start-bookshelf-with-pins.json?raw';
import { benchmarkAssistantTask } from './taskBenchmark';
import { checkScriptInBrowser } from './scriptCheck';
import { defaultProvider } from './keyStore';

it('preserves earlier bookshelf constraints when structural board stock changes', async () => {
  const task = cadSavedTask('C3');
  let turn = 0;
  const result = await benchmarkAssistantTask(task, parseCadDocument(JSON.parse(startJson)), {
    config: { ...defaultProvider, model: 'independent-script-replay' },
    key: 'no-provider',
    signal: new AbortController().signal,
    examples: {},
    check: (source, base, signal) => checkScriptInBrowser(base, source, { signal }),
    request: async request => {
      console.log('MODEL REQUEST', request.system, JSON.stringify(request.messages), JSON.stringify(request.tools));
      return turn++ === 0
        ? {
            role: 'assistant',
            text: '',
            calls: [{ id: 'edit', name: 'check_design', arguments: { source: "d => { d.variable('board', '15mm'); }" } }],
          }
        : {
            role: 'assistant',
            text: 'Structural board changed to 15 mm. The back remains 6 mm. The existing 12 mm pin holes leave a 3 mm floor; human strength review remains required, including edge clearances.',
          };
    },
  });
  console.log('RESULT', JSON.stringify(result));
  expect(result.assessment?.automaticPass).toBe(true);
}, 60_000);
