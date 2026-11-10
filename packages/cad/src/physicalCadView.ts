import { activeDesign } from './suppression';
import type { CadDocument, CadEvaluation } from './types';

/**
 * Read-only projection shared by geometry consumers (assembly, faces, corners and backdrops), never saved or solved.
 * The source is returned unchanged for old documents. An ordered evaluation supplies both poses and availability;
 * its local material is kept beside this projection. Callers must retain the original source for edits and reload.
 */
export function physicalCadView(source: CadDocument, evaluation: CadEvaluation): { document: CadDocument; parts: CadEvaluation['parts'] } {
  if (source.operationOrder === undefined) return { document: source, parts: evaluation.parts };
  if (!evaluation.available || !evaluation.placements) throw Error('Ordered geometry needs its evaluated physical state.');
  const available = new Set(evaluation.available),
    poses = evaluation.placements;
  const document = activeDesign(source);
  // Availability already resolves consumption at this stage. A legacy renderer/CAM reader must not hide bodies
  // using a later saved consume flag, or repeat a completed consume when reading this finite projection.
  const partCuts = document.partCuts?.map(({ consumeTools: _consume, ...step }) => step);
  return {
    parts: evaluation.parts.filter(part => available.has(part.partId)),
    document: {
      ...document,
      partCuts,
      parts: document.parts
        .filter(part => available.has(part.id))
        .map(part => {
          // A physical view freezes regeneration links. Legacy face/corner readers may regenerate copy placements before
          // reading them; doing that here must keep evaluated poses rather than recreating the original pattern slots.
          const { pattern: _pattern, ...body } = part;
          return {
            ...body,
            placement: poses[part.id],
            copies: part.copies
              ?.filter(copy => available.has(`${part.id}:${copy.id}`))
              .map(copy => {
                const { offset: _offset, turn: _turn, along: _along, mirror: _mirror, pattern: _copyPattern, ...instance } = copy;
                return { ...instance, placement: poses[`${part.id}:${copy.id}`] };
              }),
          };
        }),
    },
  };
}
