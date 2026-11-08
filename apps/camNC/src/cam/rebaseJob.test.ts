import { describe, expect, it } from 'vitest';
import type { CamJobV1 } from './jobDb';
import { rebaseJob } from './rebaseJob';
import { carvingRegion, kDefaultVBit, withItems, type CarvingItemV1 } from './carving';

const board = (id: string, items: string[], over = {}) => ({
  id,
  name: id,
  thickness: 8,
  material: 'oak',
  size: { fit: true },
  retention: 'tabs',
  tabs: {},
  items,
  ...over,
});
const job = (boards: unknown[], over = {}) => ({ id: 'j', name: 'j', fileName: 'f', parts: [], boards, ...over }) as unknown as CamJobV1;

describe('saving on top of the job as it is now', () => {
  const base = job([board('A', ['p']), board('C', [])]);

  it('nothing else saved since the render: as asked', () => {
    const next = job([board('A', ['p'], { margin: 9 }), board('C', [])]);
    expect(rebaseJob(base, next, base)).toBe(next);
  });

  it('a drop, then a size field committed from the same render: both stay', () => {
    // The drop moved p to C.
    const dropped = job([board('A', []), board('C', ['p'], { pinned: ['p'] })]);
    // The field's blur, built from the board as rendered: C still empty.
    const sized = job([board('A', ['p']), board('C', [], { size: { fit: false, w: 600, h: 300 } })]);
    const out = rebaseJob(base, sized, dropped);
    const c = out.boards!.find(b => b.id === 'C')!;
    expect(c.items).toEqual(['p']);
    expect(c.pinned).toEqual(['p']);
    expect(c.size).toEqual({ fit: false, w: 600, h: 300 });
    expect(out.boards!.find(b => b.id === 'A')!.items).toEqual([]);
  });

  it('a change elsewhere in the job survives, and a removed field goes', () => {
    const b = job([board('A', ['p'])], { stock: [{ id: 's' }] });
    const now = job([board('A', ['p'])], { stock: [{ id: 's' }], plan: { cutting: { stepdown: 3 } } });
    const next = job([board('A', ['p'], { margin: 9 })]);
    const out = rebaseJob(b, next, now);
    expect(out.plan).toEqual({ cutting: { stepdown: 3 } });
    expect(out.boards![0].margin).toBe(9);
    expect('stock' in out).toBe(false);
  });

  it('boards added and removed apply; a board added since stays', () => {
    const now = job([board('A', ['p']), board('C', []), board('D', [])]);
    const next = job([board('A', ['p']), board('E', [])]);
    expect(rebaseJob(base, next, now).boards!.map(b => b.id)).toEqual(['A', 'D', 'E']);
  });

  it('the first save of derived boards keeps boards saved in the meantime', () => {
    const noBoards = job([], { boards: undefined });
    const now = job([board('A', ['q'])]);
    const next = job([board('A', ['p'])]);
    expect(rebaseJob(noBoards, next, now).boards![0].items).toEqual(['q']);
  });
});

it('N1 preserves concurrently recorded physical starts and completions when an older Done cut patch saves', () => {
  const base = job([board('A', ['p'])]);
  const current = job([board('A', ['p'], { cut: { at: 10, sourceKey: 'original', keys: ['first'], startedKeys: ['first', 'running'] } })]);
  const staleDone = job([board('A', ['p'], { cut: { at: 20, sourceKey: 'original', keys: ['second'] } })]);
  const cut = rebaseJob(base, staleDone, current).boards![0].cut!;
  expect(cut.startedKeys).toEqual(['first', 'running']);
  expect(cut.keys).toEqual(['first', 'second']);
  expect(cut.at).toBe(10);
});

it('N1 still allows explicit Start over to clear physical history', () => {
  const base = job([board('A', ['p'], { cut: { at: 10, keys: [], startedKeys: ['running'] } })]);
  const current = job([board('A', ['p'], { cut: { at: 10, keys: ['running'], startedKeys: ['running'], all: true } })]);
  expect(rebaseJob(base, job([board('A', ['p'])]), current).boards![0].cut).toBeUndefined();
});

it('N1 a stale completion cannot restore cut history after an explicit Start over', () => {
  const base = job([board('A', ['p'], { cut: { at: 10, keys: ['first'], startedKeys: ['first'] } })]);
  const staleDone = job([board('A', ['p'], { cut: { at: 10, keys: ['first', 'second'], startedKeys: ['first', 'second'], all: true } })]);
  expect(rebaseJob(base, staleDone, job([board('A', ['p'])])).boards![0].cut).toBeUndefined();
});

it('keeps independent carving edits, additions and deletions and derives their combined region', () => {
  const item = (id: string, x: number): CarvingItemV1 => ({
    id,
    art: { kind: 'text', text: id, font: 'serif' },
    height: 10,
    x,
    y: 20,
    rotation: 0,
    outline: [
      [
        { x: -5, y: -5 },
        { x: 5, y: -5 },
        { x: 5, y: 5 },
        { x: -5, y: 5 },
      ],
    ],
  });
  const a = item('a', 20),
    b = item('b', 40),
    c = item('c', 60);
  const carving = { items: [a, b], region: carvingRegion([a, b]), vBit: kDefaultVBit, maxDepth: 3, clearWithFlat: true };
  const base = job([], { carving });
  const current = job([], { carving: withItems({ ...carving, maxDepth: 4 }, [{ ...a, x: 30 }, c]) });
  const next = job([], {
    carving: withItems(carving, [
      { ...a, rotation: 90 },
      { ...b, height: 15 },
    ]),
  });
  const saved = rebaseJob(base, next, current).carving!;
  expect(saved.items).toEqual([{ ...a, x: 30, rotation: 90 }, c]);
  expect(saved.maxDepth).toBe(4);
  expect(saved.region).toEqual(carvingRegion(saved.items));
});

it('keeps a carving item’s art, height and outline together when two saves redraw it', () => {
  const square = (r: number) => [
    [
      { x: -r, y: -r },
      { x: r, y: -r },
      { x: r, y: r },
      { x: -r, y: r },
    ],
  ];
  const a: CarvingItemV1 = {
    id: 'a',
    art: { kind: 'text', text: 'A', font: 'serif' },
    height: 10,
    x: 20,
    y: 20,
    rotation: 0,
    outline: square(5),
  };
  const carving = { items: [a], region: carvingRegion([a]), vBit: kDefaultVBit, maxDepth: 3, clearWithFlat: true };
  const base = job([], { carving });
  // One save made it taller, the other changed its text at the old height.
  const current = job([], { carving: withItems(carving, [{ ...a, height: 20, outline: square(10) }]) });
  const retyped = { ...a, art: { kind: 'text' as const, text: 'B', font: 'serif' as const }, outline: square(4) };
  const saved = rebaseJob(base, job([], { carving: withItems(carving, [retyped]) }), current).carving!;
  expect(saved.items).toEqual([retyped]);
});
