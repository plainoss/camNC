import { evaluateCadPart, type CadDocument, type CadSolveResult } from '@wbcnc/cad';

/**
 * An open extrude's step with no region picked yet that builds nothing: not a thin board, nor one regions are added to,
 * nor one that makes other parts too.
 */
function unpicked(document: CadDocument, extrudingId: string | null) {
  const part = extrudingId ? document.parts.find(p => p.id === extrudingId) : undefined;
  if (!part || part.regions?.length !== 0 || part.remove || part.faceProfile) return undefined;
  if (document.parts.some(p => p.extrudedWith === part.id) || evaluateCadPart(part).part) return undefined;
  return part;
}

/**
 * While an extrude's dialog is open with nothing picked, the view shows no part of it, as the Parts list lists none:
 * a sketch's own first extrude shows the sketch as it was before, to pick from, and another extrude of it shows nothing.
 */
export function unpickedExtrudePreview(document: CadDocument, extrudingId: string | null): CadDocument {
  const part = unpicked(document, extrudingId);
  if (!part) return document;
  return {
    ...document,
    parts: part.sketchOf
      ? document.parts.filter(p => p.id !== part.id)
      : document.parts.map(p => (p.id === part.id ? { ...p, extrude: false as const } : p)),
  };
}

/** The solve without the problem that nothing is picked yet: the dialog says so, and keeps OK off, until a pick. */
export function withoutUnpickedProblem(result: CadSolveResult, extrudingId: string | null): CadSolveResult {
  if (!unpicked(result.document, extrudingId)) return result;
  const diagnostics = result.diagnostics.filter(d => !(d.partId === extrudingId && d.code === 'region-count'));
  if (diagnostics.length === result.diagnostics.length) return result;
  const status = result.status === 'invalid' && !diagnostics.some(d => d.severity === 'error') ? 'solved' : result.status;
  return { ...result, diagnostics, status };
}
