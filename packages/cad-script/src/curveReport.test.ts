import { expect, it } from 'vitest';
import { addBezier, addCircle, addConstraint, createCadPart } from '@wbcnc/cad';
import { sketchCurveDetails } from './curveReport';

it('reports fitted curve bounds separately from unrelated sketch geometry', () => {
  let sketch = addBezier(createCadPart().sketch, {
    points: [
      { x: 0, y: 0 },
      { x: 0, y: 100 },
      { x: 100, y: 100 },
      { x: 100, y: 0 },
    ],
  });
  const curve = sketch.entities.find(e => e.type === 'bezier')!;
  sketch = addConstraint(sketch, {
    type: 'positionY',
    pointId: curve.controlPointIds[1]!,
    value: 100,
    label: 'Fit positionY',
    expression: 'targetH*4/3',
  });
  sketch = addCircle(sketch, { x: 1000, y: 1000, radius: 50 });
  const details = sketchCurveDetails(
    sketch,
    id => id,
    id => id
  );
  expect(details.fitting?.bounds).toEqual({ at: [0, 0], size: [100, 75] });
  expect(details.fitting?.drivers[0]).toMatchObject({ expression: 'targetH*4/3', entities: [curve.controlPointIds[1]] });
});
