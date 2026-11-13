import { addLine, createCadPart } from './document';
import { evaluateCadFeatures } from './features';
import { CAD_CHORD_TOLERANCE, evaluateCadPart, pointInPolygon } from './geometry';
import { rotateVector, type Vec3 } from './placement';
import { regionInteriorPoint, sketchRegions } from './sketchRegions';
import type { CadCut, CadPart, CadPlacement, CadPoint, EvaluatedCadPart } from './types';

const kSame = 1e-6;
/** The smallest step a union leaves between parts of different heights; less is the same height. */
const kMinStep = 0.1;

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

export interface UnionInput {
  shape: EvaluatedCadPart;
  source: CadPart;
  at: CadPlacement;
}

/**
 * One part of the parts a Boolean › Union joins, in the first one's place and name: their outlines joined, as high as
 * the highest, and stepped down from the top where only lower ones were. It joins plain boards drawn on one plane and
 * extruded the same way from it; anything else is refused with the reason, as joining it needs a solid of another kind.
 */
export function unitedPart(host: UnionInput, tools: readonly UnionInput[]): { part: EvaluatedCadPart } | { refused: string } {
  const all = [host, ...tools];
  for (const { shape, source } of all) {
    if (shape.holes.length || shape.cuts?.length) return { refused: `${shape.name} has holes or cuts, which a union can't keep yet.` };
    if (source.drawnOn?.inward || source.symmetric || source.thin) return { refused: `${shape.name} isn't extruded up from its sketch.` };
  }
  // Every outline in the first part's sketch coordinates, on its sketch plane.
  const outlines: CadPoint[][] = [];
  for (const { shape, at } of all) {
    const points = shape.outline.map(p => toLocal(host.at, toWorld(at, [p.x, p.y, 0])));
    const up = toLocal(host.at, toWorld(at, [shape.outline[0]!.x, shape.outline[0]!.y, 1]));
    const tilt = [up[0] - points[0]![0], up[1] - points[0]![1], up[2] - points[0]![2] - 1];
    if (points.some(p => Math.abs(p[2]) > kSame) || tilt.some(v => Math.abs(v) > kSame))
      return { refused: `${shape.name} isn't drawn on the same plane, extruded the same way, as ${host.shape.name}.` };
    outlines.push(points.map(([x, y]) => ({ x, y })));
  }
  let sketch = createCadPart('Union').sketch;
  for (const outline of outlines)
    outline.forEach((a, i) => {
      const b = outline[(i + 1) % outline.length]!;
      sketch = addLine(sketch, { x1: a.x, y1: a.y, x2: b.x, y2: b.y });
    });
  const height = Math.max(...all.map(({ shape }) => shape.thickness));
  const regions: string[] = [];
  const cuts: CadCut[] = [];
  for (const region of sketchRegions(sketch, CAD_CHORD_TOLERANCE)) {
    const inside = regionInteriorPoint(region.points);
    if (!inside) continue;
    const covering = all.filter((_, i) => pointInPolygon(inside, outlines[i]!));
    if (!covering.length) continue;
    regions.push(region.id);
    const step = height - Math.max(...covering.map(({ shape }) => shape.thickness));
    if (step >= kMinStep) cuts.push({ type: 'cut', id: `union:${region.id}`, sketchId: sketch.id, regionId: region.id, depth: step });
  }
  const joined: CadPart = { ...createCadPart(host.shape.name, height), id: host.shape.partId, sketch, regions, features: cuts };
  const profile = evaluateCadPart(joined).part;
  const result = profile && evaluateCadFeatures(joined, profile);
  const problem = result?.diagnostics.find(d => d.severity === 'error');
  if (!result || problem) return { refused: problem?.message ?? `${host.shape.name} can't be joined with its tools.` };
  return { part: { ...result.part, partId: host.shape.partId, name: host.shape.name } };
}
