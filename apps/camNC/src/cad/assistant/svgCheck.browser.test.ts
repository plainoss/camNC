import { createPlateDocument, type CadDocument } from '@wbcnc/cad';
import { cadProposalRefusal } from '@wbcnc/cad-editor/proposal';
import { cadSession } from '@wbcnc/cad-editor/session';
import { afterEach, expect, it, vi } from 'vitest';
import { documentSvgAssets, releaseSvgAssets, svgAssetsForDocument } from '../svg/svgAssets';
import { defaultProvider } from './keyStore';
import { runDesignAssistant, type AssistantCheck, type AssistantRunOptions } from './loop';
import type { AssistantMessage } from './provider';
import { finalizeBrowserCandidate } from './finalizeCandidate';
import { bindProposalRequirements, confirmRequirements, requirementProposalRefusal } from './requirementStore';
import { checkAssistantSvg } from './svgCheck';

const source =
  '<svg xmlns="http://www.w3.org/2000/svg" width="100mm" height="50mm" viewBox="0 0 100 50"><rect width="100" height="50"/></svg>';
const input = { source, partName: 'Imported tray', thickness: 24, placement: { width: 280, height: 190, preserveAspect: false } };
const call = (name: string, args: Record<string, unknown> = {}): AssistantMessage => ({
  role: 'assistant',
  text: '',
  calls: [{ id: crypto.randomUUID(), name, arguments: args }],
});
const proposal: AssistantMessage = { role: 'assistant', text: 'Proposal: the measured imported outline is ready for review.' };
const signal = () => new AbortController().signal;
afterEach(() => documentSvgAssets.clear());

function recorded(base: CadDocument, replies: AssistantMessage[], requirements: AssistantRunOptions['requirements'] = {}) {
  const finalize = vi.fn(async (checked: AssistantCheck, abort: AbortSignal) => {
    const full = await finalizeBrowserCandidate({ ...checked, report: checked.trustedReport!, parts: checked.parts ?? [] }, abort);
    return { ...full, trustedReport: full.report };
  });
  const svgCheck = vi.fn(
    (args: Record<string, unknown>, abort: AbortSignal, options: { views: boolean | readonly ('top' | 'front' | 'right')[] }) =>
      checkAssistantSvg(base, args, abort, options.views)
  );
  const options: AssistantRunOptions = {
    base,
    config: { ...defaultProvider, model: 'recorded-svg', images: false },
    key: '',
    context: '',
    guide: '',
    examples: {},
    requirements,
    messages: [{ role: 'user', text: 'Import the agreed outline beside my current part.' }],
    signal: signal(),
    finalize,
    svg: { assets: svgAssetsForDocument(base.id).list(), check: svgCheck },
    check: vi.fn(async () => {
      throw new Error('Data-only SVG tools must not evaluate JavaScript.');
    }),
    request: vi.fn(async () => {
      const next = replies.shift();
      if (!next) throw new Error('Unexpected provider request.');
      return next;
    }),
  };
  return { options, finalize, svgCheck };
}

it('checks data-only names, reuses the document asset without XML, finalizes and retains proposal guards', async () => {
  const base = createPlateDocument(),
    original = structuredClone(base);
  const name = 'Tray "); globalThis.svgInjected = true; //';
  const confirmed = confirmRequirements(base.id, { part: name, width: 280, height: 190, thickness: 24, preserveExistingIds: true });
  const setup = recorded(base, [], confirmed.requirements);
  let turn = 0;
  setup.options.request = async request => {
    const step = turn++;
    if (step === 0) return call('check_svg', { ...input, partName: name, name: 'Asset "); throw new Error("injected"); //' });
    const last = request.messages.findLast(message => message.role === 'tool');
    if (step === 1) {
      const result = JSON.parse(last!.text);
      expect(result).toMatchObject({ ok: true, stage: 'geometry-only', asset: { handle: expect.any(String) } });
      expect(last!.text).not.toContain('xmlns=');
      return call('check_svg', { handle: result.asset.handle, partName: name, thickness: 24, placement: input.placement });
    }
    if (step === 2) return call('finalize_design');
    return proposal;
  };
  const result = await runDesignAssistant(setup.options);
  expect(result.status, JSON.stringify(result.messages)).toBe('proposal');
  expect(result.proposal).toBeDefined();
  expect(setup.options.check).not.toHaveBeenCalled();
  expect(setup.svgCheck).toHaveBeenCalledTimes(2);
  expect(setup.finalize).toHaveBeenCalledTimes(1);
  expect(svgAssetsForDocument(base.id).list()).toHaveLength(1);
  expect(result.proposal!.document.parts).toHaveLength(base.parts.length + 1);
  expect(result.proposal!.document.parts.find(part => part.name === name)?.thickness).toBe(24);
  expect(result.proposal!.document.parts[0]).toEqual(base.parts[0]);
  expect(base).toEqual(original);
  expect((globalThis as typeof globalThis & { svgInjected?: boolean }).svgInjected).toBeUndefined();
  const session = cadSession(base);
  expect(cadProposalRefusal(session, result.proposal!)).toBeNull();
  session.document = { ...session.document, revision: session.document.revision + 2 };
  expect(cadProposalRefusal(session, result.proposal!)).toMatch(/design has changed/);
  bindProposalRequirements(result.proposal!, confirmed.revision);
  confirmRequirements(base.id, { ...confirmed.requirements, width: 300 });
  expect(requirementProposalRefusal(result.proposal!)).toMatch(/requirements changed/);
});

