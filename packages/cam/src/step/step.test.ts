import { describe, expect, it } from 'vitest';
import { profileFeatures, type SidedCut } from '../cutFeatures';
import { intersect as intersectPaths, union as unionPaths } from '../geom';
import { loadStep } from '../import';
import type { Mesh, Pt } from '../geom';
import { arcRuns } from './arcs';
import { brepProblems, partBrep, type Brep } from './brep';
import { stackedWalls } from './walls';
import { writeStep } from './writer';

/** A circle as the sketch tessellates it, within 0.01 mm. */
function circle(cx: number, cy: number, r: number, clockwise = false): Pt[] {
  const count = Math.max(4, Math.ceil((2 * Math.PI) / (2 * Math.acos(1 - 0.01 / r))));
  const points = Array.from({ length: count }, (_, i) => {
    const a = (2 * Math.PI * i) / count;
    return { x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) };
  });
  return clockwise ? points.reverse() : points;
}
const rect = (x0: number, y0: number, x1: number, y1: number): Pt[] => [
  { x: x0, y: y0 },
  { x: x1, y: y0 },
  { x: x1, y: y1 },
  { x: x0, y: y1 },
];
/** A rectangle with its corners rounded to radius r, counterclockwise. */
function rounded(x0: number, y0: number, x1: number, y1: number, r: number): Pt[] {
  const corners: [number, number, number][] = [
    [x1 - r, y0 + r, -Math.PI / 2],
    [x1 - r, y1 - r, 0],
    [x0 + r, y1 - r, Math.PI / 2],
    [x0 + r, y0 + r, Math.PI],
  ];
  const steps = Math.ceil(Math.PI / 2 / (2 * Math.acos(1 - 0.01 / r)));
  return corners.flatMap(([cx, cy, from]) =>
    Array.from({ length: steps + 1 }, (_, i) => {
      const a = from + (Math.PI / 2) * (i / steps);
      return { x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) };
    })
  );
}

function meshVolume(mesh: Mesh) {
  let volume = 0;
  const p = mesh.positions;
  for (let t = 0; t < mesh.indices.length; t += 3) {
    const [a, b, c] = [mesh.indices[t]!, mesh.indices[t + 1]!, mesh.indices[t + 2]!].map(i => [
      p[3 * i]!,
      p[3 * i + 1]!,
      p[3 * i + 2]!,
    ]) as [number[], number[], number[]];
    volume +=
      (a[0]! * (b[1]! * c[2]! - b[2]! * c[1]!) - a[1]! * (b[0]! * c[2]! - b[2]! * c[0]!) + a[2]! * (b[0]! * c[1]! - b[1]! * c[0]!)) / 6;
  }
  // Signed, so a solid that reads back inside out fails.
  return volume;
}
/** Edges of the mesh, welded by position, that aren't used once each way: none for a closed solid. */
function openEdges(mesh: Mesh) {
  const p = mesh.positions,
    ids = new Map<string, number>();
  const weld = (i: number) => {
    const key = `${Math.round(p[3 * i]! * 1e3)},${Math.round(p[3 * i + 1]! * 1e3)},${Math.round(p[3 * i + 2]! * 1e3)}`;
    return ids.get(key) ?? ids.set(key, ids.size).get(key)!;
  };
  const uses = new Map<string, number>();
  for (let t = 0; t < mesh.indices.length; t += 3) {
    const v = [weld(mesh.indices[t]!), weld(mesh.indices[t + 1]!), weld(mesh.indices[t + 2]!)];
    // A triangle whose corners weld together has no edges.
    if (v[0] === v[1] || v[1] === v[2] || v[0] === v[2]) continue;
    for (let k = 0; k < 3; k++) uses.set(`${v[k]},${v[(k + 1) % 3]}`, (uses.get(`${v[k]},${v[(k + 1) % 3]}`) ?? 0) + 1);
  }
  let open = 0;
  for (const [edge, n] of uses) {
    const [a, b] = edge.split(',');
    if (n !== 1 || uses.get(`${b},${a}`) !== 1) open++;
  }
  return open;
}
const count = (step: string, entity: string) => step.split(`=${entity}(`).length - 1;

