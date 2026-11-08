import { relieveLoopCorners } from './cornerRelief';
import { newCadId } from './document';
import { cadDrawnOnSupports, effectivePlacement } from './drawnOn';
import { evaluateCadFeatures } from './features';
import { evaluateCadPart, polygonArea } from './geometry';
import { rotateVector, type Vec3 } from './placement';
import type { CadDiagnostic, CadDocument, CadPartCut, CadPlacement, CadPoint, EvaluatedCadCut, EvaluatedCadPart } from './types';

const conjugate = ([x, y, z, w]: readonly number[]) => [-x!, -y!, -z!, w!];
const toWorld = (placement: CadPlacement, point: Vec3): Vec3 => {
  const turned = rotateVector(placement.rotation, point);
  return [turned[0] + placement.position[0], turned[1] + placement.position[1], turned[2] + placement.position[2]];
};
const toLocal = (placement: CadPlacement, point: Vec3): Vec3 =>
  rotateVector(conjugate(placement.rotation), [
    point[0] - placement.position[0],
    point[1] - placement.position[1],
    point[2] - placement.position[2],
  ]);
const kSquare = 1e-6;

/** The part's box in its own frame: its outline's extent, and its thickness. */
function box(part: EvaluatedCadPart): [Vec3, Vec3] {
  const xs = part.outline.map(p => p.x),
    ys = part.outline.map(p => p.y);
  return [
    [Math.min(...xs), Math.min(...ys), 0],
    [Math.max(...xs), Math.max(...ys), part.thickness],
  ];
}

/** Whether one placement's axes each lie along one of the other's, as panels in a carcass do. */
function square(a: CadPlacement, b: CadPlacement): boolean {
  return (
    [
      [1, 0, 0],
      [0, 1, 0],
      [0, 0, 1],
    ] as Vec3[]
  ).every(axis => {
    const turned = rotateVector(conjugate(a.rotation), rotateVector(b.rotation, axis));
    return turned.filter(c => Math.abs(Math.abs(c) - 1) < kSquare).length === 1;
  });
}

/**
 * Where a housed part reaches into the part housing it, in that part's own frame, or why it can't be worked out. Both
 * parts need placing, square to each other.
 */
function overlap(into: EvaluatedCadPart, intoAt: CadPlacement, housed: EvaluatedCadPart, housedAt: CadPlacement) {
  const [hlo, hhi] = box(housed);
  const corners = [0, 1, 2, 3, 4, 5, 6, 7].map(i =>
    toLocal(intoAt, toWorld(housedAt, [i & 1 ? hhi[0] : hlo[0], i & 2 ? hhi[1] : hlo[1], i & 4 ? hhi[2] : hlo[2]]))
  );
  const [ilo, ihi] = box(into);
  const lo = [0, 1, 2].map(a => Math.max(ilo[a]!, Math.min(...corners.map(c => c[a]!)))) as Vec3,
    hi = [0, 1, 2].map(a => Math.min(ihi[a]!, Math.max(...corners.map(c => c[a]!)))) as Vec3;
  if (lo.some((value, a) => hi[a]! - value < kSquare))
    return { error: 'The housed part doesn’t reach into the other, so there’s nothing to cut.' };
  return { lo, hi };
}

/** How much of a polygon lies inside a rectangle. */
function areaWithin(polygon: CadPoint[], lo: Vec3, hi: Vec3): number {
  const edges: [(p: CadPoint) => number, (a: CadPoint, b: CadPoint) => CadPoint][] = [
    [p => p.x - lo[0], (a, b) => ({ x: lo[0], y: a.y + ((b.y - a.y) * (lo[0] - a.x)) / (b.x - a.x) })],
    [p => hi[0] - p.x, (a, b) => ({ x: hi[0], y: a.y + ((b.y - a.y) * (hi[0] - a.x)) / (b.x - a.x) })],
    [p => p.y - lo[1], (a, b) => ({ x: a.x + ((b.x - a.x) * (lo[1] - a.y)) / (b.y - a.y), y: lo[1] })],
    [p => hi[1] - p.y, (a, b) => ({ x: a.x + ((b.x - a.x) * (hi[1] - a.y)) / (b.y - a.y), y: hi[1] })],
  ];
  let points = polygon;
  for (const [inside, meet] of edges) {
    const kept: CadPoint[] = [];
    points.forEach((p, i) => {
      const q = points[(i + 1) % points.length]!;
      if (inside(p) >= 0) kept.push(p);
      if (inside(p) >= 0 !== inside(q) >= 0) kept.push(meet(p, q));
    });
    points = kept;
  }
  return points.length < 3 ? 0 : Math.abs(polygonArea(points));
}

