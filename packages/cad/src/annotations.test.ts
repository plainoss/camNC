import { describe, expect, it } from 'vitest';
import { createPlateDocument, parseCadDocument, updateDimension } from './document';
import { solveCadDocument } from './solver';
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
  it('preserves authored expressions and label placement when loading, editing and solving', async () => {
    const document = createPlateDocument();
    const sketch = document.parts[0]!.sketch;
    const width = sketch.constraints.find(c => c.type === 'distanceX')!;
    const height = sketch.constraints.find(c => c.type === 'distanceY')!;
    Object.assign(width, {
      expression: '120mm',
      labelPlacement: { kind: 'linear', fraction: 0.25, normalOffset: -15 },
    });
    const snapshot = structuredClone(document);
    const parsed = parseCadDocument(JSON.parse(JSON.stringify(document)));
    expect(parsed).toEqual(snapshot);
    expect(parsed).not.toBe(document);
    const edited = updateDimension(parsed, height.id, 100);
    const solved = await solveCadDocument(edited);
    expect(solved.sketches[0]).toMatchObject({ status: 'solved' });
    for (const next of [edited, solved.document]) {
      expect(next.parts[0]!.sketch.constraints.find(c => c.id === width.id)).toMatchObject({
        expression: '120mm',
        labelPlacement: { kind: 'linear', fraction: 0.25, normalOffset: -15 },
      });
    }
    expect(document).toEqual(snapshot);
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