describe('closed path runs', () => {
  it('finds a whole circle as two half arcs and leaves a square straight', () => {
    const runs = arcRuns(circle(0, 0, 5));
    expect(runs).toHaveLength(2);
    expect(runs.every(run => run.circle && Math.abs(run.circle.r - 5) < 1e-3 && run.ccw)).toBe(true);
    expect(arcRuns(rect(0, 0, 10, 10)).every(run => !run.circle)).toBe(true);
    // A drawn octagon's corners lie on a circle, but its sides are far from it.
    expect(arcRuns(circle(0, 0, 50).filter((_, i, all) => i % Math.floor(all.length / 8) === 0)).every(run => !run.circle)).toBe(true);
  });

  it('splits a rounded rectangle into four sides and four arcs', () => {
    const runs = arcRuns(rounded(0, 0, 100, 60, 8));
    expect(runs.filter(run => run.circle)).toHaveLength(4);
    expect(runs.filter(run => !run.circle)).toHaveLength(4);
    expect(runs.filter(run => run.circle).every(run => Math.abs(run.circle!.r - 8) < 1e-3)).toBe(true);
  });
});

it('counts an arc edge a loop only used part of as a problem', () => {
  const brep: Brep = { points: [], edges: [], faces: [], partialArcs: 2 };
  expect(brepProblems(brep)).toEqual(['2 arc edges used part way']);
});

describe('part STEP export', () => {
  const thickness = 18;
  const cuts: SidedCut[] = [
    { id: 'pocket', from: 0, to: 6, through: false, outline: rounded(50, 10, 90, 50, 5), islands: [] },
    { id: 'dado', from: 0, to: 4, through: false, outline: rect(0, 25, 120, 35), islands: [], side: 'underside' },
  ];
  const source = { thickness, outline: rounded(0, 0, 120, 60, 10), holes: [circle(25, 30, 8)], cuts };
  const { features, below } = profileFeatures(source);

  it('builds a closed shell with cylinders for the arcs', () => {
    const brep = partBrep(features, below);
    expect(brepProblems(brep)).toEqual([]);
    const cylinders = brep.faces.filter(face => face.surface.kind === 'cylinder');
    // The hole is two half cylinders; each rounded corner one, the dado splitting none of them: 2 + 4 + 4 pocket corners.
    expect(cylinders.length).toBeGreaterThanOrEqual(10);
    expect(brep.edges.filter(edge => edge.circle).length).toBeGreaterThan(0);
  });

  it('reads back as one solid with the same volume and size', async () => {
    const brep = partBrep(features, below);
    const step = writeStep([{ name: 'Side', solids: [{ brep }] }], { timestamp: '2026-11-11T00:00:00' });
    expect(step).toMatch(/^ISO-10303-21;/);
    expect(count(step, 'CYLINDRICAL_SURFACE')).toBe(brep.faces.filter(face => face.surface.kind === 'cylinder').length);
    expect(step).toContain("PRODUCT('Side','Side'");
    const { bodies } = await loadStep(new TextEncoder().encode(step));
    expect(bodies).toHaveLength(1);
    expect(openEdges(bodies[0]!.mesh)).toBe(0);
    const area = (path: Pt[]) =>
      Math.abs(path.reduce((sum, p, i) => sum + p.x * path[(i + 1) % path.length]!.y - path[(i + 1) % path.length]!.x * p.y, 0) / 2);
    const expected =
      (area(source.outline) - area(source.holes[0]!)) * thickness -
      area(cuts[0]!.outline) * 6 -
      (area(cuts[1]!.outline) - Math.PI * 8 * 8 * (10 / 16)) * 4;
    // The dado crosses the hole, so it removes less than its rectangle; checked against a direct sum within 1%.
    expect(meshVolume(bodies[0]!.mesh)).toBeGreaterThan(expected * 0.99);
    expect(meshVolume(bodies[0]!.mesh)).toBeLessThan(expected * 1.01);
  });

  it('places the solid with its matrix and writes the chosen unit', async () => {
    const brep = partBrep(features, below);
    // Stood on end and moved: x stays, y becomes z.
    const matrix = [1, 0, 0, 0, 0, 0, 1, 0, 0, -1, 0, 0, 200, 0, 0, 1];
    const step = writeStep([{ name: 'Moved', solids: [{ brep, matrix }] }], { unit: 'in' });
    expect(step).toContain("CONVERSION_BASED_UNIT('INCH'");
    const { bodies } = await loadStep(new TextEncoder().encode(step));
    expect(openEdges(bodies[0]!.mesh)).toBe(0);
    // Turned and moved, still the right way out.
    expect(meshVolume(bodies[0]!.mesh)).toBeGreaterThan(0);
    const p = bodies[0]!.mesh.positions;
    const xs: number[] = [],
      zs: number[] = [];
    for (let i = 0; i < p.length; i += 3) {
      xs.push(p[i]!);
      zs.push(p[i + 2]!);
    }
    // The reader gives millimetres whatever the file's unit.
    expect(Math.min(...xs)).toBeCloseTo(200, 1);
    expect(Math.max(...xs)).toBeCloseTo(320, 1);
    expect(Math.max(...zs) - Math.min(...zs)).toBeCloseTo(60, 1);
  });
});

