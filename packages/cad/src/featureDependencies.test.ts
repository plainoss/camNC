import { expect, it } from 'vitest';
import {
  addCircle,
  createCadDocument,
  createCadPart,
  designSteps,
  featureDependencies,
  resolveExtrudeSteps,
  sketchRegions,
  type CadPart,
} from './index';

/** A cup: Sketch 1 extruded #material thick, Sketch 2 on its top cut #depth into it, and #spare used by nothing. */
function cup() {
  const body: CadPart = {
    ...createCadPart('Part 1', 20),
    id: 'cup',
    thicknessExpression: '#material',
    drawnOn: { on: { plane: 'top' }, offset: 0 },
  };
  body.sketch = addCircle(body.sketch, { x: 0, y: 0, radius: 38.9 });
  const pocket: CadPart = {
    ...createCadPart('Part 2', 20),
    id: 'pocket',
    drawnOn: { on: { partId: 'cup', face: 'top' }, offset: 0 },
    remove: { depth: 16, depthExpression: '#depth' },
  };
  pocket.sketch = addCircle(pocket.sketch, { x: 0, y: 0, radius: 33.6 });
  return resolveExtrudeSteps({
    ...createCadDocument(),
    variables: [
      { id: 'material', name: 'material', expression: '20 mm' },
      { id: 'depth', name: 'depth', expression: '#material - 4 mm' },
      { id: 'spare', name: 'spare', expression: '4' },
    ],
    parts: [{ ...body, regions: sketchRegions(body.sketch).map(region => region.id) }, pocket],
  });
}

it('lists what a feature builds on and what builds on it, directly, and leaves out what has nothing to do with it', () => {
  const document = cup();
  const label = (key: string) => designSteps(document).find(step => step.id === key)?.label ?? `#${key}`;
  const of = (key: string) => {
    const { parents, children } = featureDependencies(document, key);
    return { parents: parents.map(label), children: children.map(label) };
  };
  // The cut into the cup is a child of the cup's extrude, though the cup's part records it.
  expect(of('cup:extrude')).toEqual({ parents: ['#material', 'Sketch 1'], children: ['Sketch 2', 'Extrude 2'] });
  expect(of('pocket:sketch')).toEqual({ parents: ['Extrude 1'], children: ['Extrude 2'] });
  expect(of('pocket:extrude')).toEqual({ parents: ['#depth', 'Extrude 1', 'Sketch 2'], children: [] });
  // A variable named in another's expression is its parent.
  expect(of('depth')).toEqual({ parents: ['#material'], children: ['Extrude 2'] });
  expect(of('spare')).toEqual({ parents: [], children: [] });
});
