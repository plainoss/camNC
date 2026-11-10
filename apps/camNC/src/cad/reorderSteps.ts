import type { CadDocument, CadPart } from '@wbcnc/cad';
import type { DesignStep } from '@wbcnc/cad';

/** The parts a part is built on: drawn on, sketched from, added to or cut into. They come before it. */
function builtOn(part: CadPart): string[] {
  const on = part.drawnOn?.on;
  return [...(on && !('plane' in on) ? [on.partId] : []), ...(part.sketchOf ? [part.sketchOf] : []), ...(part.addTo ? [part.addTo] : [])];
}

const partLevel = (step: DesignStep) =>
  step.kind === 'sketch' || step.kind === 'extrude' || (step.kind as string) === 'move' || step.kind === 'copy' || step.kind === 'pattern';

/**
 * A step dragged to just before another in the feature list, as the reference reorders: a part's steps move together,
 * ahead of the part dropped on, and a face sketch or cut moves among its own part's. A step can't go ahead of what it's
 * built on, nor behind what's built on it; that says why instead.
 */
export function reorderedSteps(
  document: CadDocument,
  dragged: DesignStep,
  target: DesignStep
): { document: CadDocument } | { error: string } {
  const name = (id: string) => document.parts.find(part => part.id === id)?.name ?? 'a part';
  if (partLevel(dragged) && partLevel(target)) {
    if (dragged.partId === target.partId) return { document };
    const moving = document.parts.find(part => part.id === dragged.partId)!;
    const rest = document.parts.filter(part => part.id !== moving.id);
    const at = rest.findIndex(part => part.id === target.partId);
    const parts = [...rest.slice(0, at), moving, ...rest.slice(at)];
    const index = new Map(parts.map((part, i) => [part.id, i]));
    for (const part of parts)
      for (const base of builtOn(part))
        if ((index.get(base) ?? -1) > index.get(part.id)!)
          return { error: `${part.name} is built on ${name(base)}, so it comes after it.` };
    return { document: { ...document, revision: document.revision + 1, parts } };
  }
  const featureLevel = (step: DesignStep) => step.kind === 'faceSketch' || step.kind === 'cut';
  if (featureLevel(dragged) && featureLevel(target) && dragged.partId === target.partId) {
    const part = document.parts.find(candidate => candidate.id === dragged.partId)!;
    const features = part.features ?? [];
    const moving = features.find(feature => feature.id === dragged.id);
    if (!moving || dragged.id === target.id) return { document };
    const rest = features.filter(feature => feature !== moving);
    const at = rest.findIndex(feature => feature.id === target.id);
    if (at < 0) return { document };
    const next = [...rest.slice(0, at), moving, ...rest.slice(at)];
    const sketchAt = new Map(next.flatMap((feature, i) => (feature.type === 'sketch' ? [[feature.sketch.id, i] as const] : [])));
    const cutAt = new Map(next.flatMap((feature, i) => (feature.type === 'cut' ? [[feature.id, i] as const] : [])));
    for (const [i, feature] of next.entries()) {
      if (feature.type === 'cut' && (sketchAt.get(feature.sketchId) ?? -1) > i) return { error: 'A cut comes after the sketch it cuts.' };
      if (feature.type === 'sketch' && typeof feature.on === 'object' && (cutAt.get(feature.on.floorOf) ?? -1) > i)
        return { error: 'A sketch on a pocket’s floor comes after the cut that makes the floor.' };
    }
    return {
      document: {
        ...document,
        revision: document.revision + 1,
        parts: document.parts.map(candidate => (candidate.id === part.id ? { ...candidate, features: next } : candidate)),
      },
    };
  }
  return { error: 'That step can’t go there: a part’s steps move together, and a cut stays with its part.' };
}
