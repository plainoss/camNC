import { evaluatedPartCopy, type CadPart, type CadPoint, type EvaluatedCadPart } from '@wbcnc/cad';

const round = (value: number) => Math.round(value * 1e6) / 1e6 || 0;
/** A closed contour has the same material whichever vertex or winding starts its evaluated polygon. */
function loop(points: readonly CadPoint[]): string {
  const vertices = points.map(point => [round(point.x), round(point.y)]);
  if (!vertices.length) return '[]';
  if (vertices.length > 1 && vertices[0][0] === vertices.at(-1)![0] && vertices[0][1] === vertices.at(-1)![1]) vertices.pop();
  const first = vertices.reduce(
    (best, point, index) =>
      point[0] < vertices[best][0] || (point[0] === vertices[best][0] && point[1] < vertices[best][1]) ? index : best,
    0
  );
  const forward = [...vertices.slice(first), ...vertices.slice(0, first)];
  const backward = [forward[0], ...forward.slice(1).reverse()];
  return [JSON.stringify(forward), JSON.stringify(backward)].sort()[0];
}

/** Physical material only: evaluated copy profiles/cuts are resolved by the caller; IDs and names are not geometry. */
export function cadTaskMaterial(part: EvaluatedCadPart): string {
  const cuts = (part.cuts ?? [])
    .map(cut =>
      JSON.stringify({
        side: cut.side,
        from: round(cut.from),
        to: round(cut.to),
        through: cut.through,
        outline: loop(cut.outline),
        islands: cut.islands.map(loop).sort(),
      })
    )
    .sort();
  return JSON.stringify({ thickness: round(part.thickness), outline: loop(part.outline), holes: part.holes.map(loop).sort(), cuts });
}

/** Resolve the geometry of each physical copy, so family-wide copy metadata cannot hide a changed sibling. */
export function cadTaskFamilyMaterial(source: CadPart, part: EvaluatedCadPart): Map<string, string> {
  return new Map([
    [source.id, cadTaskMaterial(part)],
    ...(source.copies ?? []).map(copy => [`${source.id}:${copy.id}`, cadTaskMaterial(evaluatedPartCopy(part, copy))] as const),
  ]);
}
