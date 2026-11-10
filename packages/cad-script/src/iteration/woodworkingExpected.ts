// Independent intended material from the handwritten recipes. No CAD imports,
// source-coordinate reads, solver results, evaluated outlines or placements.
export type RecipeBox = { min: number[]; max: number[] };
type Box = RecipeBox;
export interface TrayIntent {
  width: number;
  depth: number;
  height: number;
  board: number;
  rebate: number;
  dividers: number;
  shift: number;
  fit: number;
  tools: 'family' | 'third';
  suppressed: boolean;
}
export interface JointIntent {
  board: number;
  legWidth: number;
  legHeight: number;
  frameLength: number;
  frameHeight: number;
  sideDepth: number;
  station: number;
  fingers: number;
  fit: number;
  target: 'Side' | 'Front';
  suppressed: boolean;
}
const box = (min: number[], max: number[]): Box => ({ min, max });
const volume = (b: Box) => b.max.reduce((v, n, i) => v * (n - b.min[i]), 1);

const pair = (a: string, b: string) => [a, b].sort();

export function trayExpected(p: TrayIntent) {
  const { width: W, depth: D, height: H, board: T, rebate: R, dividers: N, shift: S, fit: C } = p;
  const pitch = (W - 2 * T) / (N + 1),
    selected = p.tools === 'family' ? Array.from({ length: N }, (_, i) => i + 1) : [3];
  const cutSlots = p.suppressed ? [] : selected.filter(i => i <= N);
  const solids: Record<string, Box> = {
    Base: box([0, 0, 0], [W, D, T]),
    'Left wall': box([0, 0, T], [T, D, H]),
    'Right wall': box([W - T, 0, T], [W, D, H]),
    'Front wall': box([T, 0, T], [W - T, T, H]),
    'Back wall': box([T, D - T, T], [W - T, D, H]),
  };
  const grooveBoxes: Record<string, Box> = {};
  const probes = [];
  for (let j = 1; j <= N; j++) {
    const name = j === 1 ? 'Divider' : `Divider ${j}`,
      center = T + j * pitch + S;
    solids[name] = box([center - T / 2, T, T - R], [center + T / 2, D - T, H]);
    if (cutSlots.includes(j)) grooveBoxes[name] = box([center - T / 2 - C, T - C, T - R - C], [center + T / 2 + C, D - T + C, T]);
    probes.push({
      body: 'Base',
      point: [center, D / 2, T - R / 2],
      material: !cutSlots.includes(j),
      reason: `Independent housing occupancy for divider slot ${j}`,
    });
  }
  const collisions = Array.from({ length: N }, (_, i) => i + 1)
    .filter(j => !cutSlots.includes(j))
    .map(j => pair('Base', j === 1 ? 'Divider' : `Divider ${j}`));
  return {
    frame: { unit: 'millimeter', x: '+X width', y: '+Y depth', z: '+Z up', registration: 'fixed world; no best-fit transforms' },
    parameters: p,
    pitch,
    bodies: Object.entries(solids).map(([name, bounds]) => ({
      name,
      bounds,
      volume: volume(bounds) - (name === 'Base' ? Object.values(grooveBoxes).reduce((s, g) => s + volume(g), 0) : 0),
      components: 1,
    })),
    expectedBodyCount: 5 + N,
    baseGrooves: Object.entries(grooveBoxes).map(([tool, bounds]) => ({ tool, target: 'Base', bounds, depth: R + C })),
    collisionPairs: collisions,
    materialProbes: probes,
    sourceChoice: {
      keepTools: true,
      target: 'Base',
      tools:
        p.tools === 'family' ? 'Divider source family, seed and all copies' : 'exact third physical divider; source pattern copy slot 2',
    },
    identityRule: 'All six source part IDs remain owned by their named panel. Existing divider copy slots retain IDs when the count grows.',
  };
}

