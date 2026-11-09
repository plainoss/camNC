import { loadStep, planBoard } from '@wbcnc/cam';
import { fixtureFree } from '@wbcnc/cam/settle';
import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it } from 'vitest';
import { planBlock } from './boardBlock';
import { boardRequest, instancesOf, nestBoard, reconcileBoards, settleInputOf, suggestFixtures, withLayout } from './boards';
import { modelOfBodies, partSource } from './importedModel';
import { kDefaultPlan, toCamSettings } from './planSettings';

/**
 * Back to the event loop. Once OCCT is loaded, importing and planning run synchronously for seconds at a time (the
 * tray's plan for ~30 s): without a break, Vitest's worker can't answer its runner and times out reporting results.
 */
const yieldToVitest = () => new Promise<void>(resolve => setTimeout(resolve, 0));

/** A varied-boards STEP fixture as the CAM worker imports it. */
async function imported(id: string) {
  const bytes = readFileSync(new URL(`../../../../packages/cam/test/fixtures/varied-boards/${id}.step`, import.meta.url));
  const { bodies, readMs } = await loadStep(new Uint8Array(bytes));
  await yieldToVitest();
  const model = modelOfBodies(bodies, readMs);
  await yieldToVitest();
  return model;
}

/** Its parts, all milled, on the one board a new job gives them, nested. */
async function laidOutBoard(id: string) {
  const { model, entries } = await imported(id);
  const instances = instancesOf(model.parts, () => true);
  const boards = reconcileBoards(undefined, instances, 'oak');
  const nest = nestBoard(boards[0], instances, 3.175);
  return { boards, nest, laid: withLayout(boards[0], nest), instances, entries };
}

// The pipeline behind the Plan step for these models: the route test shows one held and one blocked board.
describe('varied STEP boards, from import to a plan', () => {
  afterEach(yieldToVitest);

  it.each(['frame-01', 'gear-02', 'round-02', 'tray-02'])(
    '%s gets holds clear of every cut at the app’s real clearances',
    async id => {
      const { laid, instances } = await laidOutBoard(id);
      const next = suggestFixtures(laid, instances, 3.175);
      const nest = nestBoard(next, instances, 3.175);
      const { input, spots } = settleInputOf(next, nest, instances, 3.175);
      for (const f of next.fixtures ?? []) expect(fixtureFree(input, spots, f)).toBe(true);
    },
    120_000
  );

  it.each([
    // Knobs take tabs on their gentle curves. A gear's teeth are all corners: the job is blocked until the board changes.
    ['frame-01', 11, true],
    ['gear-02', 4, false],
    ['round-02', 12, true],
    ['tray-02', 60, true],
  ] as const)(
    '%s goes from a new job to a laid out board and a plan',
    async (id, parts, held) => {
      const { boards, nest, laid, instances, entries } = await laidOutBoard(id);
      expect(instances).toHaveLength(parts);
      expect(boards).toHaveLength(1);
      expect(nest.unplaced).toEqual([]);
      expect(nest.placements).toHaveLength(parts);

      const plan = kDefaultPlan;
      const request = boardRequest(laid, nestBoard(laid, instances, plan.bit.diameter), instances, {
        skin: plan.skin,
        holes: plan.holes,
        leaveOut: plan.leaveOut,
      });
      await yieldToVitest();
      const result = planBoard(request, toCamSettings(plan, 'oak'), partSource(entries));
      expect(result.ops.length).toBeGreaterThan(0);
      const loose = (result.timeline ?? []).filter(e => /would come loose when its outline is cut through/.test(e.message));
      if (held) {
        // What the Plan step shows as "Safety checks passed".
        expect(result.safety).toEqual([]);
        expect(planBlock(result)).toBeNull();
        expect(loose).toEqual([]);
      } else {
        expect(loose.length).toBeGreaterThan(0);
        expect(planBlock(result)).not.toBeNull();
      }
    },
    120_000
  );
});
