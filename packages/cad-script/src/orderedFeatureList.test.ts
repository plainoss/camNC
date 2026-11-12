import { expect, it } from 'vitest';
import { designSteps } from '@wbcnc/cad';
import { inspectCadDocument, shortHandles } from './inspect';
import { compactCadReport } from './compactReport';
import { spatialReportFixture } from './spatialReport.testFixtures';
import { reportPrefix } from './reportGeometry';

it('names an ordered Cut parts step and why it is broken in the spatial history, with editor-length handles', async () => {
  const f = spatialReportFixture();
  const source = {
    ...f.source,
    variables: [{ id: 'fit', name: 'fit', expression: '-1mm' }],
    partCuts: f.source.partCuts!.map(step => (step.id === f.second ? { ...step, clearanceExpression: 'fit' } : step)),
  };
  const inspected = await inspectCadDocument(source);
  const operation = inspected.report.spatial!.operations.find(entry => entry.id === f.second)!;
  expect(operation.kind).toBe('partCut');
  if (operation.kind !== 'partCut') return;
  expect(operation.label).toMatch(/^Cut /);
  expect(operation.broken).toMatch(/^Clearance fit = -1 mm/);
  const compact = compactCadReport(inspected.document, inspected.report);
  expect(compact.spatial!.operations.find(entry => entry.id === f.second)).toMatchObject({ broken: operation.broken });
  // The editor resolves a handle against every listed step, ordered Cut parts steps included.
  const editor = shortHandles(designSteps(inspected.document).map(step => step.id));
  const listed = designSteps(reportPrefix(inspected.document));
  expect(compact.featureList.map(step => step.ref)).toEqual(listed.map(step => editor.get(step.id)));
});
