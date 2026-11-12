import { describe, expect, it } from 'vitest';
import { summarize } from './plan';
import type { PartCam } from './toolpaths';

/** A pocket whose second pass has a stay-down link slowed to a fraction of the cutting feed, as stock links make it. */
const cam: PartCam = {
  stockTop: 10,
  warnings: [],
  operations: [
    {
      name: 'Pocket',
      kind: 'pocket',
      feature: 'pocket',
      tool: { number: 1, diameter: 4 },
      plungeFeed: 120,
      passes: [
        {
          pts: [
            [0, 0, 12],
            [0, 0, 5],
            [5, 0, 5],
          ],
          feeds: [120, 120, 1800],
          link: 'retract',
        },
        {
          pts: [
            [5, 0, 5],
            [6, 0, 5],
            [10, 0, 5],
          ],
          feeds: [1800, 703.842, 1800],
          link: 'direct',
        },
      ],
    },
  ],
};

describe('plan feeds', () => {
  it('are whole mm/min, a slowed link between pocket passes included', () => {
    const plan = summarize(cam, 'part', [20, 20, 10], {});
    expect(plan.ops[0]!.feeds).toEqual([1800, 704, 120]);
  });
});
