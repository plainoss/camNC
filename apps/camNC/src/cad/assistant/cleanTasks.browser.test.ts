import { describe, expect, it } from 'vitest';
import { parseCadDocument } from '@wbcnc/cad';
import startJson from '../../../../../packages/cad-script/fixtures/designs/task-start-cupboard-three-shelves.json?raw';
import { cadSavedTask } from '../../../../../packages/cad-script/src/tasks/catalogue';
import { benchmarkAssistantTask } from './taskBenchmark';
import { checkScriptInBrowser } from './scriptCheck';
import type { AssistantMessage } from './provider';
import cupboardExample from '../../../../../packages/cad-script/examples/cupboard.cad.ts?raw';
import plateExample from '../../../../../packages/cad-script/examples/plate.cad.ts?raw';
import trayExample from '../../../../../packages/cad-script/examples/tray.cad.ts?raw';
import shelfExample from '../../../../../packages/cad-script/examples/shelf-side.cad.ts?raw';

// Same examples as the dock; these are available to the adapter, not task solutions.
const examples = { cupboard: cupboardExample, plate: plateExample, tray: trayExample, 'shelf-side': shelfExample };

const config = {
  kind: 'compatible',
  protocol: 'chat',
  endpoint: 'http://localhost',
  model: 'independent-agent-smoke',
  tools: true,
  images: false,
} as const;
const bench = `d => {
 d.folder('Hallway shoe bench', d => {
  d.variable('width', '900mm'); d.variable('height', '450mm'); d.variable('depth', '350mm');
  d.variable('board', '18mm'); d.variable('housing', '9mm'); d.variable('shelfHeight', '150mm');
  const left = d.newPart('Left side', { thickness: 'board' });
  left.profile.rect({ at: [0,0], w: 'depth', h: 'height-board+housing' });
  left.drawOn('right', { offset: 0 });
  const right = d.newPart('Right side', { thickness: 'board' });
  right.profile.rect({ at: [0,0], w: 'depth', h: 'height-board+housing' });
  right.drawOn('right', { offset: 'width-board' });
  const seat = d.newPart('Seat', { thickness: 'board' });
  seat.profile.rect({ at: [0,0], w: 'width', h: 'depth' });
  seat.drawOn('top', { offset: 'height-board' });
  const shelf = d.newPart('Shoe shelf', { thickness: 'board' });
  shelf.profile.rect({ at: ['board-housing',0], w: 'width-2*board+2*housing', h: 'depth' });
  shelf.drawOn('top', { offset: 'shelfHeight' });
  d.cutParts(left, { with: shelf }); d.cutParts(right, { with: shelf });
  d.cutParts(seat, { with: [left,right] });
 });
}`;

// Independent authoring needed one repair: the checker taught profile-before-drawOn.
// Keep the corrected candidate here; API error wording is not part of this outcome trial.
function call(id: string, name: string, args: Record<string, unknown> = {}): AssistantMessage {
  return { role: 'assistant', text: '', calls: [{ id, name, arguments: args }] };
}

/** Agent-authored clean-context smoke trials; no saved recordings or live provider are used. */
describe('independently authored assistant smoke trials (no provider)', () => {
  it('edits only the middle shelf for A2 through the production tool loop', async () => {
    let turn = 0;
    const responses = [
      call('quick', 'cad_script_guide'),
      call('editing', 'cad_script_guide', { section: 'editing' }),
      call('shelves', 'read_design_report', { section: 'assembly' }),
      call('hole', 'check_design', {
        source: `d => {
   const shelf = d.existingCopy('Shelf 2');
   const top = shelf.sketchOn('top');
   top.circle({ at: [400,240], d: 60 });
   shelf.cut(top.regionAt(400,240), { depth: 'through' });
  }`,
      }),
    ];
    const result = await benchmarkAssistantTask(cadSavedTask('A2'), parseCadDocument(JSON.parse(startJson)), {
      config,
      key: '',
      examples,
      signal: new AbortController().signal,
      check: (source, base, signal) => checkScriptInBrowser(base, source, { signal }),
      request: async input => {
        if (turn < responses.length) return responses[turn++]!;
        expect(JSON.parse(input.messages.at(-1)!.text).ok).toBe(true);
        return {
          role: 'assistant',
          text: 'Proposal: Only Shelf 2 gains a 60 mm through hole at [400,240], 44 mm from its back edge. The other shelves are unchanged. Review inherited pocket machining warnings before manufacture.',
        };
      },
    });
    expect(result.result.status).toBe('proposal');
    expect(result.result.checks).toBe(1);
    expect(result.assessment?.automaticPass).toBe(true);
    expect(result.assessment?.review).toEqual([]);
  }, 60_000);
  it('builds B1 through the production tool loop', async () => {
    let turn = 0;
    const result = await benchmarkAssistantTask(cadSavedTask('B1'), null, {
      config,
      key: '',
      examples,
      signal: new AbortController().signal,
      check: (source, base, signal) => checkScriptInBrowser(base, source, { signal }),
      request: async input => {
        const responses = [
          call('quick', 'cad_script_guide'),
          call('assembly', 'cad_script_guide', { section: 'assembly' }),
          call('build', 'check_design', { source: bench }),
        ];
        if (turn < responses.length) return responses[turn++]!;
        expect(JSON.parse(input.messages.at(-1)!.text).ok).toBe(true);
        return {
          role: 'assistant',
          text: 'Proposal: A 900 × 350 × 450 mm shoe bench in 18 mm plywood, with one shoe shelf and 9 mm housings, in its own folder. A person must review joint strength, fit, and screw-free stability before construction.',
        };
      },
    });
    expect(result.result.status).toBe('proposal');
    expect(result.result.checks).toBe(1);
    // Automatic geometry outcomes remain distinct from human construction approval.
    expect(result.assessment?.review).toEqual(['The construction holds together without visible screws.']);
    expect(result.assessment?.automaticPass).toBe(true);
  }, 60_000);
});
