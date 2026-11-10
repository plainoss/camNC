import { parseCadDocument } from '@wbcnc/cad';
import { expect, it } from 'vitest';
import { cadSavedTask } from '../../../../../packages/cad-script/src/tasks/catalogue';
import startJson from '../../../../../packages/cad-script/fixtures/designs/task-start-bookshelf-with-pins.json?raw';
import { benchmarkAssistantTask } from './taskBenchmark';
import { checkScriptInBrowser } from './scriptCheck';
import { defaultProvider } from './keyStore';

// Independently authored from assistantGuide and its editing/variables help, without
// recordings or assessor implementation. This deterministic adapter proves plumbing,
// browser execution and context retention; it does not measure a live model's ability.
const stockChange = "d => { d.variable('board', '15mm'); }";
const explanation =
  'Proposal: Structural boards are now 15 mm; the back remains 6 mm. ' +
  'The geometry solves without material collisions. The existing 12 mm pin holes leave a 3 mm floor. ' +
  'Human review of strength, pin support and edge clearances remains required; geometry alone does not prove strength. ' +
  'The inherited design still has housings for all four shelves, so the earlier request for only the second shelf to be fixed is not yet satisfied. ' +
  'Review those inherited joints and the reported CNC corner warnings before applying.';

interface ModelReport {
  report?: {
    parts: { name: string; thickness: number; cuts: { ref: string; from: number; to: number }[] }[];
    assembly: { collisions: unknown[] };
  };
}

it('retains prior back thickness and reports pin-hole floor after a stock change', async () => {
  const task = cadSavedTask('C3');
  const start = parseCadDocument(JSON.parse(startJson));
  const controller = new AbortController();
  let turn = 0;
  const result = await benchmarkAssistantTask(task, start, {
    config: { ...defaultProvider, model: 'independent-script-replay' },
    key: 'no-provider',
    signal: controller.signal,
    examples: {},
    reuseTrustedCheckResults: true,
    check: (source, base, signal) => checkScriptInBrowser(base, source, { signal }),
    request: async request => {
      // The latest stock request must not replace the earlier dimensions, back or pins.
      expect(request.messages.filter(message => message.role === 'user').map(message => message.text)).toEqual([
        ...task.history!.map(message => message.content),
        task.request,
      ]);
      if (turn++ === 0)
        return {
          role: 'assistant',
          text: '',
          calls: [{ id: 'editing-help', name: 'cad_script_guide', arguments: { section: 'editing' } }],
        };
      if (turn === 2)
        return {
          role: 'assistant',
          text: '',
          calls: [{ id: 'stock-edit', name: 'check_design', arguments: { source: stockChange } }],
        };
      const feedback = request.messages.find(message => message.callId === 'stock-edit');
      const checked = JSON.parse(feedback!.text) as ModelReport;
      expect(checked.report?.parts.find(part => part.name === 'Back')?.thickness).toBe(6);
      const side = checked.report?.parts.find(part => part.name === 'Side');
      expect(side?.thickness).toBe(15);
      expect(side!.thickness - side!.cuts.find(cut => cut.to === 12)!.to).toBe(3);
      expect(checked.report?.assembly.collisions).toEqual([]);
      // The legacy start has all four housings despite the earlier pin request. C3's
      // automatic checks do not assess that inherited defect; keep it visible here.
      expect(side!.cuts.filter(cut => /^Shelf(?: [234])?$/.test(cut.ref))).toHaveLength(4);
      return { role: 'assistant', text: explanation };
    },
  });
  expect(result.result.status).toBe('proposal');
  expect(result.result.checks).toBe(1);
  expect(turn).toBe(3);
  expect(result.assessment?.automaticPass).toBe(true);
  expect(result.assessment?.review).toEqual(task.review);
  expect(result.assessment?.review).toHaveLength(1);
  expect(result.result.messages.at(-1)?.text).toContain('Human review of strength');
  expect(result.result.messages.at(-1)?.text).toContain('not yet satisfied');
  expect(start).toEqual(JSON.parse(startJson));
}, 60_000);