describe('part STEP walls through a pocket depth', () => {
  // A panel with filleted corners, two through holes and a pocket in the middle that touches none of them.
  const thickness = 18;
  const source = {
    thickness,
    outline: rounded(0, 0, 400, 300, 25),
    holes: [circle(60, 60, 5), circle(340, 240, 17.5)],
    cuts: [{ id: 'pocket', from: 0, to: 6, through: false, outline: rect(150, 100, 250, 200), islands: [] }] as SidedCut[],
  };

  it('writes each wall, fillet and hole as one face from top to bottom', async () => {
    const { features, below } = profileFeatures(source);
    const brep = partBrep(features, below);
    expect(brepProblems(brep)).toEqual([]);
    const step = writeStep([{ name: 'Panel', solids: [{ brep }] }], { timestamp: '2026-11-11T00:00:00' });
    // Top, bottom, four outer walls, the pocket floor and its four walls; four fillets and each hole as two half cylinders.
    expect(count(step, 'PLANE')).toBe(11);
    expect(count(step, 'CYLINDRICAL_SURFACE')).toBe(8);
    expect(count(step, 'ADVANCED_FACE')).toBe(19);
    const sides = brep.faces.filter(face => face.surface.kind === 'cylinder' || face.surface.normal[2] === 0);
    const heights = (face: (typeof brep.faces)[number]) =>
      face.loops.flat().flatMap(({ edge }) => [brep.edges[edge]!.start, brep.edges[edge]!.end].map(v => brep.points[v]![2]));
    // Outer walls, fillets and holes run from the bottom to the top; the pocket's walls stop at its floor.
    const outer = sides.filter(face => Math.min(...heights(face)) === 0);
    expect(outer).toHaveLength(12);
    expect(outer.every(face => Math.max(...heights(face)) === thickness)).toBe(true);
    expect(sides.filter(face => Math.min(...heights(face)) === thickness - 6)).toHaveLength(4);
    // No vertex is left over at the pocket floor's height on the outer walls.
    expect(brep.points.filter(p => p[2] === thickness - 6)).toHaveLength(4);
    const { bodies } = await loadStep(new TextEncoder().encode(step));
    expect(bodies).toHaveLength(1);
    expect(bodies[0]!.mesh.faceRanges).toHaveLength(19);
    expect(openEdges(bodies[0]!.mesh)).toBe(0);
    expect(meshVolume(bodies[0]!.mesh)).toBeGreaterThan(0);
  });
});

describe('part STEP holes with an odd number of points', () => {
  /** A counterclockwise circle of exactly `count` points, starting `shift` points along. */
  const ring = (cx: number, cy: number, r: number, count: number, shift = 0): Pt[] =>
    Array.from({ length: count }, (_, i) => {
      const a = (2 * Math.PI * (i + shift)) / count;
      return { x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) };
    });

  it('keeps both halves whole where the slab above starts the circle elsewhere', () => {
    const ids = new Map<string, number>();
    const vertex = (x: number, y: number, z: number) => {
      const key = `${x.toFixed(6)},${y.toFixed(6)},${z}`;
      return ids.get(key) ?? ids.set(key, ids.size).get(key)!;
    };
    // A hole runs clockwise, with the material on its left.
    const hole = ring(0, 0, 5, 37).reverse();
    for (const shift of [1, 17, 19, 35]) {
      const turned = [...hole.slice(shift), ...hole.slice(0, shift)];
      const walls = stackedWalls(
        [
          { low: 0, high: 6, region: [hole] },
          { low: 6, high: 18, region: [turned] },
        ],
        [{ x: 0, y: 0, r: 5 }],
        vertex
      );
      expect(
        walls.map(wall => `${wall.low}-${wall.high}`),
        `shift ${shift}`
      ).toEqual(['0-18', '0-18']);
    }
  });

  it('writes a 37-point hole as two half cylinders from top to bottom', async () => {
    const thickness = 18;
    const { features, below } = profileFeatures({
      thickness,
      outline: rect(0, 0, 200, 100),
      holes: [ring(40, 50, 5, 37)],
      cuts: [{ id: 'pocket', from: 0, to: 6, through: false, outline: rect(100, 20, 160, 80), islands: [] }],
    });
    const brep = partBrep(features, below);
    expect(brepProblems(brep)).toEqual([]);
    const cylinders = brep.faces.filter(face => face.surface.kind === 'cylinder');
    expect(cylinders).toHaveLength(2);
    const heights = (face: (typeof brep.faces)[number]) =>
      face.loops.flat().flatMap(({ edge }) => [brep.edges[edge]!.start, brep.edges[edge]!.end].map(v => brep.points[v]![2]));
    expect(cylinders.map(face => [Math.min(...heights(face)), Math.max(...heights(face))])).toEqual([
      [0, thickness],
      [0, thickness],
    ]);
    const step = writeStep([{ name: 'Odd hole', solids: [{ brep }] }], { timestamp: '2026-11-11T00:00:00' });
    // Top, bottom, four outer walls, the pocket floor and its four walls, and the hole's two halves.
    expect(count(step, 'ADVANCED_FACE')).toBe(13);
    const { bodies } = await loadStep(new TextEncoder().encode(step));
    expect(bodies).toHaveLength(1);
    expect(bodies[0]!.mesh.faceRanges).toHaveLength(13);
    expect(openEdges(bodies[0]!.mesh)).toBe(0);
    const expected = (200 * 100 - Math.PI * 25) * thickness - 60 * 60 * 6;
    expect(meshVolume(bodies[0]!.mesh) / expected).toBeCloseTo(1, 2);
  });
});

