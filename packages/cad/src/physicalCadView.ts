import { activeDesign } from './suppression';
import { isCadBody } from './extrudeSteps';
import { physicalJoinedCopies } from './physicalJoinedCopies';
import { cadCopyName } from './partPatterns';
import type { CadDocument, CadEvaluation, CadPart, CadSketch } from './types';

/** Retain generated coordinates and geometry; a physical query must not rebind them to a later source pose. */
function frozenSketch(sketch: CadSketch): CadSketch {
  let changed = false;
  const entities = sketch.entities.map(entity => {
    if (entity.type !== 'point' || !entity.used) return entity;
    const { used: _used, ...point } = entity;
    changed = true;
    return point;
  });
  return changed ? { ...sketch, entities } : sketch;
}

function frozenBody(part: CadPart): CadPart {
  const { drawnOn: _drawnOn, moved: _moved, faceProfile: _faceProfile, sketchOf: _sketchOf, addedRegions: _addedRegions, ...body } = part;
  return {
    ...body,
    sketch: frozenSketch(part.sketch),
    // Same-sketch Add rows are not physical pieces. Preserve their generated region union before dropping its link.
    ...(part.regions && part.addedRegions?.length && { regions: [...new Set([...part.regions, ...part.addedRegions])] }),
    ...(part.features && {
      features: part.features.map(feature => {
        // Remove generators are absent too; keep their cached cuts and named floors as ordinary local geometry.
        const { removedBy: _removedBy, ...cached } = feature;
        if (cached.type !== 'sketch') return cached;
        const sketch = frozenSketch(cached.sketch);
        return sketch === cached.sketch ? cached : { ...cached, sketch };
      }),
    }),
  };
}

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
  const projected: CadDocument = {
    ...document,
    partCuts,
    parts: document.parts
      .filter(part => available.has(part.id))
      .map(part => {
        // A physical view freezes regeneration links. Legacy face/corner readers may regenerate copy placements before
        // reading them; doing that here must keep evaluated poses rather than recreating the original pattern slots.
        // Even an unplaced physical body has evaluated local geometry. Its Used/shared/face links must not
        // regenerate that geometry against later poses; source-only sketches were filtered out above.
        const { pattern: _pattern, ...body } = frozenBody(part);
        return {
          ...body,
          placement: poses[part.id],
          copies: part.copies
            ?.filter(copy => available.has(`${part.id}:${copy.id}`))
            .map(copy => {
              const { offset: _offset, turn: _turn, along: _along, mirror: _mirror, pattern: _copyPattern, ...instance } = copy;
              // Pattern slots keep their logical names after generation metadata is frozen or a sibling is absent.
              const authored = source.parts.find(candidate => candidate.id === part.id) ?? part;
              const index = authored.copies?.findIndex(candidate => candidate.id === copy.id) ?? -1;
              return { ...instance, name: cadCopyName(authored, index), placement: poses[`${part.id}:${copy.id}`] };
            }),
        };
      }),
  };
  // Only material with an available host belongs in this projection; source Add rows remain stored after consumption.
  const parts = projected.parts.filter(part => isCadBody(projected, part));
  const built = new Set(parts.map(part => part.id));
  return {
    parts: evaluation.parts.filter(part => built.has(part.partId)),
    document: physicalJoinedCopies({ ...projected, parts }, source),
  };
}
