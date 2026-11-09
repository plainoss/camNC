import { describe, expect, it } from 'vitest';
import { machiningCases, machiningPart, rectangle } from '../test/machining-fixtures';
import { camBoard, splitByBit } from './board';
import { checkAccuracyBudget } from './accuracy';
import { toGcode } from './gcode';
import { checkGcodeSafety } from './safety';
import { camPart } from './toolpaths';

describe('integrated stock and geometry planning', () => {
  it('uses unknown surrounding material conservatively and keeps configured accuracy separate from source claims', () => {
    const cam = camPart(machiningCases.island(), { cutThrough: false, maxStepdown: 1.5 });
    expect(cam.stockFootprint).toBeUndefined();
    expect(cam.accuracy!.scope).toBe('features');
    expect(cam.stockSummary!.retractedLinks).toBeGreaterThan(0);
    checkAccuracyBudget(cam.accuracy!.budget);
    for (const operation of cam.operations)
      for (let i = 1; i < operation.passes.length; i++) {
        const pass = operation.passes[i];
        expect(pass.roles).toHaveLength(pass.pts.length);
        if (pass.link === 'direct') expect(pass.clearLink).toBe(true);
      }
    const declared = camPart(machiningCases.rectangle(), { cutThrough: false, geometryTolerance: 0.05, sourceTolerance: 0.01 });
    expect(declared.accuracy!.scope).toBe('declared-source');
    expect(declared.accuracy!.budget.import).toBe(0.01);
    expect(() => camPart(machiningCases.rectangle(), { geometryTolerance: 0.001 })).toThrow(/geometryTolerance/);
  });

  it('stores the actual rotated board blank and preserves metadata across physical-tool programs', () => {
    const angle = (17 * Math.PI) / 180;
    const board = camBoard(
      {
        id: 'blank',
        name: 'Blank',
        w: 140,
        h: 100,
        thickness: 12,
        holdDown: 'none',
        rotationDeg: 17,
        parts: [{ id: 'part', name: 'Part', x: 20, y: 15, rotated: false, size: [100, 70, 12], features: machiningCases.rectangle() }],
      },
      { cutThrough: false }
    );
    expect(board.stockFootprint![0]).toHaveLength(4);
    expect(board.stockFootprint![0][2].x).toBeCloseTo(140 * Math.cos(angle) - 100 * Math.sin(angle));
    expect(board.stockFootprint![0][2].y).toBeCloseTo(140 * Math.sin(angle) + 100 * Math.cos(angle));
    const first = board.operations[0];
    board.operations.push({ ...first, tool: { ...first.tool, number: 2, guid: 'second-tool' } });
    const programs = splitByBit(board);
    expect(programs).toHaveLength(2);
    for (const program of programs) {
      expect(program.accuracy).toEqual(board.accuracy);
      expect(program.stockFootprint).toEqual(board.stockFootprint);
      expect(program.operations[0].passes[0].roles).toHaveLength(program.operations[0].passes[0].pts.length);
    }
  });

  it('accepts only an explicitly declared raw blank and rejects incompatible process limits', () => {
    const blank = [rectangle(-10, -10, 120, 90)];
    const cam = camPart(machiningCases.rectangle(), { cutThrough: false, blankFootprint: blank });
    expect(cam.stockFootprint).toEqual(blank);
    expect(cam.stockFootprint).not.toBe(blank);
    expect(() => camPart(machiningCases.rectangle(), { maxPlanarRemovalRate: 0.001, minimumCuttingFeed: 100 })).toThrow(/minimum/);
  });
});
