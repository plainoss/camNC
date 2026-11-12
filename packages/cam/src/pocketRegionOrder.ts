import type { PathD } from 'clipper2-ts';

type Pt = { x: number; y: number };

/** One pass path: `index` in `groups[group]`. */
export interface RegionNode {
  group: number;
  index: number;
}

export interface RegionLinks {
  nodes: RegionNode[];
  /** By node: the nodes it follows, and the nodes following it. */
  preds: number[][];
  succs: number[][];
  id: (group: number, index: number) => number;
}

/**
 * Pocket passes come in groups cut one after another, each clearing next to the group before: a closed pocket's rings
 * from the centre out, an open pocket's rows from the waste in. Where a group holds several paths, the pocket has split
 * into regions (lobes past a narrow neck, the arms of an edge groove) that don't touch each other.
 *
 * The links say which earlier path each path clears next to: any part of the two within `reach`. Missing a link would
 * let a path be cut before the one it follows, so `reach` is generous and a path that finds nothing in the group just
 * before keeps looking further back until a group has a path near it. An extra link only keeps two regions in their
 * old order.
 */
export function regionLinks(groups: PathD[][], reach: number, closed: boolean): RegionLinks {
  const nodes: RegionNode[] = groups.flatMap((paths, group) => paths.map((_, index) => ({ group, index })));
  const first = groups.map((_, g) => groups.slice(0, g).reduce((sum, paths) => sum + paths.length, 0));
  const id = (group: number, index: number) => first[group] + index;
  const preds: number[][] = nodes.map(() => []),
    succs: number[][] = nodes.map(() => []);
  const link = (from: number, to: number) => {
    preds[to].push(from);
    succs[from].push(to);
  };
  const step = reach / 2,
    within = reach + step;
  const grids: (Grid | undefined)[] = [];
  const gridOf = (g: number) => (grids[g] ??= sampleGrid(groups[g], closed, step, within));
  for (let g = 1; g < groups.length; g++)
    groups[g].forEach((path, i) => {
      for (let back = g - 1; back >= 0; back--) {
        // A single path following a single path: nothing else it could follow.
        if (groups[back].length === 1 && groups[g].length === 1) {
          link(id(back, 0), id(g, i));
          return;
        }
        const near = nearPaths(gridOf(back), path, closed, step);
        for (const j of near) link(id(back, j), id(g, i));
        if (near.length) return;
      }
    });
  return { nodes, preds, succs, id };
}

/**
 * Cuts the regions of `groups` (see regionLinks; `links` are theirs) one at a time, each through all its depths before
 * the next: `cut` gets a region's paths in group order and returns where the bit ended. A region starts once every path
 * it follows is cut, and the nearest ready one goes next. With no split there is one region, in the original order.
 *
 * A group's paths that follow the same paths, directly or through each other (the rings either side of an island), are
 * one band, as are a group's first paths that lead into the same ones. A region is a run of bands that each lead into
 * exactly one band, and are the only band leading into it.
 */
export function forEachRegion(
  groups: PathD[][],
  links: RegionLinks,
  closed: boolean,
  from: Pt,
  cut: (nodes: RegionNode[]) => Pt | undefined
): void {
  const { nodes, preds, succs, id } = links;
  const bandOf = new Array<number>(nodes.length);
  const bands: number[][] = [];
  groups.forEach((paths, g) => {
    const parent = new Map<number, number>();
    const find = (n: number): number => {
      const up = parent.get(n) ?? n;
      if (up === n) return n;
      const root = find(up);
      parent.set(n, root);
      return root;
    };
    const ids = paths.map((_, i) => id(g, i));
    for (const n of ids) for (const m of preds[n].length ? preds[n] : succs[n]) parent.set(find(n), find(m));
    const byRoot = new Map<number, number>();
    for (const n of ids) {
      const root = find(n);
      if (!byRoot.has(root)) byRoot.set(root, bands.push([]) - 1);
      bandOf[n] = byRoot.get(root)!;
      bands[bandOf[n]].push(n);
    }
  });
  const bandPreds = bands.map(band => new Set(band.flatMap(n => preds[n].map(p => bandOf[p]))));
  const bandSuccs = bands.map(band => new Set(band.flatMap(n => succs[n].map(q => bandOf[q]))));
  const regionOf = new Array<number>(bands.length).fill(-1);
  const regions: number[][] = [];
  bands.forEach((_, b) => {
    if (regionOf[b] >= 0) return;
    const region = [b];
    regionOf[b] = regions.length;
    for (let at = b; bandSuccs[at].size === 1; ) {
      const [next] = bandSuccs[at];
      if (bandPreds[next].size !== 1) break;
      at = next;
      region.push(at);
      regionOf[at] = regions.length;
    }
    regions.push(region);
  });
  const waiting = regions.map(region => [...bandPreds[region[0]]].map(b => regionOf[b]));
  const done = new Set<number>();
  let pos = from;
  while (done.size < regions.length) {
    let best = -1,
      bestDistance = Infinity;
    regions.forEach((region, r) => {
      if (done.has(r) || waiting[r].some(w => !done.has(w))) return;
      for (const n of bands[region[0]]) {
        const path = groups[nodes[n].group][nodes[n].index];
        const d = closed ? path.reduce((m, q) => Math.min(m, dist2(q, pos)), Infinity) : dist2(path[0], pos);
        if (d < bestDistance) {
          bestDistance = d;
          best = r;
        }
      }
    });
    // Regions only wait on regions in earlier groups, so one is always ready; this guards a broken link graph.
    if (best < 0) throw new Error('Pocket regions wait on each other: no region is ready to cut');
    done.add(best);
    pos = cut(regions[best].flatMap(b => bands[b].map(n => nodes[n]))) ?? pos;
  }
}

