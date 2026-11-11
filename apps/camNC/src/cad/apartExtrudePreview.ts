import { splitApartRegions, type CadDocument, type CadSolveResult } from '@wbcnc/cad';

/**
 * While a New extrude's dialog is open, regions picked apart are what OK makes: a part of each group of them. The view
 * shows those parts, rather than one part that can't be built.
 */
export function apartExtrudePreview(document: CadDocument, extrudingId: string | null): CadDocument {
  return extrudingId ? splitApartRegions(document, extrudingId) : document;
}

/**
 * The solve of a design whose open New extrude picks regions apart, without the problem that they don't touch: OK makes
 * a part of each, so nothing blocks it. Any other problem, and regions apart when no extrude of them is open, stay.
 */
export function withoutApartRegionProblem(result: CadSolveResult, extrudingId: string | null): CadSolveResult {
  if (!extrudingId || splitApartRegions(result.document, extrudingId) === result.document) return result;
  const diagnostics = result.diagnostics.filter(d => !(d.partId === extrudingId && d.code === 'region-count'));
  if (diagnostics.length === result.diagnostics.length) return result;
  const status = result.status === 'invalid' && !diagnostics.some(d => d.severity === 'error') ? 'solved' : result.status;
  return { ...result, diagnostics, status };
}
