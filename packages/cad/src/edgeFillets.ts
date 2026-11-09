import { filletLineCorners } from './fillet';
import type { CadDiagnostic, CadDocument, CadPart } from './types';

/**
 * A part with its Fillet steps applied to its sketch, in order: each rounds its corners to its radius. One that can't,
 * as when its corner is gone or the radius is too big for the sides, is left out and says why.
 */
export function withEdgeFillets(part: CadPart): { part: CadPart; diagnostics: CadDiagnostic[] } {
  let sketch = part.sketch;
  const diagnostics: CadDiagnostic[] = [];
  for (const fillet of part.fillets ?? []) {
    if (fillet.suppressed) continue;
    const corners = fillet.corners.filter(id => sketch.entities.some(entity => entity.id === id));
    const result = corners.length ? filletLineCorners(sketch, { cornerPointIds: corners, radius: fillet.radius }) : null;
    if (result?.ok) sketch = result.sketch;
    else
      diagnostics.push({
        code: 'fillet-unresolved',
        severity: 'warning',
        partId: part.id,
        message: `A fillet on ${part.name} can’t be made: ${result?.message ?? 'its corner is gone.'}`,
      });
  }
  const next = { ...part, sketch };
  delete next.fillets;
  return { part: next, diagnostics };
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