const dist2 = (a: Pt, b: Pt) => (a.x - b.x) ** 2 + (a.y - b.y) ** 2;

/** Points along `path` at most `step` apart. */
function samples(path: PathD, closed: boolean, step: number): Pt[] {
  const out: Pt[] = [];
  const n = closed ? path.length : path.length - 1;
  for (let i = 0; i < n; i++) {
    const a = path[i],
      b = path[(i + 1) % path.length];
    const k = Math.max(1, Math.ceil(Math.sqrt(dist2(a, b)) / step));
    for (let j = 0; j < k; j++) out.push({ x: a.x + ((b.x - a.x) * j) / k, y: a.y + ((b.y - a.y) * j) / k });
  }
  if (!closed || !out.length) out.push(...path.slice(-1));
  return out;
}

/** A grid cell's key; cells are at least the link reach wide, so this covers any plan a pocket has. */
const cellKey = (i: number, j: number) => (i + 0x100000) * 0x200000 + (j + 0x100000);

/** Samples of a group's paths by grid cell, with the group's bounding box. */
type Grid = { cell: number; paths: number; box: Box; at: Map<number, { p: Pt; path: number }[]> };
type Box = { x0: number; y0: number; x1: number; y1: number };

const boxOf = (points: Pt[]): Box =>
  points.reduce((b, p) => ({ x0: Math.min(b.x0, p.x), y0: Math.min(b.y0, p.y), x1: Math.max(b.x1, p.x), y1: Math.max(b.y1, p.y) }), {
    x0: Infinity,
    y0: Infinity,
    x1: -Infinity,
    y1: -Infinity,
  });

function sampleGrid(paths: PathD[], closed: boolean, step: number, cell: number): Grid {
  const at = new Map<number, { p: Pt; path: number }[]>();
  const all: Pt[] = [];
  paths.forEach((path, i) =>
    samples(path, closed, step).forEach(p => {
      all.push(p);
      const key = cellKey(Math.floor(p.x / cell), Math.floor(p.y / cell));
      const list = at.get(key);
      if (list) list.push({ p, path: i });
      else at.set(key, [{ p, path: i }]);
    })
  );
  return { cell, paths: paths.length, box: boxOf(all), at };
}

/** The paths of `grid` with a sample within one cell width of a sample of `path`. */
function nearPaths(grid: Grid, path: PathD, closed: boolean, step: number): number[] {
  const found = new Set<number>();
  const within = grid.cell,
    w2 = within * within;
  const query = samples(path, closed, step);
  const box = boxOf(query);
  if (box.x0 > grid.box.x1 + within || box.x1 < grid.box.x0 - within || box.y0 > grid.box.y1 + within || box.y1 < grid.box.y0 - within)
    return [];
  for (const q of query) {
    const cx = Math.floor(q.x / grid.cell),
      cy = Math.floor(q.y / grid.cell);
    for (let dx = -1; dx <= 1; dx++)
      for (let dy = -1; dy <= 1; dy++)
        for (const { p, path: i } of grid.at.get(cellKey(cx + dx, cy + dy)) ?? []) if (!found.has(i) && dist2(p, q) <= w2) found.add(i);
    if (found.size === grid.paths) break;
  }
  return [...found].sort((a, b) => a - b);
}
