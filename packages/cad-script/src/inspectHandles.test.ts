import { expect, it, vi } from 'vitest';
import { createCadDocument, createCadPart, type CadDocument, type CadSolveResult } from '@wbcnc/cad';
import { inspectCadDocument } from './inspect';

// Kernel solving is unrelated to this regression: exercise the real report builder on an already-solved point set.
vi.mock('@wbcnc/cad', async importOriginal => {
  const actual = await importOriginal<typeof import('@wbcnc/cad')>();
  return {
    ...actual,
    solveCadDocument: async (document: CadDocument): Promise<CadSolveResult> => ({
      document,
      status: 'solved',
      parts: [],
      sketches: [],
      diagnostics: [],
    }),
  };
});

function fittedPointSet(count: number) {
  const document = createCadDocument(),
    part = createCadPart('Fitted reference points');
  for (let i = 0; i < count; i++) {
    const id = `rptE${String(i).padStart(4, '0')}-entity`;
    part.sketch.entities.push({ id, type: 'point', x: i, y: i % 11, standalone: true });
    for (const [axis, type] of ['positionX', 'positionY'].entries())
      part.sketch.constraints.push({
        id: `rptC${String(2 * i + axis).padStart(4, '0')}-constraint`,
        type: type as 'positionX' | 'positionY',
        pointId: id,
        value: axis === 0 ? i : i % 11,
        expression: `${axis === 0 ? i : i % 11}mm`,
        label: `Fit ${type}`,
      });
  }
  document.parts.push(part);
  return document;
}

async function reportCost(count: number) {
  const original = String.prototype.startsWith;
  let comparisons = 0;
  String.prototype.startsWith = function (this: string, search, position) {
    if (original.call(this, 'rptE') || original.call(this, 'rptC')) comparisons++;
    return original.call(this, search, position);
  };
  try {
    return { result: await inspectCadDocument(fittedPointSet(count), new Map(), { toolpaths: false }), comparisons };
  } finally {
    String.prototype.startsWith = original;
  }
}

it('keeps fitted report handle work quadratic as a sketch doubles, with identical shortest identities', async () => {
  const small = await reportCost(32),
    large = await reportCost(64);
  // Count real prefix comparisons instead of timing the machine or mocking the report implementation.
  // Rebuilding every handle map for every reported dimension grows cubically and exceeds this scaling bound.
  expect(small.comparisons).toBeGreaterThan(0);
  expect(large.comparisons).toBeLessThanOrEqual(6 * small.comparisons);
  const sketch = large.result.report.parts[0]!.sketches[0]!;
  expect(sketch.entities).toHaveLength(64);
  expect(sketch.entities[0]).toEqual({ ref: 'rptE0000', type: 'point' });
  expect(sketch.entities[63]).toEqual({ ref: 'rptE0063', type: 'point' });
  expect(sketch.fitting?.drivers).toHaveLength(128);
  expect(sketch.fitting?.drivers[0]).toEqual({ ref: 'rptC0000', type: 'positionX', entities: ['rptE0000'], value: 0, expression: '0mm' });
  expect(sketch.fitting?.drivers[127]).toEqual({ ref: 'rptC0127', type: 'positionY', entities: ['rptE0063'], value: 8, expression: '8mm' });
});
