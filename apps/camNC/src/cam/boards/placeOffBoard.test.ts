import { describe, expect, it } from 'vitest';
import { nestBoard, newBoard, reconcileBoards, setAsidePart, withLayout, type BoardV1, type PartInstance } from '../boards';
import { onBoardOnly } from './placement';
import { moveOnto, moveRefusedNote, placeOffBoard, placeOffBoardNote, tooBigForMachine } from './placeOffBoard';

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

  it('turns a part that fits the machine only turned, and places it on a new board', () => {
    const parts = [inst('Panel', 950, 560, 18), inst('Shelf', 500, 300, 18)];
    const [board] = reconcileBoards(undefined, parts, 'plywood');
    const off = setAsidePart(board, 'Panel', { x: -1000, y: -1000, rotated: false });
    expect(tooBigForMachine(off, 'Panel', parts, bit, opts)).toBeNull();
    const before = nested([off], parts);
    expect(before[0].nest.unplaced).toEqual(['Panel']);

    const res = placeOffBoard(before, parts, bit, opts);
    expect(res.tooBig).toEqual([]);
    expect(res.placed).toEqual(['Panel']);
    expect(res.boards).toHaveLength(2);
    const taker = nested(res.boards, parts).find(b => b.board.items.includes('Panel'))!;
    expect(taker.board.id).not.toBe(board.id);
    expect(taker.nest.unplaced).toEqual([]);
    expect(taker.nest.placements.find(p => p.id === 'Panel')!.rotated).toBe(true);
  });
});

describe('moveOnto', () => {
  const parts = [inst('Side', 560, 900, 18), inst('Shelf', 500, 300, 18), inst('Top', 300, 200, 18)];
  const board = (items: string[], size: BoardV1['size'] = { fit: true }): BoardV1 => ({
    ...newBoard([], 18, 'plywood', items, items.join()),
    size,
  });

  it('refuses a board full within the machine, and the board it was on keeps it', () => {
    // Side takes the machine's width: a fitted board with it can't grow to take Shelf too.
    const full = board(['Side']);
    expect(nestBoard(full, parts, bit, opts).unplaced).toEqual([]);
    const res = moveOnto(full, 'Shelf', parts, bit, opts);
    expect(res).toEqual({ full: 'full and can’t grow within the machine' });
    expect(moveRefusedNote('Shelf', { ...full, name: 'A' }, 'full and can’t grow within the machine')).toBe(
      'Shelf doesn’t fit on board A: it’s full and can’t grow within the machine. It stays where it is.'
    );
    // A fixed board that is too small, with nothing on it.
    expect(moveOnto(board([], { fit: false, w: 200, h: 200 }), 'Shelf', parts, bit, opts)).toEqual({ full: 'too small' });
  });

  it('pins the part onto a board that grows to take it, every part on it still placed', () => {
    const res = moveOnto(board(['Top']), 'Shelf', parts, bit, opts);
    if (!('board' in res)) throw new Error(`refused: ${res.full}`);
    expect(res.board.items).toEqual(['Top', 'Shelf']);
    expect(res.board.pinned).toEqual(['Shelf']);
    expect(nestBoard(res.board, parts, bit, opts).unplaced).toEqual([]);
  });

  it('refuses a move that would push a part already on the board off it', () => {
    // Room for one of them: Shelf would nest, but Top would come off for it.
    const fixed = board(['Top'], { fit: false, w: 520, h: 330 });
    expect(nestBoard(fixed, parts, bit, opts).unplaced).toEqual([]);
    expect(moveOnto(fixed, 'Shelf', parts, bit, opts)).toEqual({ full: 'full' });
  });
});

describe('a part a design edit left no room for', () => {
  // Bottom grew over Shelf's stored spot: Shelf no longer fits where it was laid out.
  const before = [inst('Bottom', 200, 100, 18), inst('Shelf', 200, 100, 18)];
  const after = [inst('Bottom', 200, 180, 18), inst('Shelf', 200, 100, 18)];
  const stored = (): BoardV1 => ({
    ...newBoard([], 18, 'plywood', ['Bottom', 'Shelf']),
    margin: 10,
    gap: 10,
    layout: { w: 220, h: 230, at: { Bottom: { x: 10, y: 10, rotated: false }, Shelf: { x: 10, y: 120, rotated: false } } },
  });
  const edited = { ...opts, preserveLayout: true };

  it('is drawn once, off the board, and keeps its spot for when the edit is undone', () => {
    expect(nestBoard(stored(), before, bit, edited).unplaced).toEqual([]);
    const nest = nestBoard(stored(), after, bit, edited);
    expect(nest.unplaced).toEqual(['Shelf']);
    // On the board: only what is cut there. Shelf isn't drawn over Bottom too.
    expect(onBoardOnly(nest).placements.map(p => p.id)).toEqual(['Bottom']);
    expect(onBoardOnly(nest).unplaced).toEqual(['Shelf']);
    expect(withLayout(stored(), nest).layout!.at.Shelf).toEqual({ x: 10, y: 120, rotated: false });
    // Nothing off the board: the nest as it is.
    const whole = nestBoard(stored(), before, bit, edited);
    expect(onBoardOnly(whole)).toBe(whole);
  });

  it('goes back onto a board with "Place on boards", with no part over another', () => {
    const board = stored();
    const res = placeOffBoard([{ board, nest: nestBoard(board, after, bit, edited) }], after, bit, edited);
    expect(res.placed).toEqual(['Shelf']);
    const nests = res.boards.map(b => onBoardOnly(nestBoard(b, after, bit, edited)));
    expect(nests.flatMap(n => n.unplaced)).toEqual([]);
    expect(nests.flatMap(n => n.placements.map(p => p.id)).sort()).toEqual(['Bottom', 'Shelf']);
  });
});
