import { filletLineCorners } from './fillet';
import { CAD_CHORD_TOLERANCE, pointInPolygon, polygonArea } from './geometry';
import { pointEquivalence } from './pointEquivalence';
import { areaPoint } from './regionProfile';
import { sketchRegions } from './sketchRegions';
import type { CadDiagnostic, CadDocument, CadPart } from './types';

/** A Fillet step that can't round all its corners: why, and the corners it leaves sharp. */
export interface CadEdgeFilletProblem {
  filletId: string;
  message: string;
  corners: string[];
}

// Parts are replaced, never changed in place, so a part's problems hold for as long as it's around. The feature list,
// Parts list and dialogs each ask for them on every render.
const knownProblems = new WeakMap<CadPart, CadEdgeFilletProblem[]>();

/** The Fillet steps of a part that can't round all their corners, for their rows, the Parts list and the dialog. */
export function edgeFilletProblems(part: CadPart): CadEdgeFilletProblem[] {
  if (!part.fillets?.length) return [];
  let problems = knownProblems.get(part);
  if (!problems) knownProblems.set(part, (problems = withEdgeFillets(part).problems));
  return problems;
}

/**
 * A part with its Fillet steps applied to its sketch, in order: each rounds its corners to its radius. A corner that
 * can't take it, as when it's gone or the radius would use up one of its sides, is left sharp and the step says why;
 * its other corners are still rounded. All the corners on a side the radius would use up are left sharp, so which stay
 * rounded doesn't depend on the order they were picked in.
 */
export function withEdgeFillets(part: CadPart): { part: CadPart; diagnostics: CadDiagnostic[]; problems: CadEdgeFilletProblem[] } {
  let sketch = part.sketch;
  const diagnostics: CadDiagnostic[] = [];
  const problems: CadEdgeFilletProblem[] = [];
  for (const fillet of part.fillets ?? []) {
    if (fillet.suppressed) continue;
    const exists = (id: string) => sketch.entities.some(entity => entity.id === id);
    let corners = fillet.corners.filter(exists);
    const sharp = fillet.corners.filter(id => !exists(id));
    let reason = sharp.length ? 'its corner is gone.' : undefined;
    while (corners.length) {
      const result = filletLineCorners(sketch, { cornerPointIds: corners, radius: fillet.radius });
      if (result.ok) {
        sketch = result.sketch;
        break;
      }
      reason ??= result.message;
      // The corners it names can't take the radius, and the rest are tried again without them. A refusal that names
      // none of them, such as one about the whole profile, leaves them all sharp.
      const equivalent = pointEquivalence(sketch.constraints);
      const refused = corners.filter(id => result.cornerPointIds.some(other => equivalent.equivalent(id, other)));
      const left = refused.length ? corners.filter(id => !refused.includes(id)) : [];
      sharp.push(...corners.filter(id => !left.includes(id)));
      corners = left;
    }
    if (!sharp.length) continue;
    const some = sharp.length < fillet.corners.length ? ` at ${sharp.length} of its ${fillet.corners.length} corners` : '';
    const message = `A fillet on ${part.name} can’t be made${some}: ${reason}`;
    problems.push({ filletId: fillet.id, message, corners: sharp });
    const points = part.sketch.entities.flatMap(entity => (entity.type === 'point' && sharp.includes(entity.id) ? [entity] : []));
    diagnostics.push({
      code: 'fillet-unresolved',
      severity: 'warning',
      partId: part.id,
      message,
      entityIds: sharp,
      ...(points.length && { points: points.map(point => ({ x: point.x, y: point.y })) }),
    });
  }
  const next = { ...part, sketch };
  delete next.fillets;
  // Rounding a corner gives the regions around it new curves, and so new IDs: the regions picked are found again by a
  // point inside each, so the part keeps its regions.
  if (sketch !== part.sketch && (part.regions || part.addedRegions)) {
    const before = sketchRegions(part.sketch, CAD_CHORD_TOLERANCE),
      after = sketchRegions(sketch, CAD_CHORD_TOLERANCE);
    const remap = (ids: string[]) =>
      ids.flatMap(id => {
        const region = before.find(candidate => candidate.id === id);
        const inside = region && areaPoint(region);
        const found =
          inside &&
          after
            .filter(candidate => pointInPolygon(inside, candidate.points) && !candidate.holes.some(hole => pointInPolygon(inside, hole)))
            .sort((a, b) => Math.abs(polygonArea(a.points)) - Math.abs(polygonArea(b.points)))[0];
        return found ? [found.id] : [id];
      });
    if (part.regions) next.regions = remap(part.regions);
    if (part.addedRegions) next.addedRegions = remap(part.addedRegions);
  }
  return { part: next, diagnostics, problems };
}

/** A part without one of its Fillet steps. */
export function removeEdgeFillet(document: CadDocument, partId: string, filletId: string): CadDocument {
  return {
    ...document,
    revision: document.revision + 1,
    parts: document.parts.map(part => {
      if (part.id !== partId) return part;
      const fillets = part.fillets?.filter(fillet => fillet.id !== filletId);
      const next = { ...part, fillets };
      if (!fillets?.length) delete next.fillets;
      return next;
    }),
  };
}
