import { edgeFilletProblems } from './edgeFillets';
import { evaluateCadDocument } from './features';
import type { CadDocument, CadEvaluation, CadPart } from './types';

// The design is built once for whatever asks about its fillets: the feature list's rows and the Fillet dialog. Like the
// part cache in edgeFillets, it assumes a changed design is a new object.
const built = new WeakMap<CadDocument, CadEvaluation>();

/**
 * A part's Fillet steps that can't round all they're asked to, each with why: corners through its thickness, and edges
 * along its faces. The latter depend on what its cuts leave, so the design is built to find them.
 */
export function filletProblems(document: CadDocument, part: CadPart): { filletId: string; message: string }[] {
  const corners = edgeFilletProblems(part);
  if (!part.fillets?.some(fillet => fillet.rims?.length && !fillet.suppressed)) return corners;
  let evaluation = built.get(document);
  if (!evaluation) built.set(document, (evaluation = evaluateCadDocument(document)));
  const rims = evaluation.diagnostics.flatMap(d =>
    d.code === 'fillet-round-unresolved' && d.partId === part.id && d.entityIds?.[0]
      ? [{ filletId: d.entityIds[0], message: d.message }]
      : []
  );
  return [...corners, ...rims];
}
