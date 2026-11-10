import {
  cadCornerSources,
  cadSketchFrame,
  cornerKey,
  createCadPart,
  createPlateDocument,
  setCadVariable,
  updateDimension,
  type CadDocument,
} from '@wbcnc/cad';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import { disposeCadSolver, solveCadDocument } from './solveCad';
import { prepareStudioPreview, useStudioPreview } from './useStudioPreview';

afterEach(() => {
  cleanup();
  disposeCadSolver();
});
const width = (document: CadDocument) =>
  Math.max(...document.parts[0]!.sketch.entities.filter(entity => entity.type === 'point').map(point => point.x));

it('solves a variable draft into visible sketch geometry before saving', async () => {
  const plate = createPlateDocument({ width: 100, height: 60 });
  const made = setCadVariable(plate, { name: 'width', expression: '100' });
  if ('error' in made) throw new Error(made.error);
  const dimension = plate.parts[0]!.sketch.constraints.find(constraint => constraint.label === 'Width')!;
  const source = updateDimension(made.document, dimension.id, 100, '#width');
  const changed = setCadVariable(source, { id: made.id, name: 'width', expression: '140' });
  if ('error' in changed) throw new Error(changed.error);
  const owner = {};
  const { result } = renderHook(() => useStudioPreview(source, owner));
  act(() => result.current.update(changed.document));
  await waitFor(() => expect(width(result.current.document)).toBeCloseTo(140, 7), { timeout: 20_000 });
  expect(width(source)).toBe(100);
}, 25_000);

it('previews a moved source and its used points alongside an unfinished part', async () => {
  const source = createPlateDocument({ width: 100, height: 60 });
  source.parts[0]!.drawnOn = { on: { plane: 'top' }, offset: 0 };
  source.parts[0]!.placement = { position: [0, 0, 0], rotation: [0, 0, 0, 1] };
  const side = createCadPart('Side');
  side.drawnOn = { on: { plane: 'front' }, offset: 0 };
  source.parts.push(side);
  const used = cadCornerSources(source, cadSketchFrame(source, side)!, side.id).get(cornerKey(100, 18));
  expect(used).toBeDefined();
  side.sketch.entities.push({ id: 'used-source', type: 'point', x: 100, y: 18, fixed: true, used });
  const owner = {};
  const { result } = renderHook(() => useStudioPreview(source, owner));
  const moved = {
    ...source,
    parts: source.parts.map((part, index) => (index ? part : { ...part, moved: { by: [40, 0, 0] as [number, number, number] } })),
  };
  expect(moved.parts[1]!.sketch).toBe(source.parts[1]!.sketch);
  const prepared = prepareStudioPreview(moved);
  expect(prepared.parts[0]!.placement!.position).toEqual([40, 0, 0]);
  const accepted = await solveCadDocument(prepared);
  expect(accepted.document.parts[1]!.sketch.entities.find(entity => entity.id === 'used-source')).toMatchObject({ x: 140, y: 18 });
  expect(accepted.diagnostics).toContainEqual(expect.objectContaining({ code: 'empty-sketch', partId: side.id }));
  act(() => result.current.update(moved));
  await waitFor(
    () =>
      expect(result.current.document.parts[1]!.sketch.entities.find(entity => entity.id === 'used-source')).toMatchObject({
        x: 140,
        y: 18,
      }),
    { timeout: 20_000 }
  );
  expect(source.parts[1]!.sketch.entities.find(entity => entity.id === 'used-source')).toMatchObject({ x: 100, y: 18 });
}, 25_000);
