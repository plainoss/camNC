import {
  dropPart,
  holdSettingsOf,
  isCut,
  nestBoard,
  newBoard,
  notAside,
  type BoardNest,
  type BoardV1,
  type NestOptions,
  type PartInstance,
} from '../boards';

/** The board's pins without this body. */
export const unpinned = (board: BoardV1, itemId: string) => (board.pinned ?? []).filter(i => i !== itemId);
/** The board's layout without this body. */
const unpositioned = (board: BoardV1, itemId: string) =>
  board.layout && { layout: { ...board.layout, at: Object.fromEntries(Object.entries(board.layout.at).filter(([id]) => id !== itemId)) } };
/** The board without this body (nor its pin and spot). */
export const withoutPart = (board: BoardV1, itemId: string): BoardV1 => ({
  ...notAside(board, itemId),
  items: board.items.filter(i => i !== itemId),
  ...(board.pinned && { pinned: unpinned(board, itemId) }),
  ...unpositioned(board, itemId),
});

/**
 * A new board for this body alone, split off `from`: its material and hold settings, the body pinned. Its thickness is
 * `from`'s, or the body's own when it moves off a board of another thickness.
 */
export const freshBoardFor = (boards: BoardV1[], from: BoardV1, id: string, thickness = from.thickness): BoardV1 => ({
  ...newBoard(boards, thickness, from.material, [id]),
  ...holdSettingsOf(from),
  pinned: [id],
});

/**
 * Whether this body fits no board at all: alone on a new board like `from` (its hold settings and edge margin), the
 * machine still can't take it. Then the edge margin it would need, for the reason; else null.
 */
export function tooBigForMachine(
  from: BoardV1,
  id: string,
  instances: PartInstance[],
  bit: number,
  opts: NestOptions,
  thickness = from.thickness
): { margin: number } | null {
  if (!opts.machine || !instances.some(i => i.id === id)) return null;
  const alone = nestBoard(freshBoardFor([from], from, id, thickness), instances, bit, { ...opts, holds: false });
  return alone.unplaced.includes(id) ? { margin: alone.margin } : null;
}

const mm = (v: number) => +v.toFixed(1);

/** Why a body can't be cut on this machine: its size against the largest board the machine holds. */
export function tooBigReason(inst: PartInstance, machine: { w: number; h: number }, margin: number): string {
  const inside = `${mm(machine.w - 2 * margin)} × ${mm(machine.h - 2 * margin)} mm`;
  return `${inst.name} (${mm(inst.size[0])} × ${mm(inst.size[1])} mm) is too big for the machine: its largest board is ${mm(machine.w)} × ${mm(machine.h)} mm, ${inside} inside the edge margins.`;
}

export interface OffBoardPlacement {
  boards: BoardV1[];
  /** Bodies now on a board. */
  placed: string[];
  /** Bodies too big for any board the machine holds: they stay where they are, and no board is made for them. */
  tooBig: { id: string; margin: number }[];
  /** Bodies off boards already cut: those stay as they were cut. */
  onCut: string[];
}

/**
 * Every part off a board that isn't cut: onto a board of its thickness with room (its own first), or else a new one.
 * A part that fits no board the machine can hold stays where it is: a new board wouldn't take it either.
 */
export function placeOffBoard(
  boards: { board: BoardV1; nest: Pick<BoardNest, 'unplaced'> }[],
  instances: PartInstance[],
  bit: number,
  opts: NestOptions,
  needsRepair: (board: BoardV1, id: string) => boolean = () => false
): OffBoardPlacement {
  let next = boards.map(b => b.board);
  const placed: string[] = [];
  const tooBig: OffBoardPlacement['tooBig'] = [];
  const onCut = boards.filter(({ board }) => isCut(board)).flatMap(({ nest }) => nest.unplaced);
  // No spot it could take: the nest decides.
  const anywhere = { x: -1e6, y: -1e6, rotated: false };
  for (const { board, nest } of boards) {
    if (isCut(board)) continue;
    for (const id of nest.unplaced.filter(id => !needsRepair(board, id))) {
      const current = next.find(b => b.id === board.id)!;
      const home = notAside(current, id);
      const others = next.filter(b => b.id !== board.id && !isCut(b) && b.thickness === board.thickness);
      // A board takes it only with room to spare: a part on it now mustn't come off for it.
      const keeps = (t: BoardV1, after: BoardV1) => {
        const off = new Set(nestBoard(after, instances, bit, { ...opts, holds: false }).unplaced);
        const now = t === home ? current : t;
        return nestBoard(now, instances, bit, { ...opts, holds: false }).placements.every(p => !off.has(p.id));
      };
      const drop = [home, ...others]
        .map(t => ({ t, d: dropPart(t, instances, bit, id, anywhere, 0, opts) }))
        .find(({ t, d }) => d.at && keeps(t, d.board))?.d;
      if (!drop) {
        const big = tooBigForMachine(board, id, instances, bit, opts);
        if (big) {
          tooBig.push({ id, ...big });
          continue;
        }
      }
      const taker = drop?.board ?? freshBoardFor(next, board, id);
      const gone = next.map(b => (b.id === taker.id ? taker : withoutPart(b, id)));
      next = gone.some(b => b.id === taker.id) ? gone : [...gone, taker];
      placed.push(id);
    }
  }
  return { boards: next, placed, tooBig, onCut };
}

/** What "Place on boards" says: what it placed, and each part it didn't place, with why. */
export function placeOffBoardNote(
  { placed, tooBig, onCut }: OffBoardPlacement,
  instances: PartInstance[],
  machine: { w: number; h: number } | undefined
): string {
  const byId = new Map(instances.map(i => [i.id, i]));
  const name = (id: string) => byId.get(id)?.name ?? id;
  const notPlaced = tooBig.length + onCut.length > 0;
  const done = !placed.length ? '' : notPlaced ? `Placed on boards: ${placed.map(name).join(', ')}.` : 'Parts off the boards placed.';
  const big = tooBig.map(({ id, margin }) => {
    const inst = byId.get(id);
    return inst && machine ? `${tooBigReason(inst, machine, margin)} It stays off the boards.` : `${name(id)} fits on no board.`;
  });
  const cut = onCut.length
    ? `Not placed: ${onCut.map(name).join(', ')} ${onCut.length === 1 ? 'is' : 'are'} on already-cut boards. Start over on a new sheet first.`
    : '';
  return [done, ...big, cut].filter(Boolean).join(' ') || 'No parts could be placed.';
}
