import { describe, expect, it } from 'vitest';
import { carvingBoard, carvingRegion, kDefaultVBit, type CarvingItemV1 } from '../carving';
import type { CamJobV1 } from '../jobDb';
import { kDefaultPlan } from '../planSettings';
import { boardBlock } from '../boardBlock';
import type { PreparedCarvingArt } from './prepare';
import {
  applyCarvingProposal,
  carvingProposalRefusal,
  createCarvingProposal,
  generatedCarvingProblem,
  savedCarvingEnvelope,
} from './proposal';

const outline = [
  [
    { x: -10, y: -5 },
    { x: 10, y: -5 },
    { x: 10, y: 5 },
    { x: -10, y: 5 },
  ],
];
const source = {
  id: 'source-owl',
  svg: '<svg viewBox="0 0 20 10"><rect width="20" height="10"/></svg>',
  prompt: 'Owl reading a book',
  summary: 'Owl and book',
};
const item: CarvingItemV1 = {
  id: 'welcome',
  art: { kind: 'text', text: 'Welcome', font: 'sans' },
  height: 10,
  x: 20,
  y: 20,
  rotation: 0,
  outline,
};
const job = (): CamJobV1 => ({
  v: 1,
  id: 'carving-job',
  name: 'Carving',
  fileName: '',
  createdAt: 0,
  updatedAt: 0,
  parts: [],
  boards: [carvingBoard({ w: 100, h: 80, thickness: 18 })],
  carving: { items: [structuredClone(item)], region: carvingRegion([item]), maxDepth: 2, vBit: kDefaultVBit, clearWithFlat: false },
});
const prepared = (): PreparedCarvingArt => ({
  art: { kind: 'svg', svg: source.svg, fileName: 'owl.svg' },
  outline,
  width: 20,
  height: 10,
  envelope: { width: 20, height: 10 },
  operations: [],
  report: {
    ok: true,
    errors: [],
    warnings: [],
    detail: 'balanced',
    minFeatureMm: 0.6,
    removedComponents: 0,
    sourceComponents: 1,
    points: 4,
    camPasses: 1,
    removedCutAreaMm2: 0,
    narrowLandAreaMm2: 0,
  },
});

