import {
  addRectangle,
  createCadDocument,
  createCadPart,
  evaluateCadDocument,
  solidSketchRegionIds,
  type CadDocument,
  type CadPart,
  type CadSolveResult,
} from '@wbcnc/cad';
import { expect, it } from 'vitest';
import { apartExtrudePreview, apartPartIds, withoutApartRegionProblem } from './apartExtrudePreview';

/** Three rectangles apart, the extrude picking the first two and adding `added` of them. */
function design(change: (part: CadPart, regions: string[]) => CadPart = (part, regions) => ({ ...part, regions: regions.slice(0, 2) })) {
  const part = createCadPart('Part 1', 18);
  for (const x of [0, 100, 200]) part.sketch = addRectangle(part.sketch, { x, y: 0, width: 60, height: 40 });
  const document: CadDocument = { ...createCadDocument(), parts: [change(part, solidSketchRegionIds(part.sketch))] };
  return { document, id: part.id };
}

function solved(document: CadDocument): CadSolveResult {
  const { diagnostics } = evaluateCadDocument(document);
  const invalid = diagnostics.some(d => d.severity === 'error');
  return { document, status: invalid ? 'invalid' : 'solved', diagnostics, parts: [], sketches: [] };
}

it('previews regions apart as the parts OK makes, under the same ids every time', () => {
  const { document, id } = design();
  const ids = apartPartIds();
  const shown = apartExtrudePreview(document, id, ids);
  expect(shown.parts).toHaveLength(2);
  expect(apartExtrudePreview({ ...document, revision: document.revision + 1 }, id, ids).parts.map(p => p.id)).toEqual(
    shown.parts.map(p => p.id)
  );
  expect(shown.parts[1]!.id).toBe(ids(1));
  // Another dialog, other ids; and with no extrude open, the design as it is.
  expect(apartExtrudePreview(document, id, apartPartIds()).parts[1]!.id).not.toBe(shown.parts[1]!.id);
  expect(apartExtrudePreview(document, null, ids)).toBe(document);
});

it('drops only the open New extrude’s problem that its regions don’t touch', () => {
  const { document, id } = design();
  const result = solved(document);
  expect(result.diagnostics.map(d => d.code)).toEqual(['region-count']);
  const shown = withoutApartRegionProblem(result, id);
  expect(shown.diagnostics).toEqual([]);
  expect(shown.status).toBe('solved');
  // With no extrude of it open, regions apart are a problem.
  expect(withoutApartRegionProblem(result, null)).toBe(result);
  expect(withoutApartRegionProblem(result, 'another')).toBe(result);
});

it('keeps the problem of an Add of regions apart, and of added regions apart from the extrude’s own', () => {
  const add = design((part, regions) => ({ ...part, regions: regions.slice(0, 2), addTo: 'board' }));
  const added = solved(add.document);
  expect(withoutApartRegionProblem(added, add.id)).toBe(added);
  const apart = design((part, regions) => ({ ...part, regions: regions.slice(0, 2), addedRegions: [regions[2]!] }));
  const result = solved(apart.document);
  expect(result.diagnostics.some(d => d.code === 'region-count')).toBe(true);
  expect(withoutApartRegionProblem(result, apart.id)).toBe(result);
});
