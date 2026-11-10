import { originId, type CadDocument } from '@wbcnc/cad';

/** The studio begins with one invisible default part containing only its fixed sketch origin. */
export function prepareEmptyStudio(document: CadDocument): { document: CadDocument; starterPartId?: string } {
  if (document.parts.length !== 1) return { document };
  const part = document.parts[0]!;
  if (
    part.name !== 'Part 1' ||
    part.thickness !== 18 ||
    Object.keys(part).some(key => !['id', 'name', 'thickness', 'sketch'].includes(key))
  )
    return { document };
  const sketch = part.sketch;
  if (
    sketch.constraints.length ||
    sketch.entities.length !== 1 ||
    Object.keys(sketch).some(key => !['id', 'entities', 'constraints'].includes(key))
  )
    return { document };
  const point = sketch.entities[0]!;
  if (
    point.type !== 'point' ||
    point.id !== originId(sketch) ||
    point.x !== 0 ||
    point.y !== 0 ||
    point.fixed !== true ||
    point.construction !== true ||
    Object.keys(point).some(key => !['id', 'type', 'x', 'y', 'fixed', 'construction'].includes(key))
  )
    return { document };
  // A script adding a real piece must not fail on the invisible, unextruded starter. Keep all source identities.
  return { document: { ...document, parts: [{ ...part, extrude: false }] }, starterPartId: part.id };
}
