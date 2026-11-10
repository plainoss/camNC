import { describe, expect, it } from 'vitest';
import { createPlateDocument, parseCadDocument } from './document';
import { resolveDimensionPlacement, withDimensionPlacement } from './dimensionPlacement';

describe('sketch annotation placement', () => {
  it('round-trips a user-placed label without changing its driving dimension', () => {
    const document = createPlateDocument();
    const sketch = document.parts[0]!.sketch;
    sketch.constraints = sketch.constraints.map(c => (c.type === 'distanceX' ? withDimensionPlacement(sketch, c, { x: 60, y: -15 }) : c));
    const dimension = sketch.constraints.find(c => c.type === 'distanceX')!;
    const parsed = parseCadDocument(JSON.parse(JSON.stringify(document)));
    const placed = parsed.parts[0]!.sketch.constraints.find(c => c.id === dimension.id)!;
    if (!('value' in placed)) throw new Error('Expected numeric annotation');
    expect(resolveDimensionPlacement(parsed.parts[0]!.sketch, placed)).toEqual({ x: 60, y: -15 });
    expect(parseCadDocument(JSON.parse(JSON.stringify(parsed)))).toEqual(parsed);
    expect(dimension).toMatchObject({ value: 120 });
  });
  it('rejects a nonfinite annotation coordinate in portable source', () => {
    const document = createPlateDocument();
    const sketch = document.parts[0]!.sketch;
    sketch.constraints = sketch.constraints.map(c =>
      c.type === 'distanceX' ? { ...c, labelPlacement: { kind: 'absolute', position: { x: Infinity, y: 0 } } } : c
    );
    expect(() => parseCadDocument(document)).toThrow('CAD numeric fields must be finite numbers');
  });
});
