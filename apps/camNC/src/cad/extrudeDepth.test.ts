import { createPlateDocument, resolveDrawnPlacements } from '@wbcnc/cad';
import { expect, it } from 'vitest';
import { distanceAlongAxis, extrudeDepthView, withExtrudeDepth } from './extrudeDepth';

it('keeps the arrow on the selected profile, follows flips and symmetric total depth, and respects driven depth', () => {
  const source = createPlateDocument({ width: 60, height: 80, thickness: 25 });
  const part = source.parts[0]!;
  part.drawnOn = { on: { plane: 'front' }, offset: 5 };
  const view = extrudeDepthView(source, part.id)!;
  expect(view).toMatchObject({ origin: [30, -5, 40], direction: [0, -1, 0], depth: 25, factor: 1, editable: true });
  const flipped = { ...source, parts: [{ ...part, drawnOn: { ...part.drawnOn, inward: true } }] };
  expect(extrudeDepthView(flipped, part.id)?.direction).toEqual([0, 1, 0]);
  expect(extrudeDepthView({ ...source, parts: [{ ...part, symmetric: true }] }, part.id)?.factor).toBe(2);
  expect(extrudeDepthView({ ...source, parts: [{ ...part, upTo: { plane: 'front' } }] }, part.id)?.editable).toBe(false);
  const expression = { ...source, parts: [{ ...part, thicknessExpression: '#depth' }] };
  const next = withExtrudeDepth(expression, part.id, 65.7);
  expect(next.parts[0]!.thickness).toBe(65.7);
  expect(next.parts[0]!.thicknessExpression).toBeUndefined();
  expect(expression.parts[0]!.thicknessExpression).toBe('#depth');
  expect(resolveDrawnPlacements(next).document.parts[0]!.placement?.position[1]).toBe(-5);
});

it('measures oblique and reversed axes and refuses unstable head-on ray division', () => {
  expect(distanceAlongAxis([0, -20, 10], [0, 1, 0], [0, 0, 0], [0, 0, 1])).toBe(10);
  expect(distanceAlongAxis([0, -20, 10], [0, 1, 0], [0, 0, 0], [0, 0, -1])).toBe(-10);
  expect(distanceAlongAxis([0, 0, 20], [0, 0, -1], [0, 0, 0], [0, 0, 1])).toBeNull();
});

it('allows dragging depth beyond 300 mm while retaining the minimum and rounding', () => {
  const source = createPlateDocument({ width: 60, height: 80, thickness: 25 });
  const partId = source.parts[0]!.id;
  expect(withExtrudeDepth(source, partId, 2000.34).parts[0]!.thickness).toBe(2000.3);
  expect(withExtrudeDepth(source, partId, -10).parts[0]!.thickness).toBe(0.1);
});
