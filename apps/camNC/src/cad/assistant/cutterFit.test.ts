import { addPartCut, addRectangle, createCadDocument, createCadPart, type CadDocument } from '@wbcnc/cad';
import type { CadReport } from '@wbcnc/cad-script';
import { describe, expect, it, vi } from 'vitest';
import { cutterCheck, cutterFitNotes, requestedCutter } from './cutterFit';
import { defaultProvider } from './keyStore';
import { runDesignAssistant, type AssistantRunOptions } from './loop';
import type { AssistantMessage } from './provider';

/** A seat and the tenon it is about to be mortised for; `mortised` adds the Cut parts step. */
function seat() {
  const board = createCadPart('Seat', 18);
  board.sketch = addRectangle(board.sketch, { x: 0, y: 0, width: 200, height: 200, dimensioned: true, positioned: true });
  board.placement = { position: [0, 0, 0], rotation: [0, 0, 0, 1] };
  const tenon = createCadPart('Tenon', 18);
  tenon.sketch = addRectangle(tenon.sketch, { x: 80, y: 91, width: 40, height: 18, dimensioned: true, positioned: true });
  tenon.placement = { position: [0, 0, 9], rotation: [0, 0, 0, 1] };
  const base: CadDocument = { ...createCadDocument('Seat'), parts: [board, tenon] };
  const mortised = addPartCut(base, [tenon.id], [board.id], { value: 0.2 }, undefined, { diameter: 6 }).document;
  return { base, mortised };
}
const unreached = (report: Partial<CadReport> = {}): CadReport => ({
  ok: true,
  status: 'solved',
  errors: [],
  parts: [],
  warnings: [
    {
      code: 'corner-unreachable',
      message: "The ⌀6 bit doesn't reach 4 of the 4 corners of the opening Tenon cuts in Seat, missing by up to 0.1 mm.",
      part: 'Seat',
    },
  ],
  ...report,
});

describe('cutter fit for mortise requests', () => {
  it('reads the cutter the user names, the latest one winning', () => {
    expect(requestedCutter(['Mortise the seat for the leg tenons; I cut with a 6 mm end mill.'])).toBe(6);
    expect(requestedCutter(['Use a 3.175mm bit.', 'Actually the cutter is 4 mm.'])).toBe(4);
    expect(requestedCutter(['A 1/4" bit for the dados.'])).toBe(6.35);
    expect(requestedCutter(['Make the seat 18 mm thick with mortises.'])).toBeUndefined();
    expect(requestedCutter(['Mortise the seat; 6 mm end mill.', 'Make the tenon a bit 2 mm longer.'])).toBe(6);
    expect(requestedCutter(['Make the mortises a bit 1 mm wider'])).toBeUndefined();
    expect(requestedCutter(['The bit ⌀6 mm.', 'Use a bit of 4 mm.'])).toBe(4);
  });

  it('counts a mortise check only when it was made with the named cutter', () => {
    const { base, mortised } = seat();
    const asked = ['Mortise the seat for the tenon. I cut with a 6 mm end mill.'];
    expect(cutterCheck(asked, base, mortised, undefined)).toMatchObject({ passed: false, expected: 6, actual: 3.175 });
    expect(cutterCheck(asked, base, mortised, 3.175)?.message).toMatch(/bit: 6/);
    expect(cutterCheck(asked, base, mortised, 6)).toBeUndefined();
    // No joint asked for, or no Cut parts step changed: nothing to hold to the cutter.
    expect(cutterCheck(['Make it wider. 6 mm end mill.'], base, mortised, undefined)).toBeUndefined();
    expect(cutterCheck(asked, mortised, mortised, undefined)).toBeUndefined();
  });

  it('names an unknown cutter and each mortise whose corners stay out of reach', () => {
    const { base, mortised } = seat();
    expect(cutterFitNotes(['Mortise the seat for the tenon.'], base, mortised, unreached({ warnings: [] }))).toEqual([
      expect.stringMatching(/No cutter diameter was given.*default ⌀3.175 mm bit/),
    ]);
    const notes = cutterFitNotes(['Mortise the seat for the tenon with a 6 mm cutter.'], base, mortised, unreached());
    expect(notes).toEqual([expect.stringMatching(/opening Tenon cuts in Seat/)]);
  });

  it('makes the assistant check with the named cutter and adds the unreached mortise to its proposal', async () => {
    const { base, mortised } = seat();
    const call = (bit?: number): AssistantMessage => ({
      role: 'assistant',
      text: '',
      calls: [{ id: crypto.randomUUID(), name: 'check_design', arguments: { source: 'mortise', ...(bit && { bit }) } }],
    });
    const replies = [call(), call(6), { role: 'assistant' as const, text: 'Proposal: a mortised seat.' }];
    const options: AssistantRunOptions = {
      base,
      config: { ...defaultProvider, model: 'recorded' },
      key: 'private',
      context: '',
      guide: 'Guide',
      examples: {},
      signal: new AbortController().signal,
      messages: [{ role: 'user', text: 'Mortise the seat for the tenon. I cut with a 6 mm end mill.' }],
      request: vi.fn(async () => replies.shift()!),
      check: vi.fn(async () => ({ ok: true, document: mortised, report: { ok: true }, trustedReport: unreached(), parts: [] })),
    };
    const result = await runDesignAssistant(options);
    const tools = result.messages.filter(message => message.role === 'tool').map(message => JSON.parse(message.text));
    // Checked with the default bit, the attempt doesn't count; with the user's 6 mm cutter it does.
    expect(tools.map(tool => tool.ok)).toEqual([false, true]);
    expect(JSON.stringify(tools[0].requirements)).toContain('bit: 6');
    expect(result.status).toBe('proposal');
    expect(result.messages.at(-1)?.text).toMatch(/Cutter fit, checked by the app:\n- The ⌀6 bit doesn't reach .*Tenon cuts in Seat/);
  });
});
