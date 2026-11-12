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

it('counts a moved or flipped cut and a reshaped outline in the same box as changes', () => {
  const cut = { ref: 'c', side: 'top', from: 12, to: 18, through: false, at: [50, 0], size: [18, 200] };
  const sketch = (x: number) => [{ ref: 's', on: 'profile', entities: [{ ref: 'e1', kind: 'line', from: [0, 0], to: [x, 0] }] }];
  const side = (cuts: unknown[], sketches = sketch(300)) => ({
    ...part('Side', 18),
    outline: { at: [0, 0], size: [300, 200] },
    cuts,
    sketches,
  });
  const before = { parts: [side([cut])], assembly: { parts: [body('Side', [0, 0, 0])] } };
  const changed = (after: unknown) =>
    (compactCheckReport({ ok: true, parts: [after], assembly: before.assembly }, before).changedParts as unknown[]).length;
  expect(changed(side([cut]))).toBe(0);
  // Handles alone are renumbered, not changed.
  expect(changed(side([{ ...cut, ref: 'c2' }], [{ ...sketch(300)[0]!, ref: 's2' }]))).toBe(0);
  expect(changed(side([{ ...cut, at: [120, 0] }]))).toBe(1);
  expect(changed(side([{ ...cut, side: 'underside', from: 0, to: 6 }]))).toBe(1);
  expect(changed(side([cut], sketch(250)))).toBe(1);
  const shown = (
    compactCheckReport({ ok: true, parts: [side([{ ...cut, side: 'underside', from: 0, to: 6 }])], assembly: before.assembly }, before)
      .changedParts as { cuts: unknown[] }[]
  )[0]!.cuts[0];
  expect(shown).toMatchObject({ side: 'underside', from: 0, to: 6, at: [50, 0] });
});
