import { cleanup, render, waitFor } from '@testing-library/react';
import { createCadPart, addRectangle, evaluateCadDocument, type CadDocument } from '@wbcnc/cad';
import { afterEach, expect, it, vi } from 'vitest';
import { orderedCopyFixture } from '@/test/orderedCopyFixture';
import { PartCutDialog } from './PartCutDialog';
import { partSolid } from './partSolid';

afterEach(cleanup);

const height = (solid: ReturnType<typeof partSolid>) => {
  solid.geometry!.computeBoundingBox();
  const box = solid.geometry!.boundingBox!;
  return box.max.z - box.min.z;
};

it('shows a dragged draft of an ordered part rather than its saved material', () => {
  const { document, partId } = orderedCopyFixture();
  const saved = document.parts.find(part => part.id === partId)!;
  expect(height(partSolid(saved, document))).toBeCloseTo(18, 6);
  const draft = partSolid({ ...saved, thickness: 12 }, document);
  expect(draft.problem).toBeUndefined();
  expect(height(draft)).toBeCloseTo(12, 6);
});

it('shows an ordered document’s part that is not saved yet', () => {
  const { document } = orderedCopyFixture();
  const part = createCadPart('New', 9);
  part.sketch = addRectangle(part.sketch, { x: 0, y: 0, width: 20, height: 20, dimensioned: true, positioned: true });
  const solid = partSolid(part, document);
  expect(solid.problem).toBeUndefined();
  expect(height(solid)).toBeCloseTo(9, 6);
});

it('previews a new Cut parts step of an ordered document as a valid ordered operation', async () => {
  const { document, partId } = orderedCopyFixture();
  const knife = document.parts.find(part => part.name === 'Knife A')!;
  const onPreview = vi.fn();
  const dialog = (pick: { partId: string; seq: number } | null) => (
    <PartCutDialog document={document} tool={knife.id} pick={pick} onPreview={onPreview} onSave={() => {}} onClose={() => {}} />
  );
  const view = render(dialog(null));
  view.rerender(dialog({ partId, seq: 1 }));
  await waitFor(() => expect(onPreview).toHaveBeenLastCalledWith(expect.objectContaining({ partCuts: expect.any(Array) })));
  const candidate = onPreview.mock.lastCall![0] as CadDocument;
  const added = candidate.partCuts!.at(-1)!;
  expect(candidate.operationOrder).toEqual([...document.operationOrder!, added.id]);
  const evaluated = evaluateCadDocument(candidate);
  expect(evaluated.diagnostics.filter(diagnostic => diagnostic.code === 'invalid-copy-operations')).toEqual([]);
  expect(evaluated.parts.length).toBeGreaterThan(0);
});
