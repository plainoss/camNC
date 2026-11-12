import { describe, expect, it } from 'vitest';
import { profileFeatures, type SidedCut } from '../cutFeatures';
import type { Mesh, Pt } from '../geom';
import { loadStep } from '../import';
import { brepProblems, partBrep } from './brep';
import { partSlabs, wrongPairs } from './pairCheck';
import { brepShells, shellVolume } from './shells';
import { writeStep } from './writer';

const rect = (x0: number, y0: number, x1: number, y1: number): Pt[] => [
  { x: x0, y: y0 },
  { x: x1, y: y0 },
  { x: x1, y: y1 },
  { x: x0, y: y1 },
];
/** A circle as the sketch tessellates it, within 0.01 mm. */
function circle(cx: number, cy: number, r: number): Pt[] {
  const count = Math.max(4, Math.ceil((2 * Math.PI) / (2 * Math.acos(1 - 0.01 / r))));
  return Array.from({ length: count }, (_, i) => {
    const a = (2 * Math.PI * i) / count;
    return { x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) };
  });
}
const through = (id: string, outline: Pt[]): SidedCut => ({ id, from: 0, to: 18, through: true, outline, islands: [] });
const count = (step: string, entity: string) => step.split(`=${entity}(`).length - 1;
const area = (paths: Pt[][]) =>
  paths.reduce(
    (sum, path) => sum + path.reduce((s, p, i) => s + p.x * path[(i + 1) % path.length]!.y - path[(i + 1) % path.length]!.x * p.y, 0) / 2,
    0
  );

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
  // Signed, so a piece read back as a void fails.
  return volume;
}

function part(cuts: SidedCut[], outline = rect(0, 0, 100, 60)) {
  const { features, below, problem } = profileFeatures({ thickness: 18, outline, holes: [], cuts });
  return { brep: partBrep(features, below), slabs: partSlabs(features, below), problem };
}

/** Small seeded generator, so a failing case can be replayed by its seed. */
const random = (seed: number) => () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
/** Cuts on a coarse grid, so their corners and sides touch often, in a 150 x 80 part. */
function touchingCuts(seed: number): SidedCut[] {
  const next = random(seed);
  const between = (lo: number, hi: number) => lo + (hi - lo) * next();
  return Array.from({ length: 2 + Math.floor(next() * 5) }, (_, i) => {
    const x = 10 * Math.round(between(0, 14)),
      y = 10 * Math.round(between(0, 7)),
      w = 10 * Math.round(between(1, 5)),
      h = 10 * Math.round(between(1, 4));
    const outline = next() < 0.2 ? circle(x, y, 10) : rect(x, y, x + w, y + h);
    const isThrough = next() < 0.5;
    const to = isThrough ? 18 : 6 * Math.ceil(between(0, 2));
    return { id: `c${i}`, from: 0, to, through: isThrough, outline, islands: [], side: next() < 0.4 ? 'underside' : 'top' };
  });
}

