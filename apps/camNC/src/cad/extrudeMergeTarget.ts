import {
  evaluateCadPart,
  isCadPart,
  placePoint,
  polygonArea,
  removalTargets,
  resolveDrawnPlacements,
  rotateVector,
  type CadDocument,
  type CadPart,
} from '@wbcnc/cad';

/** Bounds are exact for these plain, axis-aligned rectangular boards; other shapes keep the usual support default. */
function rectangularBounds(document: CadDocument, part: CadPart) {
  // Raw profile bounds do not describe contact after a separate cut removes material.
  if (
    document.partCuts?.some(cut => !cut.suppressed && cut.targets.includes(part.id)) ||
    document.parts.some(
      step =>
        step.remove && !step.suppressed && step.extrude !== false && removalTargets(document, step).some(target => target.id === part.id)
    )
  )
    return null;
  const shape = evaluateCadPart(part).part;
  if (
    !shape ||
    !part.placement ||
    part.thin ||
    shape.outline.length !== 4 ||
    shape.holes.length ||
    part.features?.length ||
    part.fillets?.length
  )
    return null;
  const xs = shape.outline.map(p => p.x),
    ys = shape.outline.map(p => p.y);
  if (Math.abs(Math.abs(polygonArea(shape.outline)) - (Math.max(...xs) - Math.min(...xs)) * (Math.max(...ys) - Math.min(...ys))) > 1e-6)
    return null;
  for (const axis of [
    [1, 0, 0],
    [0, 1, 0],
    [0, 0, 1],
  ] as [number, number, number][])
    if (!rotateVector(part.placement.rotation, axis).some(value => Math.abs(value) > 1 - 1e-8)) return null;
  const points = shape.outline.flatMap(p => [0, shape.thickness].map(z => placePoint(part.placement, [p.x, p.y, z])));
  return [0, 1, 2].map(axis => [Math.min(...points.map(p => p[axis]!)), Math.max(...points.map(p => p[axis]!))]);
}

/** Prefer an actual face contact to an edge-only contact with the face the sketch was drawn on. */
export function extrudeMergeTarget(document: CadDocument, made: CadPart, supportId: string): string {
  const placed = resolveDrawnPlacements({ ...document, parts: document.parts.map(p => (p.id === made.id ? made : p)) }).document;
  const own = placed.parts.find(p => p.id === made.id)!,
    box = rectangularBounds(placed, own);
  if (!box) return supportId;
  const score = (part: CadPart) => {
    const other = rectangularBounds(placed, part);
    if (!other) return 0;
    const overlap = box.map(([lo, hi], axis) => Math.min(hi!, other[axis]![1]!) - Math.max(lo!, other[axis]![0]!));
    if (overlap.some(size => size < -1e-6)) return 0;
    const dimensions = overlap.filter(size => size > 1e-6);
    return dimensions.length < 2 ? 0 : dimensions.reduce((area, size) => area * size, 1);
  };
  const support = placed.parts.find(p => p.id === supportId);
  if (!support || score(support) > 0) return supportId;
  return (
    placed.parts
      .slice(0, placed.parts.indexOf(own))
      .filter(isCadPart)
      .map(part => ({ id: part.id, score: score(part) }))
      .filter(part => part.score > 0)
      .sort((a, b) => b.score - a.score)[0]?.id ?? supportId
  );
}
