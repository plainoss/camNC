import { describe, expect, it } from 'vitest';
import { planAccuracy } from './accuracy';
import { readGcode } from './analyze';
import { toGcode } from './gcode';
import { finalizePlan } from './finalizePlan';
import { parsedPostNumber } from './postValidation';
import type { PathD, Vec3 } from './geom';
import { StockModel } from './stock';
import { DEFAULT_SETTINGS, pocketOperation, type PartCam } from './toolpaths';

const rect = (x0: number, y0: number, x1: number, y1: number): PathD => [
  { x: x0, y: y0 },
  { x: x1, y: y0 },
  { x: x1, y: y1 },
  { x: x0, y: y1 },
];

describe('pocket endpoint uncertainty', () => {
  it('uses pinned endpoint uncertainty for a straight cutting hop without weakening travel or wall clearance', () => {
    const from: Vec3 = [5, 0, 5],
      to: Vec3 = [6.19, 0, 5];
    const policy = { region: [rect(-10, -10, 30, 10)], maximumStepover: 1.2, cutFeed: 1800, transitionFeed: 1800 };
    const generic = new StockModel({ stockTop: 10, pathTolerance: 0.01 });
    const pinned = new StockModel({ stockTop: 10, pathTolerance: 0.01, endpointTolerance: 0.002 });
    for (const stock of [generic, pinned]) stock.recordPath([[0, 0, 5], from], 2);
    expect(generic.certifyCuttingTransition(from, to, 2, policy).reason).toBe('stepover-exceeded');
    const proof = pinned.certifyCuttingTransition(from, to, 2, policy);
    expect(proof.allowed).toBe(true);
    expect(proof.maximumImmersion).toBeCloseTo(1.194);
    expect(proof.maximumFrontierWidth).toBeCloseTo(4.02);
    expect(pinned.certifyLink(from, to, 2).clear).toBe(false);
    expect(pinned.certifyCuttingTransition(from, to, 2, { ...policy, region: [rect(-10, -2.005, 30, 10)] }).reason).toBe('outside-pocket');
    expect(pinned.certifyCuttingTransition(from, [6.197, 0, 5], 2, policy).reason).toBe('stepover-exceeded');
  });

  it('avoids extra rings in the 150 by 120 mm review pocket without replacing them with retracts', () => {
    const settings = { ...DEFAULT_SETTINGS, maxStepdown: 3 };
    const operation = pocketOperation('Review pocket', [rect(0, 0, 150, 120)], 12, 0, { number: 1, diameter: 6 }, settings);
    const program: PartCam = { stockTop: 12, operations: [operation], warnings: [], accuracy: planAccuracy() };
    expect(operation.passes.length).toBeLessThan(100);
    for (const arcs of [false, true]) {
      const moves = readGcode(toGcode(program, { arcs }));
      const retracts = moves.filter(move => move.rapid && move.to[2] > move.from[2] + 1e-6).length;
      expect(retracts).toBeLessThanOrEqual(9);
    }
  });

  it.each([NaN, Infinity, -0.001])('rejects an invalid endpoint uncertainty: %s', endpointTolerance => {
    expect(() => new StockModel({ stockTop: 10, pathTolerance: 0.01, endpointTolerance })).toThrow(/stock model options/);
  });

  it('pins a cutting bridge destination even when caller-authored roles allow a surrounding fitted arc', () => {
    const at = (i: number): Vec3 => [100 * Math.cos(i * 0.0239), 100 * Math.sin(i * 0.0239), 5];
    const from = at(0),
      to = at(1),
      pts = [1, 2, 3, 4, 5].map(at);
    const source: PartCam = {
      stockTop: 10,
      warnings: [],
      operations: [
        {
          name: 'Authored link roles',
          kind: 'pocket',
          feature: 'pocket',
          tool: { number: 1, diameter: 6 },
          pocketTransition: { region: [rect(-200, -200, 200, 200)], maximumStepover: 2.4, cutFeed: 1800, transitionFeed: 1800 },
          passes: [
            { pts: [[100, -1, 5], from], feeds: [100, 100], link: 'retract' },
            { pts, feeds: pts.map(() => 100), roles: pts.map(() => 'link'), link: 'direct', cuttingTransition: { from, to } },
          ],
        },
      ],
    };
    const code = toGcode(source);
    const pass = code.split('(PASS 2/2 Z5)')[1]!;
    expect(pass).toMatch(/^\s*(?:G1 )?X99\.971 Y2\.39\n/);
    expect(pass).toMatch(/G[23] /);
  });

  it.each([false, true])('preserves an arc endpoint before an isolated straight cutting bridge (rate limiting: %s)', limited => {
    const points: Vec3[] = Array.from({ length: 17 }, (_, i) => {
      const angle = (Math.PI * i) / 32;
      return [4070.1234 + 10 * Math.cos(angle), 20.5674 + 10 * Math.sin(angle), 5.1234];
    });
    const from = points.at(-1)!;
    const to: Vec3 = [from[0] - 2.39, from[1], from[2]];
    const source: PartCam = {
      stockTop: 10,
      warnings: [],
      operations: [
        {
          name: 'Pinned arc',
          kind: 'pocket',
          feature: 'pocket',
          tool: { number: 1, diameter: 6 },
          pocketTransition: { region: [rect(4050, 0, 4090, 60)], maximumStepover: 2.4, cutFeed: 1800, transitionFeed: 1800 },
          passes: [
            { pts: points, feeds: points.map(() => 1800), link: 'retract' },
            { pts: [to, [to[0] - 5, to[1], to[2]]], feeds: [1800, 1800], link: 'direct', cuttingTransition: { from, to } },
          ],
        },
      ],
    };
    const finalized = finalizePlan(source, { ...DEFAULT_SETTINGS, ...(limited && { maxPlanarRemovalRate: 900 }) });
    expect(finalized.stockSummary.cuttingTransitions).toBe(1);
    // Multiplication/division of the same frontier bound may round upward by one binary64 ulp.
    if (limited) expect(finalized.stockSummary.maximumPlanarRemovalRate).toBeLessThanOrEqual(900 * (1 + Number.EPSILON));
    const budget = finalized.accuracy.budget;
    const q = budget.outputRounding + budget.controllerRounding;
    for (const arcs of [false, true]) {
      const code = toGcode(finalized, { arcs });
      if (arcs && !limited) expect(code).toMatch(/G[23] /);
      const moves = readGcode(code);
      const pinned = moves.findIndex(move => move.to.every((value, axis) => Math.abs(value - from[axis]) < 0.001));
      expect(pinned).toBeGreaterThan(0);
      const start = moves[pinned].to.map(parsedPostNumber);
      expect(Math.hypot(...start.map((value, axis) => value - from[axis]))).toBeLessThanOrEqual(q);
      const bridge = moves.slice(pinned + 1).find(move => move.to.every((value, axis) => Math.abs(value - to[axis]) < 0.001));
      expect(bridge).toBeDefined();
      expect(bridge!.rapid).toBe(false);
      const end = bridge!.to.map(parsedPostNumber);
      expect(Math.hypot(...end.map((value, axis) => value - to[axis]))).toBeLessThanOrEqual(q);
      expect(Math.hypot(end[0]! - start[0]!, end[1]! - start[1]!)).toBeLessThanOrEqual(2.4);
      expect(bridge!.feed * (6 + 2 * (budget.fitting + q))).toBeLessThanOrEqual(1800 * 2.4);
      // A fitted arc spanning the bridge would replace this row of collinear endpoint moves.
      const prefix = moves.slice(pinned + 1, moves.indexOf(bridge!) + 1);
      expect(prefix.every(move => !move.rapid && Math.abs(move.to[1] - +from[1].toFixed(3)) < 1e-9)).toBe(true);
    }
  });
});
