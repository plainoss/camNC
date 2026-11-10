import { addLine, createCadPart, newCadId, originId } from './document';
import { evaluatedPartCopy } from './copies';
import { evaluateCadDocument, cadSketchRegions, setCutDepth } from './features';
import { polygonArea, pointInPolygon } from './geometry';
import { cadCopyName } from './partPatterns';
import type { CadDocument, CadFaceSketch, CadPart, CadPartCopy, CadPoint, CadSketch, EvaluatedCadCut } from './types';

function polygonSketch(loops: CadPoint[][]): CadSketch {
  let sketch = createCadPart().sketch;
  for (const loop of loops)
    for (const [index, point] of loop.entries()) {
      const next = loop[(index + 1) % loop.length]!;
      sketch = addLine(sketch, { x1: point.x, y1: point.y, x2: next.x, y2: next.y });
    }
  // A detached mirror is a geometric snapshot; its fixed polygon vertices are ordinary editable sketch points.
  sketch.entities = sketch.entities.map(entity => (entity.type === 'point' ? { ...entity, fixed: true } : entity));
  return sketch;
}

/** Reflection is baked at the evaluator's chord tolerance so constraints cannot silently reflect with the wrong sign. */
export function detachedMirroredPart(
  document: CadDocument,
  source: CadPart,
  copy: CadPartCopy,
  name?: string
): CadPart | { error: string } {
  const evaluated = evaluateCadDocument(document);
  const original = evaluated.parts.find(part => part.partId === source.id);
  if (!original)
    return {
      error:
        evaluated.diagnostics.find(diagnostic => diagnostic.severity === 'error')?.message ?? 'Fix this part before detaching its mirror.',
    };
  const shape = evaluatedPartCopy(original, copy);
  const part = createCadPart(name?.trim() || cadCopyName(source, source.copies!.indexOf(copy)), shape.thickness);
  part.sketch = polygonSketch([shape.outline, ...shape.holes]);
  if (copy.placement) part.placement = structuredClone(copy.placement);
  const made: { cut: EvaluatedCadCut; id: string }[] = [];
  for (const cut of shape.cuts ?? []) {
    const floor =
      cut.from > 1e-6
        ? made.find(
            previous =>
              previous.cut.side === cut.side &&
              Math.abs(previous.cut.to - cut.from) < 1e-6 &&
              pointInPolygon(cut.outline[0]!, previous.cut.outline)
          )
        : undefined;
    if (cut.from > 1e-6 && !floor) return { error: 'This cut has no editable pocket floor. Detach a plain copy instead.' };
    const loops = [cut.outline, ...cut.islands].map(loop =>
      cut.side === 'underside' ? loop.map(point => ({ ...point, x: -point.x })).reverse() : loop
    );
    const face: CadFaceSketch = {
      type: 'sketch',
      id: newCadId(),
      on: floor ? { floorOf: floor.id } : cut.side === 'underside' ? 'underside' : 'top',
      sketch: polygonSketch(loops),
    };
    part.features = [...(part.features ?? []), face];
    const area = Math.abs(polygonArea(loops[0]!));
    const region = cadSketchRegions(part, face.sketch.id).find(
      region => Math.abs(Math.abs(polygonArea(region.points)) - area) < 1e-4 * Math.max(1, area)
    );
    if (!region) return { error: 'This mirrored cut could not be converted to an editable sketch.' };
    const next = setCutDepth(
      { version: 2, id: newCadId(), name: part.name, revision: 0, parts: [part] },
      part.id,
      face.sketch.id,
      region.id,
      cut.through ? 'through' : cut.to - cut.from
    );
    part.features = next.parts[0]!.features;
    made.push({ cut, id: part.features!.at(-1)!.id });
  }
  // Preserve the fixed sketch origin expected by the portable document format.
  const origin = part.sketch.entities.find(entity => entity.id === originId(part.sketch));
  if (origin?.type === 'point') {
    origin.x = 0;
    origin.y = 0;
  }
  return part;
}
