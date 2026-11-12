import {
  addRectangle,
  createCadDocument,
  createCadPart,
  createPlateDocument,
  setCadConstruction,
  type CadConstruction,
  type CadDocument,
} from '@wbcnc/cad';
import { describe, expect, it, vi } from 'vitest';
import { defaultProvider } from './keyStore';
import { runDesignAssistant, type AssistantRunOptions } from './loop';
import type { AssistantMessage } from './provider';
import { seatingConstructionCheck } from './seatingGate';

const board = (name: string, z: number) => {
  const part = createCadPart(name, 18);
  part.sketch = addRectangle(part.sketch, { x: 0, y: 0, width: 300, height: 300, dimensioned: true, positioned: true });
  part.placement = { position: [0, 0, z], rotation: [0, 0, 0, 1] };
  return part;
};
/** A plausible-looking stool: a seat resting on a top board, with nothing holding the two together. */
function looseStool(base: CadDocument): CadDocument {
  return { ...base, revision: base.revision + 1, parts: [...base.parts, board('Seat', 632), board('Frame top', 614)] };
}
/** Declares a plan joining the last `count` pieces. Only membership matters to the gate; inspection measures the rest. */
function planned(document: CadDocument, count = document.parts.length): CadDocument {
  const members = document.parts.slice(-count).map((part, index) => ({ role: `member-${index}`, partId: part.id }));
  const roles = members.map(member => member.role);
  const plan: CadConstruction = {
    id: 'plan',
    folderId: 'stool-folder',
    recipe: 'frame-stool-glued-v1',
    parameters: [{ name: 'board', variableId: 'board-variable' }],
    members,
    materials: [
      {
        roles,
        kind: 'plywood',
        grain: 'profile-x',
        stock: 'nominal',
        stockVariableId: 'board-variable',
        service: 'conditioned-dry-interior',
      },
    ],
    connections: [{ id: 'joint', kind: 'glued-shouldered-tenon', roles, hardwareIds: [] }],
    hardware: [],
    assembly: [{ action: 'square-and-cure', roles, hardwareIds: [], axis: '+z' }],
  };
  return setCadConstruction(
    { ...document, folders: [{ id: 'stool-folder', name: 'Stool', partIds: members.map(member => member.partId) }] },
    plan
  );
}

describe('seating construction gate', () => {
  const base = createCadDocument('Empty');
  it('refuses new chair or stool pieces that no construction plan joins', () => {
    const check = seatingConstructionCheck(base, looseStool(base), ['Build a stool.']);
    expect(check).toMatchObject({ passed: false, actual: ['Seat', 'Frame top'] });
    expect(check?.message).toMatch(/frameStool or panelChair/);
    // Planning only the frame still leaves the loose seat.
    expect(seatingConstructionCheck(base, planned(looseStool(base), 1), ['A chair, please'])?.actual).toEqual(['Seat']);
  });

  it('accepts planned pieces, other requests and pieces already in the open design', () => {
    expect(seatingConstructionCheck(base, planned(looseStool(base)), ['Build a stool.'])).toBeUndefined();
    expect(seatingConstructionCheck(base, looseStool(base), ['Build a shelf.'])).toBeUndefined();
    const existing = looseStool(base);
    expect(seatingConstructionCheck(existing, existing, ['Make the stool taller.'])).toBeUndefined();
  });

  it('keeps the assistant from proposing a loose stool, and proposes it once a plan joins every piece', async () => {
    const plate = createPlateDocument();
    for (const [document, expected] of [
      [looseStool(plate), 'exhausted'],
      [planned(looseStool(plate), 2), 'proposal'],
    ] as const) {
      const replies: AssistantMessage[] = [
        { role: 'assistant', text: '', calls: [{ id: 'c1', name: 'check_design', arguments: { source: 'stool' } }] },
        { role: 'assistant', text: 'Proposal: a 650 mm stool.' },
      ];
      const options: AssistantRunOptions = {
        base: plate,
        config: { ...defaultProvider, model: 'recorded' },
        key: 'private',
        context: '',
        guide: 'Guide',
        examples: {},
        signal: new AbortController().signal,
        messages: [{ role: 'user', text: 'Build a stool, 650 mm tall.' }],
        request: vi.fn(async () => replies.shift()!),
        check: vi.fn(async () => ({ ok: true, document, report: { ok: true } })),
      };
      const result = await runDesignAssistant(options);
      expect(result.status).toBe(expected);
      const tool = result.messages.find(message => message.role === 'tool' && message.callId === 'c1')!;
      expect(JSON.parse(tool.text).ok).toBe(expected === 'proposal');
      if (expected === 'exhausted') {
        // The offer is refused: there is no proposal to apply, and the check told the model what to repair.
        expect(result.proposal).toBeUndefined();
        expect(result.stopReason).toContain('no check of it passed');
        expect(tool.text).toContain('seating construction');
      }
    }
  });
});