describe('part STEP where four faces meet at one edge', () => {
  // Two through cuts from opposite edges whose corners touch at (50, 30): the part's two halves meet only along the
  // vertical line there.
  const cuts = [through('a', rect(20, -10, 50, 30)), through('b', rect(50, 30, 80, 70))];

  it('pairs each face with the one it shares material with', () => {
    const { brep, slabs, problem } = part(cuts);
    expect(problem).toBeUndefined();
    expect(brepProblems(brep)).toEqual([]);
    const corner = brep.edges.filter(edge => [edge.start, edge.end].every(v => brep.points[v]![0] === 50 && brep.points[v]![1] === 30));
    expect(corner).toHaveLength(2);
    expect(wrongPairs(brep, slabs)).toEqual([]);
  });

  it('writes each half as a solid of its own', async () => {
    const { brep } = part(cuts);
    const half = (20 * 60 + 30 * 30) * 18;
    expect(brepShells(brep).map(shell => Math.round(shellVolume(shell)))).toEqual([half, half]);
    const step = writeStep([{ name: 'Corner', solids: [{ brep }] }]);
    expect(count(step, 'MANIFOLD_SOLID_BREP')).toBe(2);
    const { bodies } = await loadStep(new TextEncoder().encode(step));
    const volumes = bodies.map(body => meshVolume(body.mesh));
    expect(volumes.reduce((sum, v) => sum + v, 0) / (2 * half)).toBeCloseTo(1, 3);
    expect(volumes.every(v => v > 0)).toBe(true);
  });

  it('pairs the faces right in random parts with touching cuts', () => {
    const wrong: string[] = [];
    for (let seed = 1; seed <= 300; seed++) {
      const { brep, slabs, problem } = part(touchingCuts(seed), rect(0, 0, 150, 80));
      if (problem || brepProblems(brep).length) continue;
      wrong.push(...wrongPairs(brep, slabs).map(message => `seed ${seed}: ${message}`));
      // Every piece is a solid with material in it, and together they're all of it.
      const shells = brepShells(brep).map(shell => ({ faces: shell.faces.length, volume: shellVolume(shell) }));
      if (shells.some(shell => shell.faces < 3 || shell.volume <= 0)) wrong.push(`seed ${seed}: shells ${JSON.stringify(shells)}`);
      const material = slabs.reduce((sum, slab) => sum + area(slab.region) * (slab.high - slab.low), 0);
      const total = shells.reduce((sum, shell) => sum + shell.volume, 0);
      if (Math.abs(total / material - 1) > 0.01) wrong.push(`seed ${seed}: volume ${total} of ${material}`);
    }
    expect(wrong).toEqual([]);
  });
});

describe('part STEP pieces', () => {
  it('writes a piece that only touches the part at a corner as a solid of its own', async () => {
    // Four through cuts around the square (50, 20)-(60, 30), which keeps only its corner at (60, 30) on the part.
    const cuts = [
      through('below', rect(40, 10, 70, 20)),
      through('left', rect(40, 10, 50, 40)),
      through('above', rect(40, 30, 60, 40)),
      through('right', rect(60, 10, 70, 30)),
    ];
    const { brep, slabs, problem } = part(cuts);
    expect(problem).toBeUndefined();
    expect(brepProblems(brep)).toEqual([]);
    expect(wrongPairs(brep, slabs)).toEqual([]);
    const piece = 10 * 10 * 18,
      rest = (100 * 60 - 700 - 100) * 18;
    const shells = brepShells(brep);
    expect(shells.map(shell => Math.round(shellVolume(shell))).sort((a, b) => a - b)).toEqual([piece, rest]);
    // The piece is a box: top, bottom and four walls.
    expect(shells.map(shell => shell.faces.length)).toContain(6);
    const step = writeStep([{ name: 'Pieces', solids: [{ brep }] }]);
    expect(count(step, 'MANIFOLD_SOLID_BREP')).toBe(2);
    expect(count(step, 'CLOSED_SHELL')).toBe(2);
    expect(step).toContain("MANIFOLD_SOLID_BREP('Pieces 1'");
    const { bodies } = await loadStep(new TextEncoder().encode(step));
    const volumes = bodies.map(body => meshVolume(body.mesh));
    expect(volumes.every(v => v > 0)).toBe(true);
    expect(volumes.reduce((sum, v) => sum + v, 0) / (piece + rest)).toBeCloseTo(1, 3);
  });

  it('leaves out a sliver wall of no width where cut boundaries coincide', async () => {
    // A circle's chord lands on a rectangle's side here, leaving two walls back to back with nothing between them.
    const { brep, problem } = part(touchingCuts(114), rect(0, 0, 150, 80));
    expect(problem).toBeUndefined();
    expect(brepProblems(brep)).toEqual([]);
    const shells = brepShells(brep);
    expect(shells).toHaveLength(1);
    expect(brep.faces.length - shells[0]!.faces.length).toBe(2);
    const step = writeStep([{ name: 'Sliver', solids: [{ brep }] }]);
    expect(count(step, 'MANIFOLD_SOLID_BREP')).toBe(1);
    expect(count(step, 'ADVANCED_FACE')).toBe(shells[0]!.faces.length);
    const { bodies } = await loadStep(new TextEncoder().encode(step));
    expect(bodies).toHaveLength(1);
    expect(meshVolume(bodies[0]!.mesh)).toBeGreaterThan(0);
  });
});
