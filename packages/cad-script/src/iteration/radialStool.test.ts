import { placePoint } from '@wbcnc/cad';
import { describe, expect, it } from 'vitest';
import { radialStoolWorkflow } from './radialStool';
import { radialStoolExpected } from './radialStoolExpected';
import { runCadWorkflow } from './workflow';

describe('radial stool regeneration', () => {
  it('specifies full-ring centers and material independently of candidate placement', () => {
    const intent = { board: 18, radius: 150, height: 400, legs: 4, opposite: false, suppressed: false };
    const bodies = radialStoolExpected(intent);
    expect(bodies).toHaveLength(5);
    expect(bodies[0]!.volume).toBe(2856600);
    expect(bodies[1]).toMatchObject({ at: [120, -9, 0], size: [60, 18, 400], center: [150, 0, 200], volume: 432000 });
    expect(bodies[2]!.center[0]).toBeCloseTo(0);
    expect(bodies[2]!.center[1]).toBeCloseTo(150);
    expect(radialStoolExpected({ ...intent, opposite: true })[2]!.center[1]).toBeCloseTo(-150);
    expect(radialStoolExpected({ ...intent, suppressed: true })).toHaveLength(2);
  });
  it('keeps the complete stool through stock/radius edits, count growth, reverse, suppression and reload', async () => {
    const result = await runCadWorkflow(radialStoolWorkflow());
    expect(result.firstFailure).toBeUndefined();
    expect(result.status).toBe('passed');
    expect(result.scope).toBe('complete');
    expect(result.checkpoints).toHaveLength(6);
    expect(result.checkpoints.at(-1)!.checks.find(c => c.layer === 'persistence')?.passed).toBe(true);
    expect(result.checkpoints[2]!.bodies).toHaveLength(7);
    expect(result.checkpoints[4]!.bodies).toHaveLength(2);
  });
  it('rejects a rotation-only defect even when physical counts, profiles, volumes and ring centers remain correct', async () => {
    const workflow = radialStoolWorkflow(),
      check = workflow.checkpoints[0]!.checks.find(c => c.description.includes('bounds, center'))!,
      actual = check.actual;
    check.actual = context => {
      const leg = context.document.parts.find(p => p.name === 'Leg')!,
        copy = leg.copies![0]!;
      const localCenter: [number, number, number] = [0, 200, leg.thickness / 2],
        center = placePoint(copy.placement, localCenter);
      copy.placement!.rotation = [...leg.placement!.rotation];
      const changedCenter = placePoint(copy.placement, localCenter);
      copy.placement!.position = copy.placement!.position.map((n, i) => n + center[i]! - changedCenter[i]!) as [number, number, number];
      return actual(context);
    };
    const result = await runCadWorkflow(workflow);
    expect(result.firstFailure).toMatchObject({ checkpoint: 'assembled', layer: 'assembly' });
  });
  it('rejects missing material on one copy despite unchanged source contours, bounds and piece names', async () => {
    const workflow = radialStoolWorkflow(),
      check = workflow.checkpoints[0]!.checks.find(c => c.description.includes('physical copy retains uncut'))!,
      actual = check.actual;
    check.actual = context => {
      const leg = context.parts.find(p => p.name === 'Leg')!,
        copy = context.document.parts.find(p => p.name === 'Leg')!.copies![0]!;
      leg.copyCuts = {
        [copy.id]: [
          {
            id: 'corrupt-copy-pocket',
            regionId: 'corrupt-copy-pocket',
            side: 'top',
            from: 0,
            to: 5,
            through: false,
            outline: [
              { x: -10, y: 100 },
              { x: 10, y: 100 },
              { x: 10, y: 200 },
              { x: -10, y: 200 },
            ],
            islands: [],
          },
        ],
      };
      return actual(context);
    };
    const result = await runCadWorkflow(workflow);
    expect(result.firstFailure).toMatchObject({ checkpoint: 'assembled', layer: 'geometry', actual: false });
  });
});
