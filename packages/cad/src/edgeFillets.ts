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

type EdgeFilletsMade = { part: CadPart; diagnostics: CadDiagnostic[]; problems: CadEdgeFilletProblem[] };

// Each part is made once, however many ask: the evaluation, the feature list, the Parts list and the Fillet dialog. The
// cache assumes a changed part is a new object, as the editor replaces parts rather than mutating them in place.
const made = new WeakMap<CadPart, EdgeFilletsMade>();

/** The Fillet steps of a part that can't round all their corners, for their rows, the Parts list and the dialog. */
export function edgeFilletProblems(part: CadPart): CadEdgeFilletProblem[] {
  return part.fillets?.length ? withEdgeFillets(part).problems : [];
}

/**
 * A part with its Fillet steps applied to its sketch, in order: each rounds its corners to its radius. A corner that
 * can't take it, as when it's gone or the radius would use up one of its sides, is left sharp and the step says why;
 * its other corners are still rounded. All the corners on a side the radius would use up are left sharp, so which stay
 * rounded doesn't depend on the order they were picked in.
 */
export function withEdgeFillets(part: CadPart): EdgeFilletsMade {
  const known = made.get(part);
  if (known) return known;
  let sketch = part.sketch;
  const diagnostics: CadDiagnostic[] = [];
  const problems: CadEdgeFilletProblem[] = [];
  for (const fillet of part.fillets ?? []) {
    if (fillet.suppressed) continue;
    const exists = (id: string) => sketch.entities.some(entity => entity.id === id);
    let corners = fillet.corners.filter(exists);
    const sharp = fillet.corners.filter(id => !exists(id));
    // Every distinct reason a corner was refused, the radius being too big first, as that's the one to change.
    const reasons: { text: string; limit: boolean }[] = [];
    if (sharp.length)
      reasons.push({
        text:
          sharp.length === fillet.corners.length
            ? `its ${sharp.length === 1 ? 'corner is' : 'corners are'} gone.`
            : `${sharp.length === 1 ? 'a corner is' : `${sharp.length} corners are`} gone.`,
        limit: false,
      });
    while (corners.length) {
      const result = filletLineCorners(sketch, { cornerPointIds: corners, radius: fillet.radius });
      if (result.ok) {
        sketch = result.sketch;
        break;
      }
      if (!reasons.some(reason => reason.text === result.message))
        reasons.push({ text: result.message, limit: result.maximumRadius !== undefined });
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
    const why = [...reasons.filter(reason => reason.limit), ...reasons.filter(reason => !reason.limit)]
      .map(({ text }, i) => (i ? text[0]!.toUpperCase() + text.slice(1) : text))
      .join(' ');
    const message = `A fillet on ${part.name} can’t be made${some}: ${why}`;
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
  const result = { part: next, diagnostics, problems };
  made.set(part, result);
  return result;
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
