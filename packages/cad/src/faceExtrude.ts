import { createCadPart } from './document';
import { drawnOnOutline } from './drawnOn';
import { faceSupportShape } from './faceSupport';
import type { CadDocument, CadDrawnOn, CadEntity, CadPart } from './types';

/** Modified face boundaries need a topology-aware profile; do not silently replace them with the original outline. */
export function faceExtrudeProblem(
  document: CadDocument,
  on: Extract<CadDrawnOn['on'], { partId: string }>,
  extrudeId?: string
): string | null {
  const support = document.parts.find(part => part.id === on.partId);
  if (!support) return 'The selected face’s part is gone.';
  if (
    support.features?.some(feature => feature.type === 'cut' && !feature.suppressed) ||
    support.fillets?.some(fillet => !fillet.suppressed) ||
    document.partCuts?.some(cut => !cut.suppressed && cut.targets.includes(support.id))
  )
    return 'Extruding faces modified by cuts or edge fillets is not supported yet.';
  if (document.parts.some(part => part.id !== extrudeId && part.addTo === support.id && !part.suppressed))
    return 'Extruding a face of a joined body is not supported yet.';
  return null;
}

/** A solid face is itself an extrusion profile; no separately editable sketch is introduced. */
export function newExtrudeOnFace(document: CadDocument, on: Extract<CadDrawnOn['on'], { partId: string }>, name: string): CadPart {
  const problem = faceExtrudeProblem(document, on);
  if (problem) throw new Error(problem);
  const part: CadPart = {
    ...createCadPart(name, 25),
    faceProfile: true,
    drawnOn: { on, offset: 0 },
  };
  return refreshFaceProfile(document, part);
}

/** Rebuild from the selected face after its supporting part changes, with stable profile IDs. */
export function refreshFaceProfile(document: CadDocument, part: CadPart): CadPart {
  if (!part.faceProfile) return part;
  const on = part.drawnOn?.on;
  const problem = !on || 'plane' in on ? 'No solid face selected.' : faceExtrudeProblem(document, on, part.id);
  const outline = problem ? null : drawnOnOutline(document, part);
  const support = on && 'partId' in on ? document.parts.find(candidate => candidate.id === on.partId) : undefined;
  const holes =
    support && on && 'partId' in on && (on.face === 'top' || on.face === 'underside')
      ? (faceSupportShape(support, on.copyId ? support.copies?.find(copy => copy.id === on.copyId) : undefined)?.holes ?? [])
      : [];
  const loops = outline
    ? [
        outline,
        ...holes.map(hole => (on && 'partId' in on && on.face === 'underside' ? hole.map(p => ({ x: -p.x, y: p.y })).reverse() : hole)),
      ]
    : [];
  const entities: CadEntity[] = part.sketch.entities.filter(e => e.faceEdge || e.id === `${part.sketch.id}:origin`);
  for (const [loop, points] of loops.entries()) {
    const id = (index: number) => `${part.sketch.id}:profile:${loop}:${index}`;
    entities.push(...points.map((p, index): CadEntity => ({ x: p.x, y: p.y, type: 'point', id: id(index), fixed: true })));
    entities.push(
      ...points.map(
        (_, index): CadEntity => ({
          type: 'line',
          id: `${id(index)}:edge`,
          startId: id(index),
          endId: id((index + 1) % points.length),
        })
      )
    );
  }
  if (JSON.stringify(entities) === JSON.stringify(part.sketch.entities)) return part;
  return { ...part, sketch: { ...part.sketch, entities, constraints: [] } };
}

/** Resolve supporting faces first, so a chain of face extrusions updates in one regeneration. */
export function resolveFaceProfiles(document: CadDocument): CadDocument {
  if (!document.parts.some(part => part.faceProfile)) return document;
  const parts = new Map(document.parts.map(part => [part.id, part])),
    visited = new Set<string>(),
    visiting = new Set<string>();
  const resolve = (part: CadPart): CadPart => {
    if (!part.faceProfile || visited.has(part.id)) return parts.get(part.id)!;
    // A malformed cyclic support must not recurse forever while a saved design is being opened.
    if (visiting.has(part.id)) return part;
    visiting.add(part.id);
    const on = part.drawnOn?.on,
      support = on && 'partId' in on ? parts.get(on.partId) : undefined;
    if (support) resolve(support);
    const next = refreshFaceProfile({ ...document, parts: [...parts.values()] }, part);
    parts.set(part.id, next);
    visiting.delete(part.id);
    visited.add(part.id);
    return next;
  };
  const next = document.parts.map(resolve);
  return next.every((part, i) => part === document.parts[i]) ? document : { ...document, parts: next };
}