describe('guarded carving proposals', () => {
  it('adds one item, preserving the source and every unrelated job field', () => {
    const base = job();
    const proposal = createCarvingProposal(base, prepared(), { mode: 'add', asset: source, detail: 'balanced' });
    expect(base.carving!.items).toHaveLength(1);
    const next = applyCarvingProposal({ ...base, name: 'Renamed while reviewing' }, proposal);
    expect(next.name).toBe('Renamed while reviewing');
    expect(next.boards).toBe(base.boards);
    expect(next.carving!.items[0]).toEqual(base.carving!.items[0]);
    expect(next.carving!.items[1].generated).toMatchObject({ assetId: source.id, sourceSvg: source.svg, prompt: source.prompt });
    expect(next.carving!.region).toEqual(carvingRegion(next.carving!.items));
    expect(generatedCarvingProblem(next)).toBeNull();
    expect(carvingProposalRefusal(next, proposal)).toMatch(/changed/);
  });

  it('replaces only the selected item and preserves its placement and identity', () => {
    const base = job();
    base.carving!.items.push({ ...item, id: 'other', x: 60 });
    const proposal = createCarvingProposal(base, prepared(), { mode: 'replace', targetId: item.id, asset: source, detail: 'simple' });
    const next = applyCarvingProposal(base, proposal);
    expect(next.carving!.items).toHaveLength(2);
    expect(next.carving!.items[0]).toMatchObject({ id: item.id, x: item.x, y: item.y, rotation: item.rotation });
    expect(next.carving!.items[1]).toEqual(base.carving!.items[1]);
    expect(generatedCarvingProblem(next)).toBeNull();
  });

  it.each(['board', 'art', 'tool', 'depth', 'plan'] as const)('refuses a stale %s edit before mutation', changed => {
    const base = job();
    const proposal = createCarvingProposal(base, prepared(), { mode: 'add', asset: source, detail: 'balanced' });
    const current = structuredClone(base);
    if (changed === 'board') current.boards![0].thickness = 20;
    if (changed === 'art') current.carving!.items[0].height = 12;
    if (changed === 'tool') current.carving!.vBit = { ...current.carving!.vBit, angle: 90 };
    if (changed === 'depth') current.carving!.maxDepth = 1;
    if (changed === 'plan') current.plan = { ...kDefaultPlan, material: 'mdf' };
    const before = structuredClone(current);
    expect(() => applyCarvingProposal(current, proposal)).toThrow(/changed/);
    expect(current).toEqual(before);
  });

  it('requires a new size check after edits, and propagates that block to the machine boundary', () => {
    const base = job();
    const proposal = createCarvingProposal(base, prepared(), { mode: 'add', asset: source, detail: 'balanced' });
    const next = applyCarvingProposal(base, proposal);
    next.carving!.items[1].height = 8;
    const problem = generatedCarvingProblem(next);
    expect(problem).toMatch(/Recheck/);
    expect(
      boardBlock({ board: next.boards![0], nest: { gap: 5, margin: 5 } as never, carvingProblem: problem! }, undefined, {
        bit: 3,
        missing: [],
      })
    ).toBe(problem);
    // Naming and manufacturing history are unrelated to the art's physical suitability.
    const unchanged = applyCarvingProposal(base, proposal);
    unchanged.boards![0] = { ...unchanged.boards![0], name: 'A renamed' };
    expect(generatedCarvingProblem(unchanged)).toBeNull();
    unchanged.plan = { ...kDefaultPlan, material: 'mdf' };
    expect(generatedCarvingProblem(unchanged)).toMatch(/Recheck/);
  });

  it('checks rotated placement and board margin rather than accepting only nominal dimensions', () => {
    const base = job();
    base.carving!.items[0] = { ...item, x: 5, y: 5, rotation: 45 };
    expect(() =>
      createCarvingProposal(base, prepared(), { mode: 'replace', targetId: item.id, asset: source, detail: 'balanced' })
    ).toThrow(/fit/);
    const bad = prepared();
    bad.report = { ...bad.report, ok: false, errors: ['Uncut eye details'] };
    expect(() => createCarvingProposal(base, bad, { mode: 'add', asset: source, detail: 'balanced' })).toThrow(/checks/);
  });

  it('finds clear space for additions and refuses replacement overlaps instead of changing the checked union', () => {
    const base = job();
    const proposal = createCarvingProposal(base, prepared(), { mode: 'add', asset: source, detail: 'balanced' });
    const next = applyCarvingProposal(base, proposal);
    expect(next.carving!.items[0]).toEqual(base.carving!.items[0]);
    expect(next.carving!.items[1].x !== item.x || next.carving!.items[1].y !== item.y).toBe(true);
    base.carving!.items.push({ ...item, id: 'overlapping', x: item.x + 5 });
    expect(() =>
      createCarvingProposal(base, prepared(), { mode: 'replace', targetId: item.id, asset: source, detail: 'balanced' })
    ).toThrow(/overlaps/);
    const full = prepared();
    full.outline = [
      [
        { x: -50, y: -40 },
        { x: 50, y: -40 },
        { x: 50, y: 40 },
        { x: -50, y: 40 },
      ],
    ];
    full.width = 100;
    full.height = 80;
    expect(() => createCarvingProposal(base, full, { mode: 'add', asset: source, detail: 'balanced' })).toThrow(/no clear space/);
  });

  it('rechecks saved artwork in its original envelope after cleanup removed outlying detail', () => {
    const cleaned = prepared();
    cleaned.envelope = { width: 40, height: 30 };
    const proposal = createCarvingProposal(job(), cleaned, { mode: 'add', asset: source, detail: 'balanced' });
    expect(proposal.item.generated).toMatchObject({ width: 20, height: 10, envelope: { width: 40, height: 30 } });
    expect(savedCarvingEnvelope(proposal.item.generated!)).toEqual({ width: 40, height: 30 });
    // A later height edit scales the envelope with the ink instead of refitting into the ink box.
    expect(savedCarvingEnvelope(proposal.item.generated!, 5)).toEqual({ width: 20, height: 15 });
    const { envelope: _, ...legacy } = proposal.item.generated!;
    expect(savedCarvingEnvelope(legacy, 10)).toEqual({ width: 20, height: 10 });
  });
});
