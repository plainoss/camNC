import { expect, it } from 'vitest';
import { compactCheckReport } from './compactCheck';

const part = (name: string, thickness: number) => ({ name, ref: `${name}-ref`, thickness, outline: { size: [300, 200] } });
const body = (name: string, at: number[]) => ({ name, at, size: [300, 200, 18] });

it('keeps the verdict and diagnostics but only the parts the script added, changed or removed', () => {
  const before = {
    parts: [part('Side', 18), part('Top', 18), part('Back', 6)],
    assembly: { parts: [body('Side', [0, 0, 0]), body('Top', [0, 0, 300]), body('Back', [0, 200, 0])] },
  };
  const after = {
    ok: false,
    errors: [{ code: 'parts-collide', message: 'Side and Shelf overlap.' }],
    warnings: [],
    parts: [part('Side', 18), part('Top', 24), part('Shelf', 18)],
    assembly: { parts: [body('Side', [0, 0, 0]), body('Top', [0, 0, 300]), body('Shelf', [0, 0, 150])] },
  };
  const compact = compactCheckReport(after, before);
  expect(compact).toMatchObject({
    ok: false,
    errors: after.errors,
    overallSize: [300, 200, 318],
    unchangedParts: 1,
    removedParts: ['Back'],
  });
  expect((compact.changedParts as { name: string }[]).map(changed => changed.name)).toEqual(['Top', 'Shelf']);
  expect(compact.detail).toContain('read_design_report');
});
