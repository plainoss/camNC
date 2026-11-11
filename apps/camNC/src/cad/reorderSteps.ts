import { cadFolderForPart, cadFolderIssue, designSteps, type CadDocument, type CadPart } from '@wbcnc/cad';
import type { DesignStep } from '@wbcnc/cad';

/** The parts a part is built on: drawn on, sketched from, added to or cut into. They come before it. */
function builtOn(part: CadPart): string[] {
  const on = part.drawnOn?.on;
  return [...(on && !('plane' in on) ? [on.partId] : []), ...(part.sketchOf ? [part.sketchOf] : []), ...(part.addTo ? [part.addTo] : [])];
}

const partLevel = (step: DesignStep) =>
  step.kind === 'sketch' || step.kind === 'extrude' || (step.kind as string) === 'move' || step.kind === 'copy' || step.kind === 'pattern';
const featureLevel = (step: DesignStep) => step.kind === 'faceSketch' || step.kind === 'cut';
/** Steps that move their whole part when dropped on another part: its own, and the fillets that round it. */
const movesPart = (step: DesignStep) => partLevel(step) || step.kind === 'fillet';

/**
 * A step dragged to just before another in the feature list, as the reference reorders: a part's steps move together,
 * its fillets with them, ahead of the part dropped on; a face sketch or cut moves among its own part's, and a fillet
 * among its part's fillets. A step can't go ahead of what it's built on, nor behind what's built on it; that says why.
 */
export function reorderedSteps(
  document: CadDocument,
  dragged: DesignStep,
  target: DesignStep
): { document: CadDocument } | { error: string } {
  const name = (id: string) => document.parts.find(part => part.id === id)?.name ?? 'a part';
  // A Cut parts step's row follows the last of the parts it uses, so it's no part's place to drop on.
  if (target.kind === 'partCut') return { error: 'A Cut parts step comes after the parts it uses, so steps can’t be dropped on it.' };
  // A part's sketch, extrude, transform and copies keep their places among its own steps.
  if (partLevel(dragged) && dragged.partId === target.partId) return { document };
  if (movesPart(dragged) && dragged.partId !== target.partId) {
    const sourceFolder = cadFolderForPart(document, dragged.partId);
    const targetFolder = cadFolderForPart(document, target.partId);
    // Moving one member out, or inserting into the middle, would split a saved contiguous group.
    if (sourceFolder?.id !== targetFolder?.id && (sourceFolder || (targetFolder?.partIds[0] !== target.partId && targetFolder)))
      return { error: 'Move the folder as a group, or unpack it before moving its parts.' };
    const moving = document.parts.find(part => part.id === dragged.partId)!;
    const rest = document.parts.filter(part => part.id !== moving.id);
    const at = rest.findIndex(part => part.id === target.partId);
    const parts = [...rest.slice(0, at), moving, ...rest.slice(at)];
    const index = new Map(parts.map((part, i) => [part.id, i]));
    for (const part of parts)
      for (const base of builtOn(part))
        if ((index.get(base) ?? -1) > index.get(part.id)!)
          return { error: `${part.name} is built on ${name(base)}, so it comes after it.` };
    const next = {
      ...document,
      revision: document.revision + 1,
      parts,
      ...(document.folders && {
        folders: document.folders.map(folder => ({
          ...folder,
          partIds: parts.filter(part => folder.partIds.includes(part.id)).map(part => part.id),
        })),
      }),
    };
    const issue = cadFolderIssue(next);
    return issue ? { error: issue } : { document: next };
  }
  const part = document.parts.find(candidate => candidate.id === dragged.partId)!;
  const extrude = designSteps(document).find(step => step.id === `${part.id}:extrude`)?.label ?? `Extrude · ${part.name}`;
  if (featureLevel(dragged)) {
    if (dragged.partId !== target.partId)
      return { error: `${dragged.label} is on ${part.name}’s faces, so it stays with ${part.name}’s steps.` };
    if (featureLevel(target)) return movedFeature(document, part, dragged.id, target.id);
    // Dropped on a later step of its part, a fillet, copy or pattern, it goes last of the part's sketches and cuts.
    if (target.kind === 'fillet' || target.kind === 'copy' || target.kind === 'pattern')
      return movedFeature(document, part, dragged.id, null);
    return { error: `${dragged.label} is on ${part.name}’s faces, so it comes after ${extrude}.` };
  }
  if (dragged.kind === 'fillet') {
    if (target.kind === 'fillet') return movedFillet(document, part, dragged.id, target.id);
    // Copies and patterns copy the rounded part, so a fillet dropped on one goes last of the part's fillets.
    if (target.kind === 'copy' || target.kind === 'pattern') return movedFillet(document, part, dragged.id, null);
    if (target.kind === 'sketch' || target.kind === 'extrude')
      return { error: `${dragged.label} rounds the edges ${extrude} makes, so it comes after it.` };
    return { error: `${dragged.label} rounds ${part.name}’s edges, so it stays with its fillets, after ${target.label}.` };
  }
  return { error: 'That step can’t go there: a part’s steps move together.' };
}

