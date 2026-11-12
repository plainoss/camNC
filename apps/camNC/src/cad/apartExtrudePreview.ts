import { evaluateCadPart, newCadId, splitApartRegions, type CadDocument, type CadSolveResult } from '@wbcnc/cad';

/** Names the parts a split of regions apart makes, the same each time it's asked for a group. */
export type ApartPartIds = (groupIndex: number) => string;

/** Ids for one extrude dialog: each group's part gets one when it's first asked for, and keeps it. */
export function apartPartIds(): ApartPartIds {
  const ids = new Map<number, string>();
  return group => {
    let id = ids.get(group);
    if (!id) ids.set(group, (id = newCadId()));
    return id;
  };
}

/**
 * While a New extrude's dialog is open, regions picked apart are what OK makes: a part of each group of them. The view
 * shows those parts, under the ids OK gives them, rather than one part that can't be built.
 */
export function apartExtrudePreview(document: CadDocument, extrudingId: string | null, ids: ApartPartIds): CadDocument {
  return extrudingId ? splitApartRegions(document, extrudingId, ids) : document;
}

/**
 * The solve of a design whose open New extrude picks regions apart, without the problem that they don't touch: OK makes
 * a part of each, so nothing blocks it. A problem the split leaves, such as added regions apart from the extrude's own,
 * any other problem, and regions apart when no extrude of them is open, stay.
 */
export function withoutApartRegionProblem(result: CadSolveResult, extrudingId: string | null): CadSolveResult {
  if (!extrudingId) return result;
  const split = splitApartRegions(result.document, extrudingId);
  if (split === result.document) return result;
  const after = split.parts.find(part => part.id === extrudingId);
  if (!after || evaluateCadPart(after).diagnostics.some(d => d.code === 'region-count')) return result;
  const diagnostics = result.diagnostics.filter(d => !(d.partId === extrudingId && d.code === 'region-count'));
  if (diagnostics.length === result.diagnostics.length) return result;
  const status = result.status === 'invalid' && !diagnostics.some(d => d.severity === 'error') ? 'solved' : result.status;
  return { ...result, diagnostics, status };
}
