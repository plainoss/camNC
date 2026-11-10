import { describe, expect, it } from 'vitest';
import type { BoardNest, BoardV1 } from '../boards';
import type { JobBoard } from '../useJobBoards';
import {
  applySetupToAll,
  prepareGlobalRelayout,
  restorePhysicalBoardSetup,
  setupDiffers,
  setupSummary,
  withBoardSetup,
} from './globalSetup';

const baseBoard = (id: string, name: string): BoardV1 => ({
  id,
  name,
  thickness: 8,
  material: 'oak',
  size: { fit: true },
  retention: 'tabs',
  tabs: { width: 5, height: 2, minCount: 3 },
  items: [`part-${id}`],
});

const baseNest = (margin = 6.7, gap = 10): BoardNest => ({
  board: { w: 600, h: 400 },
  placements: [],
  unplaced: [],
  yield: 0.5,
  gap,
  margin,
  bit: 3.175,
  holds: [],
  stickout: 20,
  nutAbove: 10,
});

describe('globalSetup', () => {
  it('copies margin, gap, retention, and hold settings with withBoardSetup', () => {
    const from: BoardV1 = {
      ...baseBoard('a', 'A'),
      retention: 'skin',
      margin: 1,
      gap: 4,
      taped: true,
    };
    const target: BoardV1 = {
      ...baseBoard('b', 'B'),
      retention: 'tabs',
      margin: 8,
      gap: 16,
    };
    const res = withBoardSetup(target, from);
    expect(res.margin).toBe(1);
    expect(res.gap).toBe(4);
    expect(res.retention).toBe('skin');
    expect(res.taped).toBe(true);
    expect(res.id).toBe('b');
    expect(res.name).toBe('B');
  });

  it('detects when another uncut board differs in spacing or holding', () => {
    const bA = { ...baseBoard('a', 'A'), margin: 1, gap: 4, retention: 'skin' as const };
    const bB = { ...baseBoard('b', 'B'), retention: 'tabs' as const };
    const jA: JobBoard = { board: bA, nest: baseNest(1, 4), request: {} as any };
    const jB: JobBoard = { board: bB, nest: baseNest(6.7, 10), request: {} as any };

    expect(setupDiffers(jA, [jA, jB])).toBe(true);

    // If B has matching setup, differs is false
    const jBmatched: JobBoard = {
      board: { ...bB, margin: 1, gap: 4, retention: 'skin' },
      nest: baseNest(1, 4),
      request: {} as any,
    };
    expect(setupDiffers(jA, [jA, jBmatched])).toBe(false);

    // Cut boards are ignored
    const jBcut: JobBoard = {
      ...jB,
      board: { ...jB.board, cut: { at: Date.now(), keys: ['p1'] } },
    };
    expect(setupDiffers(jA, [jA, jBcut])).toBe(false);
  });

  it('summarizes board setup clearly', () => {
    const b = { ...baseBoard('a', 'A'), retention: 'skin' as const };
    expect(setupSummary(b, { margin: 1, gap: 4 })).toBe('1 mm margin, 4 mm gap, bottom skin');
  });

  it('applies setup to all uncut boards without moving parts', () => {
    const bA = { ...baseBoard('a', 'A'), margin: 1, gap: 4, retention: 'skin' as const };
    const bB = { ...baseBoard('b', 'B'), margin: 6.7, gap: 10, retention: 'tabs' as const };
    const jA: JobBoard = { board: bA, nest: baseNest(1, 4), request: {} as any };
    const jB: JobBoard = { board: bB, nest: baseNest(6.7, 10), request: {} as any };

    const applied = applySetupToAll([jA, jB], bA, [], 3.175);
    expect(applied[1].margin).toBe(1);
    expect(applied[1].gap).toBe(4);
    expect(applied[1].retention).toBe('skin');
  });

  it('derives effective stock from existing fixed boards when stock list is empty', () => {
    const bA = { ...baseBoard('a', 'A'), margin: 1, gap: 4 };
    const bB = { ...baseBoard('b', 'B'), size: { fit: false as const, w: 600, h: 145 } };
    const bC = { ...baseBoard('c', 'C'), size: { fit: false as const, w: 600, h: 145 } };
    const jA: JobBoard = { board: bA, nest: baseNest(1, 4), request: {} as any };
    const jB: JobBoard = { board: bB, nest: { ...baseNest(), board: { w: 600, h: 145 } }, request: {} as any };
    const jC: JobBoard = { board: bC, nest: { ...baseNest(), board: { w: 600, h: 145 } }, request: {} as any };

    const { free, effectiveStock } = prepareGlobalRelayout([jA, jB, jC], bA, [], [], 3.175);
    expect(free).toHaveLength(3);
    expect(free[1].margin).toBe(1);
    expect(free[1].gap).toBe(4);
    // Deduplicated fixed-size sheet with exact quantity count (2 matching boards)
    expect(effectiveStock).toHaveLength(1);
    expect(effectiveStock[0]).toMatchObject({ thickness: 8, w: 600, h: 145, quantity: 2 });
  });

  it('restores physical board identity, fixtures, and measured thickness on re-laid out boards', () => {
    const origB = {
      ...baseBoard('b', 'B'),
      size: { fit: false as const, w: 600, h: 145 },
      measuredThickness: 8.4,
      fixtures: [{ kind: 'screw' as const, x: 50, y: 50 }],
    };
    const freshB = {
      ...baseBoard('fresh-b', 'New Board'),
      size: { fit: false as const, w: 600, h: 145 },
      items: ['p1'],
    };

    const restored = restorePhysicalBoardSetup([freshB], [origB]);
    expect(restored[0].id).toBe('b');
    expect(restored[0].name).toBe('B');
    expect(restored[0].measuredThickness).toBe(8.4);
    expect(restored[0].fixtures).toEqual([{ kind: 'screw', x: 50, y: 50 }]);
    expect(restored[0].items).toEqual(['p1']);
  });
});
