import { evaluateCadPart } from './geometry';
import { evaluateCadFeatures } from './features';
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
  const profile = evaluateCadPart(part).part;
  if (!profile || !copy) return profile;
  // Copy features can fill profile holes or cut their own floors; choose that material before reflecting it.
  const shape = evaluateCadFeatures(part, profile, copy.id).part;
  return copy.mirrored ? mirrorEvaluatedPart(shape) : shape;
}
