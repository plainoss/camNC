import { createPlateDocument, evaluateCadPart, type CadDocument, type CadPointEntity } from '@wbcnc/cad';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { FilletDialog } from './FilletDialog';
import type { CadConnectorPick } from './PartFeatureDialogs';

afterEach(cleanup);
function setup(editing = false) {
  const document = createPlateDocument({ width: 100, height: 60 });
  const part = document.parts[0]!;
  const corner = (x: number) =>
    part.sketch.entities.find(
      (entity): entity is CadPointEntity => entity.type === 'point' && !entity.construction && entity.x === x && entity.y === 0
    )!;
  const corners = [corner(0), corner(100)];
  if (editing) part.fillets = [{ id: 'round', corners: corners.map(point => point.id), radius: 5 }];
  const preview = vi.fn<(document: CadDocument | null) => void>(),
    save = vi.fn();
  let picked: ((pick: CadConnectorPick) => void) | null = null;
  render(
    <FilletDialog
      document={document}
      partId={editing ? part.id : undefined}
      filletId={editing ? 'round' : undefined}
      pickEdge={callback => {
        picked = callback;
      }}
      onPreview={preview}
      onSave={save}
      onCancel={() => {}}
    />
  );
  const pick = (index: number) => {
    const point = corners[index]!;
    act(() =>
      picked?.({
        partId: part.id,
        point: [point.x, point.y, 0],
        normal: [1, 0, 0],
        edge: { a: [point.x, point.y, 0], b: [point.x, point.y, 18] },
      })
    );
  };
  const latest = () => preview.mock.calls.at(-1)?.[0];
  const hasSharpCorner = (next: CadDocument, x: number) =>
    evaluateCadPart(next.parts[0]!).part!.outline.some(point => Math.hypot(point.x - x, point.y) < 1e-6);
  const remove = (x: number) => fireEvent.click(screen.getByRole('button', { name: `Remove selected edge: Plate at ${x}, 0 mm` }));
  return { document, part, corners, preview, save, pick, latest, hasSharpCorner, remove };
}

it('removes rounded edges from the dialog after live preview has replaced their original corners', () => {
  const view = setup();
  view.pick(0);
  expect(view.hasSharpCorner(view.latest()!, 0)).toBe(false);
  expect(screen.getByRole('button', { name: 'Remove selected edge: Plate at 0, 0 mm' })).toBeDefined();
  view.pick(1);
  expect(view.latest()?.parts[0]?.fillets?.[0]?.corners).toHaveLength(2);
  view.remove(0);
  expect(view.latest()?.parts[0]?.fillets?.[0]?.corners).toEqual([view.corners[1]!.id]);
  expect(view.hasSharpCorner(view.latest()!, 0)).toBe(true);
  expect(view.hasSharpCorner(view.latest()!, 100)).toBe(false);
  view.remove(100);
  expect(view.latest()).toBeNull();
  expect(screen.getByRole('button', { name: 'OK' })).toBeDisabled();
  expect(screen.queryByRole('list', { name: 'Selected edges' })).toBeNull();
  expect(view.part.fillets).toBeUndefined();
  expect(view.save).not.toHaveBeenCalled();
});

it('clears an existing fillet for reselecting sharp edges and saves the remaining selection with its original identity', async () => {
  const view = setup(true);
  view.remove(0);
  expect(view.latest()?.parts[0]?.fillets?.[0]).toMatchObject({ id: 'round', corners: [view.corners[1]!.id] });
  view.remove(100);
  expect(view.latest()?.parts[0]?.fillets).toEqual([]);
  expect(view.hasSharpCorner(view.latest()!, 0)).toBe(true);
  expect(view.hasSharpCorner(view.latest()!, 100)).toBe(true);
  expect(screen.getByRole('button', { name: 'OK' })).toBeDisabled();
  view.pick(0);
  const candidate = view.latest();
  expect(candidate?.parts[0]?.fillets?.[0]).toMatchObject({ id: 'round', corners: [view.corners[0]!.id] });
  expect(view.part.fillets?.[0]?.corners).toHaveLength(2);
  fireEvent.click(screen.getByRole('button', { name: 'OK' }));
  await waitFor(() => expect(view.save).toHaveBeenCalledWith(candidate));
});
