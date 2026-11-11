import { createPlateDocument, parseCadDocument } from '@wbcnc/cad';
import { inspectCadDocument } from '@wbcnc/cad-script';
import { beforeEach, expect, it, vi } from 'vitest';
import { cadSavedTask } from '../../../../../packages/cad-script/src/tasks/catalogue';
import { assessCadTask } from '../../../../../packages/cad-script/src/tasks/assess';
import startJson from '../../../../../packages/cad-script/fixtures/designs/task-start-cupboard-three-shelves.json?raw';
import { benchmarkAssistantTask } from './taskBenchmark';
import { checkScriptInBrowser } from './scriptCheck';
import { defaultProvider } from './keyStore';
import type { AssistantMessage } from './provider';
import { runDesignAssistant } from './loop';
import { createAssistantUsage } from './runBudget';
import type { CadTaskCandidate, CadSavedTask } from '../../../../../packages/cad-script/src/tasks/types';

vi.mock('@wbcnc/cad-script', async importOriginal => {
  const actual = await importOriginal<typeof import('@wbcnc/cad-script')>();
  return { ...actual, inspectCadDocument: vi.fn(actual.inspectCadDocument) };
});
vi.mock('./loop', { spy: true });
beforeEach(() => vi.clearAllMocks());

it('assesses the offered cached candidate rather than the last executed script', async () => {
  const source = parseCadDocument(JSON.parse(startJson));
  const calls = ['d => {}', 'd => { d.variable("width", "600mm"); }', 'd => {}'];
  let next = 0;
  const benchmark = await benchmarkAssistantTask(cadSavedTask('A1'), source, {
    config: { ...defaultProvider, model: 'recorded' },
    key: 'recorded',
    signal: new AbortController().signal,
    examples: {},
    reuseTrustedCheckResults: true,
    check: (script, base, signal) => checkScriptInBrowser(base, script, { signal }),
    request: async (): Promise<AssistantMessage> => {
      const script = calls[next++];
      return script === undefined
        ? { role: 'assistant', text: 'Proposal: 800 mm wide, 900 mm tall and three evenly spaced shelves.' }
        : { role: 'assistant', text: '', calls: [{ id: String(next), name: 'check_design', arguments: { source: script } }] };
    },
  });
  expect(inspectCadDocument).toHaveBeenCalledTimes(3);
  expect(benchmark.result.status).toBe('proposal');
  expect(benchmark.result.checks).toBe(2);
  expect(benchmark.result.usage.reusedChecks).toBe(1);
  expect(benchmark.assessment?.automaticPass).toBe(true);
  expect(benchmark.assessment?.checks.find(check => check.description.startsWith('Width is'))?.passed).toBe(true);
  // The caller's saved design is never mutated, even by the intermediate rejected result.
  expect(source).toEqual(JSON.parse(startJson));
  // Initial context and two isolated trusted checks suffice; assessment reuses the exact offered candidate.
}, 120_000);

const smallTask: CadSavedTask = {
  id: 'benchmark-regression',
  request: 'Review this plate.',
  start: null,
  source: 'chat-trial',
  outcomes: [],
  review: [],
};
const benchmarkOptions = () => ({
  config: { ...defaultProvider, model: 'recorded' },
  key: 'recorded',
  signal: new AbortController().signal,
  examples: {},
});

it('retains an independent successful candidate when a later failed check returns the same document', async () => {
  const start = createPlateDocument();
  const trusted = await inspectCadDocument(start);
  const offered = structuredClone(trusted.document);
  const original: CadTaskCandidate = { ...structuredClone(trusted), ok: true };
  vi.mocked(inspectCadDocument).mockClear();
  vi.mocked(runDesignAssistant).mockImplementationOnce(async options => {
    await options.check('valid', start, options.signal);
    original.document.name = 'Mutated after checking';
    original.report.ok = false;
    original.parts.splice(0);
    await options.check('invalid', structuredClone(offered), options.signal);
    return {
      status: 'proposal',
      messages: [{ role: 'assistant', text: 'Proposal: checked.' }],
      checks: 2,
      usage: createAssistantUsage(),
      proposal: { base: start, document: structuredClone(offered) },
    };
  });
  let attempt = 0;
  const result = await benchmarkAssistantTask(smallTask, start, {
    ...benchmarkOptions(),
    reuseTrustedCheckResults: true,
    check: async () =>
      attempt++ === 0 ? original : { ...original, document: structuredClone(offered), ok: false, scriptError: 'Failed check' },
  });
  expect(result.assessment?.automaticPass).toBe(true);
  expect(inspectCadDocument).toHaveBeenCalledTimes(1);
});

it('inspects the offered document when it does not match a trusted successful check', async () => {
  const start = createPlateDocument();
  const offered = { ...start, name: 'Different offered document' };
  const trusted = await inspectCadDocument(start);
  vi.mocked(inspectCadDocument).mockClear();
  vi.mocked(runDesignAssistant).mockImplementationOnce(async options => {
    await options.check('checked original', start, options.signal);
    return {
      status: 'proposal',
      messages: [{ role: 'assistant', text: 'Proposal: checked.' }],
      checks: 1,
      usage: createAssistantUsage(),
      proposal: { base: start, document: offered },
    };
  });
  const result = await benchmarkAssistantTask(smallTask, start, {
    ...benchmarkOptions(),
    reuseTrustedCheckResults: true,
    check: async () => ({ ...trusted, ok: true }),
  });
  expect(result.assessment?.automaticPass).toBe(true);
  expect(inspectCadDocument).toHaveBeenCalledTimes(2);
  expect(vi.mocked(inspectCadDocument).mock.calls[1][0]).toEqual(offered);
});

it('independently assesses custom adapter results by default when report and geometry disagree', async () => {
  const start = createPlateDocument();
  const unrelated = await inspectCadDocument(parseCadDocument(JSON.parse(startJson)));
  const plate = await inspectCadDocument(start);
  const forged: CadTaskCandidate = {
    ...unrelated,
    document: structuredClone(start),
    report: { ...unrelated.report, parts: plate.report.parts },
    ok: true,
  };
  const task = cadSavedTask('A1');
  // This unrelated cupboard assembly report would falsely pass the plate if custom callback results were trusted by default.
  expect(assessCadTask(task, start, forged).automaticPass).toBe(true);
  vi.mocked(inspectCadDocument).mockClear();
  let turn = 0;
  const result = await benchmarkAssistantTask(task, start, {
    ...benchmarkOptions(),
    check: async () => forged,
    request: async () =>
      turn++ === 0
        ? { role: 'assistant', text: '', calls: [{ id: 'forged', name: 'check_design', arguments: { source: 'd => {}' } }] }
        : { role: 'assistant', text: 'Proposal: this is a cupboard.' },
  });
  expect(result.result.status).toBe('proposal');
  expect(result.assessment?.automaticPass).toBe(false);
  expect(result.assessment?.checks.find(check => check.description.startsWith('Width is'))?.passed).toBe(false);
  expect(inspectCadDocument).toHaveBeenCalledTimes(2);
  expect(vi.mocked(inspectCadDocument).mock.calls[1][0]).toEqual(result.result.proposal?.document);
}, 60_000);