/**
 * Whether a tool is solid all through where it reaches into a target: its outline fills that region, and no hole or
 * cut of its own takes anything out of it. Only then is the region it cuts the box it fills.
 */
function solidWithin(tool: EvaluatedCadPart, toolAt: CadPlacement, into: EvaluatedCadPart, intoAt: CadPlacement): boolean {
  const found = overlap(tool, toolAt, into, intoAt);
  if ('error' in found) return true;
  const { lo, hi } = found;
  const full = (hi[0] - lo[0]) * (hi[1] - lo[1]),
    slack = Math.max(full * 1e-6, kSquare);
  if (areaWithin(tool.outline, lo, hi) < full - slack) return false;
  if (tool.holes.some(hole => areaWithin(hole, lo, hi) > slack)) return false;
  return !(tool.cuts ?? []).some(cut => {
    const [bottom, top] = cut.side === 'top' ? [tool.thickness - cut.to, tool.thickness - cut.from] : [cut.from, cut.to];
    return top > lo[2] + kSquare && bottom < hi[2] - kSquare && areaWithin(cut.outline, lo, hi) > slack;
  });
}

/**
 * The cuts each "cut parts" step makes, added to the parts it cuts. Wherever a tool part reaches into a target part, as
 * placed, that much of the target is cut away, widened by the step's clearance on every side inside the target, and as
 * deep as the tool reaches in plus the clearance, from whichever face it enters. It follows the parts as they move and change size. The
 * target's corner relief gives it bones. A tool that doesn't reach a target leaves it alone, and one with a hole, notch or
 * cut where it reaches in is left out with a warning rather than cut as a block.
 */
export function applyPartCuts(
  document: CadDocument,
  parts: readonly EvaluatedCadPart[]
): { parts: EvaluatedCadPart[]; diagnostics: CadDiagnostic[] } {
  const diagnostics: CadDiagnostic[] = [];
  const byId = new Map(parts.map(part => [part.partId, part]));
  // A tool cuts with the shape it has before any step cuts it, so two parts can cut each other.
  const before = new Map(byId);
  const sources = new Map(document.parts.map(part => [part.id, part]));
  const supports = cadDrawnOnSupports(document);
  for (const step of document.partCuts ?? []) {
    let made = 0;
    const warn = (message: string) => diagnostics.push({ code: 'part-cut-unresolved', severity: 'warning', message });
    for (const targetId of step.targets)
      for (const toolId of step.tools) {
        if (toolId === targetId) continue;
        const intoSource = sources.get(targetId),
          toolSource = sources.get(toolId);
        const into = byId.get(targetId),
          tool = before.get(toolId);
        if (!intoSource || !toolSource || !into || !tool) continue;
        const intoAt = effectivePlacement(intoSource, supports),
          toolAt = effectivePlacement(toolSource, supports);
        // A part that hasn't been placed isn't anywhere yet, so it reaches into nothing.
        if (!intoAt || !toolAt) continue;
        if (!square(intoAt, toolAt)) {
          warn(`${toolSource.name} isn't square to ${intoSource.name}, so it can't be cut from it yet.`);
          continue;
        }
        const found = overlap(into, intoAt, tool, toolAt);
        if ('error' in found) continue;
        if (!solidWithin(tool, toolAt, into, intoAt)) {
          warn(`${toolSource.name} isn't a plain block where it reaches into ${intoSource.name}, so it can't be cut from it yet.`);
          continue;
        }
        const { lo, hi } = found,
          t = into.thickness;
        const fromTop = hi[2] >= t - kSquare,
          fromBelow = lo[2] <= kSquare;
        if (!fromTop && !fromBelow) {
          warn(`${toolSource.name} sits inside ${intoSource.name} without reaching either face, so it can't be cut.`);
          continue;
        }
        // The clearance widens each side inside the part. A side that runs off its edge stays there, open.
        const [ilo, ihi] = box(into),
          c = step.clearance;
        const x0 = lo[0] > ilo[0] + kSquare ? lo[0] - c : lo[0],
          x1 = hi[0] < ihi[0] - kSquare ? hi[0] + c : hi[0],
          y0 = lo[1] > ilo[1] + kSquare ? lo[1] - c : lo[1],
          y1 = hi[1] < ihi[1] - kSquare ? hi[1] + c : hi[1];
        const outline = [
          { x: x0, y: y0 },
          { x: x1, y: y0 },
          { x: x1, y: y1 },
          { x: x0, y: y1 },
        ];
        // The clearance deepens it too, so the tool doesn't bottom out. Reaching within it of the far face cuts through.
        const reach = Math.min(t, (fromTop && fromBelow ? t : fromTop ? t - lo[2] : hi[2]) + c),
          through = reach >= t - kSquare;
        const relief = intoSource.cornerRelief
          ? relieveLoopCorners(outline, true, intoSource.cornerRelief.diameter, into.outline)
          : { points: outline, skipped: 0 };
        const current = byId.get(targetId)!;
        const cut: EvaluatedCadCut = {
          id: `cut-parts:${step.id}:${toolId}`,
          regionId: `cut-parts:${step.id}:${toolId}`,
          side: fromTop ? 'top' : 'underside',
          from: 0,
          to: through ? t : reach,
          through,
          outline: relief.points,
          islands: [],
        };
        byId.set(targetId, { ...current, cuts: [...(current.cuts ?? []), cut] });
        made++;
      }
    if (!made && step.tools.length && step.targets.length)
      warn('A "cut parts" step cuts nothing: none of its tools reach into its targets.');
  }
  return { parts: parts.map(part => byId.get(part.partId)!), diagnostics };
}

