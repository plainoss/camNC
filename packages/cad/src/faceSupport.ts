import { evaluateCadPart } from './geometry';
import { mirrorEvaluatedPart } from './copies';
import type { CadPart, CadPartCopy } from './types';

/** Copies share sketch identities; mirrored copies reflect their outline before resolving an edge face. */
export function faceSupportPart(part: CadPart, copy?: CadPartCopy): CadPart {
  if (!copy?.mirrored) return part;
  return {
    ...part,
    sketch: {
      ...part.sketch,
      entities: part.sketch.entities.map(entity => (entity.type === 'point' ? { ...entity, x: -entity.x } : entity)),
    },
  };
}

/** Reflect evaluated curves as a whole; reflecting only sketch points would leave arc angles unchanged. */
export function faceSupportShape(part: CadPart, copy?: CadPartCopy) {
  const shape = evaluateCadPart(part).part;
  return shape && copy?.mirrored ? mirrorEvaluatedPart(shape) : shape;
}
