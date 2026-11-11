import { expect, it } from 'vitest';
import {
  addPartCopy,
  addPartCut,
  addRectangle,
  cadStepReport,
  createCadPart,
  createPlateDocument,
  evaluateCadDocument,
  resolveDrawnPlacements,
} from './index';

it('reports no inherited Add-body opening for a suppressed host copy', () => {
  const initial = createPlateDocument({ width: 100, height: 60, thickness: 18 });
  const parent = initial.parts[0]!;
  parent.name = 'Parent';
  parent.placement = { position: [0, 0, 0], rotation: [0, 0, 0, 1] };
  const copied = addPartCopy(initial, parent.id, { offset: { position: [200, 0, 0], rotation: [0, 0, 0, 1] } });
  copied.document.parts[0]!.copies![0]!.suppressed = true;
  const boss = createCadPart('Boss', 6);
  boss.sketch = addRectangle(boss.sketch, { x: 15, y: 10, width: 20, height: 12, dimensioned: true, positioned: true });
  boss.addTo = parent.id;
  boss.drawnOn = { on: { partId: parent.id, face: 'top' }, offset: 0 };
  const tool = createPlateDocument({ width: 5, height: 4, thickness: 6 }).parts[0]!;
  tool.name = 'Tool';
  tool.placement = { position: [25, 16, 18], rotation: [0, 0, 0, 1] };
  const document = resolveDrawnPlacements({ ...copied.document, parts: [...copied.document.parts, boss, tool] }).document;
  const source = addPartCut(document, [tool.id], [parent.id], { value: 0 }).document;
  const report = cadStepReport(source, evaluateCadDocument(source).parts).find(step => step.kind === 'partCut')!;
  if (report.kind !== 'partCut') throw new Error('Expected a Cut parts step');
  expect(new Set(report.cuts.map(cut => cut.target))).toEqual(new Set(['Boss']));
});