/**
 * One evaluated part with the cuts other parts make in it, for views that evaluate a part on its own. The tools are
 * evaluated as they are in `document`.
 */
export function withPartCuts(document: CadDocument, part: EvaluatedCadPart): EvaluatedCadPart {
  const steps = (document.partCuts ?? []).filter(step => step.targets.includes(part.partId));
  if (!steps.length) return part;
  const toolIds = [...new Set(steps.flatMap(step => step.tools))].filter(id => id !== part.partId);
  const tools = toolIds.flatMap(id => {
    const source = document.parts.find(candidate => candidate.id === id);
    const profile = source && evaluateCadPart(source).part;
    return source && profile ? [evaluateCadFeatures(source, profile).part] : [];
  });
  return applyPartCuts(document, [part, ...tools]).parts[0]!;
}

/** Adds a step that cuts the tool parts out of the target parts, with this much room around them. */
export function addPartCut(
  document: CadDocument,
  tools: string[],
  targets: string[],
  clearance: { value: number; expression?: string }
): { document: CadDocument; id: string } {
  const step: CadPartCut = {
    id: newCadId(),
    tools,
    targets,
    clearance: clearance.value,
    ...(clearance.expression && { clearanceExpression: clearance.expression }),
  };
  return { id: step.id, document: { ...document, revision: document.revision + 1, partCuts: [...(document.partCuts ?? []), step] } };
}

/** Changes a step's parts or clearance. A clearance given without an expression drops the step's old one. */
export function updatePartCut(document: CadDocument, id: string, change: Partial<Omit<CadPartCut, 'id'>>): CadDocument {
  return {
    ...document,
    revision: document.revision + 1,
    partCuts: (document.partCuts ?? []).map(step => {
      if (step.id !== id) return step;
      const next = { ...step, ...change };
      if (change.clearance !== undefined && !change.clearanceExpression) delete next.clearanceExpression;
      return next;
    }),
  };
}

export function removePartCut(document: CadDocument, id: string): CadDocument {
  const next: CadDocument = {
    ...document,
    revision: document.revision + 1,
    partCuts: (document.partCuts ?? []).filter(step => step.id !== id),
  };
  if (!next.partCuts!.length) delete next.partCuts;
  return next;
}