export function jointExpected(p: JointIntent) {
  const { board: T, legWidth: L, legHeight: H, frameLength: F, frameHeight: K, sideDepth: D, station: Y, fingers: N, fit: C } = p;
  const solids: Record<string, Box> = {
    'Leg A': box([-L / 2, -T / 2, 0], [L / 2, T / 2, H]),
    'Leg B': box([-T / 2, -L / 2, 0], [T / 2, L / 2, H]),
    Front: box([0, Y, 0], [F, Y + T, K]),
    Side: box([F - T, Y, 0], [F, Y + D, K]),
  };
  const removals: Record<string, Box[]> = { 'Leg A': [], 'Leg B': [], Front: [], Side: [] };
  const bands = [];
  if (!p.suppressed) {
    removals['Leg A'] = [box([-T / 2 - C, -T / 2, H / 2 - C], [T / 2 + C, T / 2, H])];
    removals['Leg B'] = [box([-T / 2, -T / 2 - C, 0], [T / 2, T / 2 + C, H / 2 + C])];
    for (let i = 0; i < N; i++) {
      const target = i % 2 === 0 ? p.target : p.target === 'Side' ? 'Front' : 'Side';
      const z0 = Math.max(0, K - ((i + 1) * K) / N - C),
        z1 = Math.min(K, K - (i * K) / N + C);
      const bounds = target === 'Side' ? box([F - T, Y, z0], [F, Y + T + C, z1]) : box([F - T - C, Y, z0], [F, Y + T, z1]);
      removals[target].push(bounds);
      bands.push({ index: i, target, z: [z0, z1], bounds });
    }
  }
  const probes = [];
  for (const [z, a, b] of [
    [H / 4, true, false],
    [(3 * H) / 4, false, true],
  ] as const) {
    probes.push({
      body: 'Leg A',
      point: [0, 0, z],
      material: p.suppressed || a,
      reason: 'Half-lap phase fixed independently: Leg A keeps lower half',
    });
    probes.push({
      body: 'Leg B',
      point: [0, 0, z],
      material: p.suppressed || b,
      reason: 'Half-lap phase fixed independently: Leg B keeps upper half',
    });
  }
  for (let i = 0; i < N; i++)
    for (const name of ['Front', 'Side']) {
      const removed = i % 2 === 0 ? p.target : p.target === 'Side' ? 'Front' : 'Side';
      probes.push({
        body: name,
        point: [F - T / 2, Y + T / 2, K - ((i + 0.5) * K) / N],
        material: p.suppressed || name !== removed,
        reason: `Positive-world-end finger band ${i}; equal volumes cannot establish phase`,
      });
    }
  if (C > 0)
    for (let boundary = 1; boundary < N; boundary++)
      for (const side of [-1, 1])
        for (const name of ['Front', 'Side']) {
          probes.push({
            body: name,
            point: [F - T / 2, Y + T / 2, (boundary * K) / N + (side * C) / 2],
            material: p.suppressed,
            reason: 'Clearance removes material on both sides of every interior band boundary',
          });
        }
  return {
    frame: { unit: 'millimeter', x: '+X', y: '+Y', z: '+Z up', registration: 'fixed world; no best-fit transforms' },
    parameters: p,
    bodies: Object.entries(solids).map(([name, bounds]) => ({
      name,
      bounds,
      volume: volume(bounds) - removals[name].reduce((s, b) => s + volume(b), 0),
      components: 1,
    })),
    expectedBodyCount: 4,
    removals,
    bands,
    materialProbes: probes,
    collisionPairs: p.suppressed ? [pair('Leg A', 'Leg B'), pair('Front', 'Side')] : [],
    sourceChoice: {
      keepAllFourBodies: true,
      fingerPhase: `Count from +world Z end; ${p.target} loses zero-based even bands 0,2,...; the other corner body loses odd bands 1,3,...`,
      halfLapPhase: 'Leg A upper slot, Leg B lower slot',
    },

    identityRule: 'Named source body IDs retain their semantic owner across all valid states.',
    phaseSpecification: 'The default counts from the positive world end, as specified before this workflow in857690a/#295.',
  };
}
