import { describe, expect, it } from 'vitest';
import { applyFeedPolicy, type MotionPath } from './motion';
import { applyTabMotion, repeatTabIntervals } from './tabMotion';
import { difference, type PathD, type Vec3 } from './geom';

const rect = (x0: number, y0: number, x1: number, y1: number): PathD => [
  { x: x0, y: y0 },
  { x: x1, y: y0 },
  { x: x1, y: y1 },
  { x: x0, y: y1 },
];
const policy = {
  plungeFeed: 300,
  rampFeed: 420,
  leadFeed: 700,
  materialSide: 'right' as const,
  cornerFeed: { factor: 0.5, minAngleDeg: 30, maxRadius: 0.5, distance: 2 },
};
const path = (pts: Vec3[], feed = 1000): MotionPath => ({ pts, feeds: pts.map(() => feed), link: 'retract' });

describe('semantic motion and feed scheduling', () => {
  it('uses independent ramp/lead/plunge feeds while preserving cut feeds and role alignment', () => {
    const p = path([
      [0, 0, 8],
      [10, 0, 7],
      [11, 0, 7],
      [20, 0, 7],
      [21, 1, 7],
    ]);
    p.roles = ['approach', 'ramp', 'lead-in', 'cut', 'lead-out'];
    const result = applyFeedPolicy(p, { ...policy, cornerFeed: false });
    expect(result.feeds).toEqual([300, 420, 700, 1000, 700]);
    expect(result.roles).toHaveLength(result.pts.length);
    expect(p.feeds).toEqual([1000, 1000, 1000, 1000, 1000]);
  });

  it('splits before a concave material-side corner and restores the straight feed afterward', () => {
    const result = applyFeedPolicy(
      path([
        [0, 0, 2],
        [20, 0, 2],
        [20, 20, 2],
      ]),
      policy
    );
    expect(result.pts).toEqual([
      [0, 0, 2],
      [18, 0, 2],
      [20, 0, 2],
      [20, 2, 2],
      [20, 20, 2],
    ]);
    expect(result.feeds).toEqual([300, 1000, 500, 500, 1000]);
    expect(result.roles).toEqual(['approach', 'cut', 'corner', 'corner', 'cut']);
  });

  it('does not reduce convex outside turns or turns without known material side', () => {
    const clockwise = path([
      [0, 0, 2],
      [0, 20, 2],
      [20, 20, 2],
      [20, 0, 2],
      [0, 0, 2],
    ]);
    expect(applyFeedPolicy(clockwise, policy).roles).not.toContain('corner');
    expect(
      applyFeedPolicy(
        path([
          [0, 0, 2],
          [20, 0, 2],
          [20, 20, 2],
        ]),
        { ...policy, materialSide: undefined }
      ).roles
    ).not.toContain('corner');
  });

  it('includes a closed contour seam in corner scheduling', () => {
    const result = applyFeedPolicy(
      path([
        [0, 0, 2],
        [20, 0, 2],
        [20, 20, 2],
        [0, 20, 2],
        [0, 0, 2],
      ]),
      policy
    );
    expect(result.feeds[1]).toBe(500);
    expect(result.feeds.at(-1)).toBe(500);
  });

  it('reduces accumulated tight curvature but leaves broad curves at cutting feed', () => {
    const arc = (radius: number) =>
      path(Array.from({ length: 31 }, (_, i) => [radius * Math.cos((i * Math.PI) / 60), radius * Math.sin((i * Math.PI) / 60), 2] as Vec3));
    expect(applyFeedPolicy(arc(0.2), policy).roles).toContain('corner');
    expect(applyFeedPolicy(arc(5), policy).roles).not.toContain('corner');
  });

  it('unions overlapping zones around a chorded corner without fragmenting its straight approaches', () => {
    const arc: Vec3[] = Array.from({ length: 91 }, (_, i) => {
      const angle = -Math.PI / 2 + (i * Math.PI) / 180;
      return [Math.cos(angle), 1 + Math.sin(angle), 2];
    });
    const original = path([[-10, 0, 2], ...arc, [1, 11, 2]]);
    const result = applyFeedPolicy(original, {
      ...policy,
      cornerFeed: { ...policy.cornerFeed, maxRadius: 2 },
    });
    // One feed boundary on each straight, regardless of the number of curved chords.
    expect(result.pts).toHaveLength(original.pts.length + 2);
    const straightMoves = result.pts.slice(1).flatMap((point, i) => {
      const previous = result.pts[i];
      return Math.abs(point[1]) < 1e-8 && Math.abs(previous[1]) < 1e-8 ? [Math.hypot(point[0] - previous[0], point[1] - previous[1])] : [];
    });
    expect(straightMoves).toHaveLength(2);
    expect(Math.min(...straightMoves)).toBeGreaterThan(1);
    expect(result.roles).toContain('corner');
  });

  it.each([
    [500, 500],
    [500.0004, 500.0003],
  ])('does not insert corner boundaries for equivalent posted feeds (%s, %s)', (feed, reducedFeed) => {
    const original = path(
      [
        [0, 0, 2],
        [20, 0, 2],
        [20, 20, 2],
      ],
      feed
    );
    original.roles = ['approach', 'finish', 'finish'];
    const result = applyFeedPolicy(original, { ...policy, reducedFeed });
    expect(result.pts).toEqual(original.pts);
    expect(result.roles).toEqual(original.roles);
    expect(result.feeds.slice(1)).toEqual([feed, feed]);
  });

  it('compacts collinear cuts while retaining feed, finish, tab, and reversal boundaries', () => {
    const original = path(Array.from({ length: 7 }, (_, i) => [i, 0, 2] as Vec3));
    original.feeds = [1000, 1000, 1000, 900, 900, 900, 900];
    original.roles = ['approach', 'cut', 'cut', 'cut', 'finish', 'tab', 'tab'];
    const result = applyFeedPolicy(original, { ...policy, cornerFeed: false });
    expect(result.pts.map(point => point[0])).toEqual([0, 2, 3, 4, 5, 6]);
    expect(result.roles).toEqual(['approach', 'cut', 'cut', 'finish', 'tab', 'tab']);
    const reversal = path([
      [0, 0, 2],
      [2, 0, 2],
      [1, 0, 2],
    ]);
    expect(applyFeedPolicy(reversal, { ...policy, cornerFeed: false }).pts).toEqual(reversal.pts);
  });
});

describe('tabs on repeated ramp laps', () => {
  it('raises the pass with vertical steps at the tab borders', () => {
    const result = applyTabMotion(
      path([
        [0, 0, 0],
        [20, 0, 0],
      ]),
      [[8, 12]],
      2,
      300
    );
    expect(result.pts).toEqual([
      [0, 0, 0],
      [8, 0, 0],
      [8, 0, 2],
      [12, 0, 2],
      [12, 0, 0],
      [20, 0, 0],
    ]);
    expect(result.feeds[4]).toBe(300);
  });

  it('repeats holding plateaux at every lap and across the contour seam', () => {
    const intervals = repeatTabIntervals([[-2, 2]], 20, 45);
    expect(intervals).toEqual([
      [-2, 2],
      [18, 22],
      [38, 42],
    ]);
    const result = applyTabMotion(
      path([
        [0, 0, 0],
        [45, 0, 0],
      ]),
      intervals,
      2,
      300
    );
    expect(result.pts.filter(p => p[2] === 2).map(p => p[0])).toEqual([0, 2, 18, 22, 38, 42]);
  });
});