it('rejects scripts, resources, malformed fields and executable parameter objects without editor mutation', async () => {
  const base = createPlateDocument(),
    original = structuredClone(base);
  const accessor = Object.defineProperty({}, 'width', {
    enumerable: true,
    get() {
      throw new Error('Accessor executed');
    },
  });
  const at = Object.defineProperty([0, 0], '0', {
    enumerable: true,
    get() {
      throw new Error('Accessor executed');
    },
  });
  for (const args of [
    { source: source.replace('<rect', '<script>globalThis.svgInjected=true</script><rect') },
    { source: source.replace('<rect', '<image href="https://example.org/private.svg"/><rect') },
    { ...input, source: undefined, handle: 'bad' },
    { ...input, requirements: {} },
    { ...input, apply: true },
    { ...input, partName: 'Bad\nname' },
    { ...input, thickness: 0 },
    { ...input, thickness: Infinity },
    { ...input, placement: { ...input.placement, source: 'd => {}' } },
    { ...input, placement: { width: '280' } },
    { ...input, placement: { preserveAspect: 'false' } },
    { ...input, placement: accessor },
    { ...input, placement: { at } },
  ])
    await expect(checkAssistantSvg(base, args, signal(), false)).rejects.toThrow();
  expect(base).toEqual(original);
});

it('rejects cross-document, released-session and nonexistent SVG handles', async () => {
  const base = createPlateDocument(),
    other = createPlateDocument();
  const asset = svgAssetsForDocument(base.id).register(source);
  svgAssetsForDocument(other.id).register(source);
  await expect(checkAssistantSvg(other, { handle: asset.handle }, signal(), false)).rejects.toThrow(/Unknown SVG/);
  await expect(checkAssistantSvg(base, { handle: '../source.svg' }, signal(), false)).rejects.toThrow(/Unknown SVG/);
  releaseSvgAssets(base.id);
  svgAssetsForDocument(base.id).register(source);
  await expect(checkAssistantSvg(base, { handle: asset.handle }, signal(), false)).rejects.toThrow(/Unknown SVG/);
});

it('refuses pre-aborted and interrupted production SVG checks without mutating the open design', async () => {
  const base = createPlateDocument(),
    original = structuredClone(base);
  const controller = new AbortController();
  controller.abort();
  await expect(checkAssistantSvg(base, input, controller.signal, false)).rejects.toThrow();
  expect(svgAssetsForDocument(base.id).list()).toHaveLength(0);
  const during = new AbortController();
  const pending = checkAssistantSvg(base, input, during.signal, false);
  during.abort();
  await expect(pending).rejects.toThrow();
  expect(base).toEqual(original);
});

it('cannot weaken confirmed dimensions through SVG tool arguments or finalize a failed requirement check', async () => {
  const base = createPlateDocument();
  const setup = recorded(
    base,
    [call('check_svg', { ...input, requirements: { width: 280 } }), call('check_svg', input), call('finalize_design'), proposal],
    { part: input.partName, width: 300 }
  );
  const result = await runDesignAssistant(setup.options);
  expect(result.status).toBe('exhausted');
  expect(result.proposal).toBeUndefined();
  expect(setup.finalize).not.toHaveBeenCalled();
  expect(
    result.messages
      .filter(message => message.role === 'tool')
      .map(message => message.text)
      .join('\n')
  ).toMatch(/Unknown SVG request field[\s\S]*"requirements":\{"ok":false[\s\S]*Check passing geometry/);
});

it('drops an earlier finalized proposal after a failed SVG repair instead of returning a stale success', async () => {
  const base = createPlateDocument();
  const setup = recorded(base, [
    call('check_svg', input),
    call('finalize_design'),
    call('check_svg', { handle: 'svg-missing' }),
    call('finalize_design'),
    proposal,
  ]);
  const result = await runDesignAssistant(setup.options);
  expect(result.status).toBe('exhausted');
  expect(result.proposal).toBeUndefined();
  expect(setup.finalize).toHaveBeenCalledTimes(1);
  expect(
    result.messages
      .filter(message => message.role === 'tool')
      .map(message => message.text)
      .join('\n')
  ).toMatch(/Unknown SVG[\s\S]*Check passing geometry/);
});

it('stops an interrupted recorded SVG turn without finalizing or proposing its candidate', async () => {
  const base = createPlateDocument(),
    original = structuredClone(base);
  const setup = recorded(base, [call('check_svg', input), call('finalize_design'), proposal]);
  const controller = new AbortController();
  setup.options.signal = controller.signal;
  setup.options.svg!.check = async (args, abort, options) => {
    const checked = await checkAssistantSvg(base, args, abort, options.views);
    controller.abort();
    return checked;
  };
  const result = await runDesignAssistant(setup.options);
  expect(result.status).toBe('stopped');
  expect(result.proposal).toBeUndefined();
  expect(setup.finalize).not.toHaveBeenCalled();
  expect(base).toEqual(original);
});