describe('part STEP export with random cuts', () => {
  /** Small seeded generator, so a failing case can be replayed by its seed. */
  const random = (seed: number) => () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
  const area = (paths: Pt[][]) =>
    paths.reduce(
      (sum, path) => sum + path.reduce((s, p, i) => s + p.x * path[(i + 1) % path.length]!.y - path[(i + 1) % path.length]!.x * p.y, 0) / 2,
      0
    );

  it.each(Array.from({ length: 24 }, (_, i) => i + 1))('closes the shell and keeps the volume, seed %i', async seed => {
    const next = random(seed);
    const between = (lo: number, hi: number) => lo + (hi - lo) * next();
    const thickness = 18;
    const cuts: SidedCut[] = Array.from({ length: 2 + Math.floor(next() * 5) }, (_, i) => {
      const x = between(-10, 140),
        y = between(-10, 70),
        w = between(8, 60),
        h = between(8, 40),
        kind = next();
      const outline =
        kind < 0.33
          ? circle(x, y, Math.min(w, h) / 2)
          : kind < 0.66
            ? rounded(x, y, x + w, y + h, Math.min(w, h) / 4)
            : rect(x, y, x + w, y + h);
      const through = next() < 0.2;
      const from = 0,
        to = through ? thickness : between(2, 12);
      return { id: `c${i}`, from, to, through, outline, islands: [], side: next() < 0.4 ? 'underside' : 'top' };
    });
    const source = {
      thickness,
      outline: rounded(0, 0, 150, 80, between(2, 20)),
      holes: next() < 0.5 ? [circle(between(20, 130), between(20, 60), between(3, 10))] : [],
      cuts,
    };
    const { features, below, problem } = profileFeatures(source);
    if (problem) return;
    const brep = partBrep(features, below);
    expect(brepProblems(brep), `seed ${seed}`).toEqual([]);
    const { bodies } = await loadStep(new TextEncoder().encode(writeStep([{ name: 'Random', solids: [{ brep }] }])));
    expect(bodies).toHaveLength(1);
    expect(openEdges(bodies[0]!.mesh), `seed ${seed}`).toBe(0);
    // The same material as the slabs CAM machines.
    const levels = [...(features.meshLevels ?? features.levels)];
    const underLevels = [...(below?.meshLevels ?? below?.levels ?? [])];
    const heights = [...new Set([0, ...levels.map(l => l.z), ...underLevels.map(l => thickness - l.z)])].sort((a, b) => a - b);
    let expected = 0;
    heights.slice(0, -1).forEach((low, i) => {
      const high = heights[i + 1]!,
        middle = (low + high) / 2;
      const above = unionPaths(levels.filter(l => l.z > middle).flatMap(l => l.region));
      const region = underLevels.length
        ? intersectPaths(above, unionPaths(underLevels.filter(l => l.z > thickness - middle).flatMap(l => l.region)))
        : above;
      expected += area(region) * (high - low);
    });
    expect(meshVolume(bodies[0]!.mesh) / expected).toBeCloseTo(1, 2);
  });
});
