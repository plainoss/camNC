import { describe, expect, it } from 'vitest';
import { nestBoard, reconcileBoards, type BoardV1, type PartInstance } from '../boards';
import { placeOffBoard, placeOffBoardNote } from './placeOffBoard';

const inst = (id: string, w: number, h: number, t: number): PartInstance => ({ id, partId: id, name: id, size: [w, h, t], thickness: t });
const bit = 6;
// The demo machine: boards top out at 618 mm in X.
const machine = { w: 618, h: 1000 };
const opts = { machine, holds: false };
const nested = (boards: BoardV1[], parts: PartInstance[]) => boards.map(board => ({ board, nest: nestBoard(board, parts, bit, opts) }));

describe('placeOffBoard', () => {
  it('makes no board for a part too big for the machine, and says why', () => {
    const parts = [inst('Back', 800, 800, 6), inst('Side', 500, 300, 18)];
    const boards = reconcileBoards(undefined, parts, 'plywood');
    expect(nested(boards, parts).flatMap(b => b.nest.unplaced)).toEqual(['Back']);

    const res = placeOffBoard(nested(boards, parts), parts, bit, opts);
    expect(res.boards).toEqual(boards);
    expect(res.placed).toEqual([]);
    expect(res.tooBig.map(t => t.id)).toEqual(['Back']);
    const note = placeOffBoardNote(res, parts, machine);
    expect(note).toMatch(/^Back \(800 × 800 mm\) is too big for the machine: its largest board is 618 × 1000 mm/);
    expect(note).not.toContain('placed.');

    // Again: still nothing made.
    expect(placeOffBoard(nested(res.boards, parts), parts, bit, opts).boards).toEqual(boards);
  });

  it('places what fits on a new board and names what it couldn’t place', () => {
    const parts = [inst('Back', 800, 800, 6), inst('Top', 580, 900, 18), inst('Bottom', 580, 900, 18)];
    const boards = reconcileBoards(undefined, parts, 'plywood');
    const before = nested(boards, parts);
    expect(before.flatMap(b => b.nest.unplaced).sort()).toEqual(['Back', 'Bottom']);

    const res = placeOffBoard(before, parts, bit, opts);
    expect(res.placed).toEqual(['Bottom']);
    expect(res.tooBig.map(t => t.id)).toEqual(['Back']);
    // One new board, for Bottom, and every board but Back's has its parts on it.
    expect(res.boards).toHaveLength(boards.length + 1);
    const after = nested(res.boards, parts);
    expect(after.filter(b => !b.nest.placements.length).map(b => b.board.items)).toEqual([['Back']]);
    expect(after.flatMap(b => b.nest.unplaced)).toEqual(['Back']);
    expect(placeOffBoardNote(res, parts, machine)).toMatch(/^Placed on boards: Bottom\. Back \(800 × 800 mm\) is too big/);
  });

  it('says the parts were placed when all of them were', () => {
    const parts = [inst('Top', 580, 900, 18), inst('Bottom', 580, 900, 18)];
    const res = placeOffBoard(nested(reconcileBoards(undefined, parts, 'plywood'), parts), parts, bit, opts);
    expect(res.placed).toEqual(['Bottom']);
    expect(placeOffBoardNote(res, parts, machine)).toBe('Parts off the boards placed.');
  });
});