const withPart = (document: CadDocument, part: CadPart): CadDocument => ({
  ...document,
  revision: document.revision + 1,
  parts: document.parts.map(candidate => (candidate.id === part.id ? part : candidate)),
});

/** A part's face sketch or cut moved to just before another, or last with null, as long as it stays after its sketch. */
function movedFeature(
  document: CadDocument,
  part: CadPart,
  id: string,
  beforeId: string | null
): { document: CadDocument } | { error: string } {
  const features = part.features ?? [];
  const moving = features.find(feature => feature.id === id);
  if (!moving || id === beforeId) return { document };
  const rest = features.filter(feature => feature !== moving);
  const at = beforeId === null ? rest.length : rest.findIndex(feature => feature.id === beforeId);
  if (at < 0) return { document };
  const next = [...rest.slice(0, at), moving, ...rest.slice(at)];
  const sketchAt = new Map(next.flatMap((feature, i) => (feature.type === 'sketch' ? [[feature.sketch.id, i] as const] : [])));
  const cutAt = new Map(next.flatMap((feature, i) => (feature.type === 'cut' ? [[feature.id, i] as const] : [])));
  for (const [i, feature] of next.entries()) {
    if (feature.type === 'cut' && (sketchAt.get(feature.sketchId) ?? -1) > i) return { error: 'A cut comes after the sketch it cuts.' };
    if (feature.type === 'sketch' && typeof feature.on === 'object' && (cutAt.get(feature.on.floorOf) ?? -1) > i)
      return { error: 'A sketch on a pocket’s floor comes after the cut that makes the floor.' };
  }
  return { document: withPart(document, { ...part, features: next }) };
}

/** A part's fillet moved to just before another, or last with null: they round its corners in that order. */
function movedFillet(document: CadDocument, part: CadPart, id: string, beforeId: string | null): { document: CadDocument } {
  const fillets = part.fillets ?? [];
  const moving = fillets.find(fillet => fillet.id === id);
  if (!moving || id === beforeId) return { document };
  const rest = fillets.filter(fillet => fillet !== moving);
  const at = beforeId === null ? rest.length : rest.findIndex(fillet => fillet.id === beforeId);
  if (at < 0) return { document };
  return { document: withPart(document, { ...part, fillets: [...rest.slice(0, at), moving, ...rest.slice(at)] }) };
}

/**
 * What dropping one step on another would do, shown while it's dragged: the row of the list as it stands that the step
 * would then sit just before, why it can't go there, or null when it would stay where it is.
 */
export function reorderDrop(
  document: CadDocument,
  draggedId: string,
  targetId: string
): { before: string | null } | { error: string } | null {
  const steps = designSteps(document);
  const dragged = steps.find(step => step.id === draggedId);
  const target = steps.find(step => step.id === targetId);
  if (!dragged || !target || dragged.id === target.id) return null;
  const result = reorderedSteps(document, dragged, target);
  if ('error' in result) return result;
  const order = designSteps(result.document).map(step => step.id);
  // A drop that leaves the order as it was isn't a move.
  if (order.every((id, i) => id === steps[i]?.id)) return null;
  // Within its part the step lands just ahead of the step it's dropped on; on another part, the part's steps land ahead
  // of the first of that part's. Named from the list as it stands, not from what follows the moved run afterwards: a Cut
  // parts step listed after the moved part moves along with it, and the line would then be drawn at that Cut's row,
  // below where the steps land.
  if (dragged.partId === target.partId) return { before: target.id };
  return { before: steps.find(step => step.partId === target.partId && partLevel(step))?.id ?? target.id };
}
