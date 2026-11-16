import { createCadPart, withFaceEdges, type CadDocument, type CadDrawnOn, type CadValueScope } from '@wbcnc/cad';
import { isBlank } from './editorHelpers';
import { kDefaultThickness } from './studioExtrude';

/** Create the sketch's part on its support, respecting the material variable and the rollback insertion point. */
export function newSketchPart(
  document: CadDocument,
  on: CadDrawnOn['on'],
  options: {
    variables: CadValueScope;
    studio: boolean;
    thickness?: number;
    datum?: string;
    rolledTo: string | null;
  }
) {
  const { variables, studio, thickness, datum, rolledTo } = options;
  const board = ['material', 'board', 'thickness'].find(name => Object.hasOwn(variables, name));
  const added = createCadPart(`Part ${document.parts.length + 1}`, board ? variables[board]!.value : (thickness ?? kDefaultThickness));
  // A blank first part is the one being sketched, rather than a second beside it.
  const blank = document.parts.length === 1 && isBlank(document.parts[0]!);
  const placed = {
    ...(blank ? document.parts[0]! : added),
    ...(board && { thicknessExpression: board }),
    drawnOn: { on, offset: (datum && document.planes?.find(plane => plane.id === datum)?.offset) || 0, ...(datum && { datum }) },
    ...(studio && { extrude: false as const }),
  };
  // Keeping the supporting face's edges lets the new sketch remain tied to that face.
  const part = { ...placed, sketch: withFaceEdges(document, placed) };
  const parts = document.parts;
  const at = rolledTo
    ? parts.findIndex(
        candidate =>
          rolledTo.startsWith(`${candidate.id}:`) ||
          candidate.features?.some(f => f.id === rolledTo) ||
          candidate.copies?.some(c => c.id === rolledTo) ||
          candidate.pattern?.id === rolledTo
      )
    : -1;
  return {
    part,
    inserted: at >= 0,
    document: {
      ...document,
      revision: document.revision + 1,
      parts: blank ? [part] : at >= 0 ? [...parts.slice(0, at + 1), part, ...parts.slice(at + 1)] : [...parts, part],
    },
  };
}
