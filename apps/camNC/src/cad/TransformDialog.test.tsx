import { DesignUnitContext } from './designUnits';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { createPlateDocument, parseCadValue, type CadDocument, type CadDrawnOn } from '@wbcnc/cad';
import { afterEach, expect, it, vi } from 'vitest';
import { TransformDialog, type CadConnectorPick } from './PartFeatureDialogs';

afterEach(cleanup);

function setup(pattern = false, count = 2) {
  const document = createPlateDocument({ width: 200, height: 100 });
  const part = document.parts[0]!;
  part.drawnOn = { on: { plane: 'top' }, offset: 0 };
  if (pattern) {
    part.pattern = { id: 'pattern', axis: 'z', count, spacing: 300 };
    part.copies = Array.from({ length: count - 1 }, (_, i) => ({
      id: `pattern:${i + 1}`,
      pattern: 'pattern',
      placement: {
        position: [0, 0, 300 * (i + 1)] as [number, number, number],
        rotation: [0, 0, 0, 1] as [number, number, number, number],
      },
    }));
  }
  const preview = vi.fn<(document: CadDocument | null) => void>();
  const save = vi.fn();
  const connectors = vi.fn();
  let pick: ((pick: CadConnectorPick) => void) | null = null;
  let direction: ((on: CadDrawnOn['on']) => void) | null = null;
  render(
    <TransformDialog
      document={document}
      part={part}
      onSave={save}
      onCancel={() => {}}
      {...{ onPreview: preview, onConnectorsChange: connectors }}
      pickPoint={callback => {
        pick = callback;
      }}
      pickDirection={callback => {
        direction = callback;
      }}
    />
  );
  const latest = () => preview.mock.calls.at(-1)?.[0];
  return {
    document,
    part,
    preview,
    save,
    connectors,
    latest,
    pick: (value: CadConnectorPick) => act(() => pick!(value)),
    direction: (value: CadDrawnOn['on']) => act(() => direction!(value)),
  };
}

it('previews typed XYZ immediately, resets incomplete input, and saves exactly the preview', async () => {
  const { latest, save, document } = setup();
  fireEvent.change(screen.getByRole('textbox', { name: 'X' }), { target: { value: '25' } });
  await waitFor(() => expect(latest()?.parts[0]?.moved).toEqual({ by: [25, 0, 0] }));
  expect(save).not.toHaveBeenCalled();
  expect(document.parts[0]?.moved).toBeUndefined();
  fireEvent.change(screen.getByRole('textbox', { name: 'Y' }), { target: { value: '-' } });
  await waitFor(() => expect(latest()).toBeNull());
  expect(screen.queryByRole('alert')).toBeNull();
  fireEvent.change(screen.getByRole('textbox', { name: 'Y' }), { target: { value: '-15' } });
  await waitFor(() => expect(latest()?.parts[0]?.moved).toEqual({ by: [25, -15, 0] }));
  const candidate = latest();
  fireEvent.click(screen.getByRole('button', { name: 'OK' }));
  await waitFor(() => expect(save).toHaveBeenCalledWith(candidate));
});

it('keeps one copy identity across previews and copy toggles', async () => {
  const { latest, save } = setup(true);
  fireEvent.click(screen.getByRole('checkbox', { name: 'Copy part' }));
  fireEvent.change(screen.getByRole('textbox', { name: 'X' }), { target: { value: '10' } });
  await waitFor(() => expect(latest()?.parts[0]?.copies).toHaveLength(2));
  const id = latest()!.parts[0]!.copies!.find(copy => !copy.pattern)!.id;
  fireEvent.change(screen.getByRole('textbox', { name: 'X' }), { target: { value: '40' } });
  await waitFor(() =>
    expect(latest()?.parts[0]?.copies?.find(copy => !copy.pattern)).toMatchObject({ id, offset: { position: [40, 0, 0] } })
  );
  fireEvent.click(screen.getByRole('checkbox', { name: 'Copy part' }));
  fireEvent.click(screen.getByRole('checkbox', { name: 'Copy part' }));
  await waitFor(() => expect(latest()?.parts[0]?.copies?.find(copy => !copy.pattern)?.id).toBe(id));
  fireEvent.click(screen.getByRole('button', { name: 'OK' }));
  await waitFor(() => expect(save.mock.calls[0]?.[0].parts[0].copies.find((copy: { pattern?: string }) => !copy.pattern).id).toBe(id));
});

it('previews direction, distance and flip without confirming', async () => {
  const { latest, direction } = setup();
  fireEvent.change(screen.getByRole('combobox', { name: 'Transform type' }), { target: { value: 'distance' } });
  fireEvent.click(screen.getByRole('button', { name: 'Direction' }));
  direction({ plane: 'front' });
  fireEvent.change(screen.getByRole('textbox', { name: 'Distance' }), { target: { value: '30' } });
  await waitFor(() => expect(latest()?.parts[0]?.moved).toEqual({ along: { plane: 'front' }, distance: 30 }));
  fireEvent.click(screen.getByRole('checkbox', { name: 'Flip direction' }));
  await waitFor(() => expect(latest()?.parts[0]?.moved).toEqual({ along: { plane: 'front' }, distance: 30, flip: true }));
});

it('previews mate alignment, line and rotation as soon as picks and values are complete', async () => {
  const { latest, part, pick, connectors } = setup();
  fireEvent.click(screen.getByRole('checkbox', { name: 'Copy part' }));
  fireEvent.change(screen.getByRole('combobox', { name: 'Transform type' }), { target: { value: 'mate' } });
  const from: CadConnectorPick = { partId: part.id, point: [20, 10, 0], normal: [0, 0, -1] };
  const to: CadConnectorPick = { partId: 'other', point: [100, 50, 0], normal: [0, 0, 1] };
  fireEvent.click(screen.getByRole('button', { name: 'Mate connector' }));
  pick(from);
  await waitFor(() => expect(connectors).toHaveBeenLastCalledWith({ from }));
  fireEvent.click(screen.getByRole('button', { name: 'Mate connector to move to' }));
  pick(to);
  await waitFor(() => expect(latest()?.parts[0]?.copies?.[0]?.offset?.position).toEqual([80, 40, 0]));
  expect(connectors).toHaveBeenLastCalledWith({ from, to });
  fireEvent.change(screen.getByRole('combobox', { name: 'Transform type' }), { target: { value: 'line' } });
  fireEvent.click(screen.getByRole('button', { name: 'Line start' }));
  pick(from);
  fireEvent.click(screen.getByRole('button', { name: 'Line end' }));
  pick(to);
  await waitFor(() => expect(latest()?.parts[0]?.copies?.[0]?.offset?.position).toEqual([80, 40, 0]));
  fireEvent.change(screen.getByRole('combobox', { name: 'Transform type' }), { target: { value: 'rotate' } });
  fireEvent.click(screen.getByRole('button', { name: 'Axis' }));
  pick(to);
  fireEvent.change(screen.getByRole('textbox', { name: 'Angle' }), { target: { value: '60' } });
  await waitFor(() => expect(latest()?.parts[0]?.copies?.[0]?.turn).toMatchObject({ about: [100, 50, 0], degrees: 60 }));
});

it('recomputes edits from the opening copy and preserves expressions and its identity', async () => {
  const document = createPlateDocument({ width: 200, height: 100 });
  const part = document.parts[0]!;
  part.drawnOn = { on: { plane: 'top' }, offset: 0 };
  part.copies = [{ id: 'copy', offset: { position: [30, 0, 0], rotation: [0, 0, 0, 1] } }];
  const preview = vi.fn<(document: CadDocument | null) => void>();
  render(
    <TransformDialog
      document={document}
      part={part}
      copyId="copy"
      variables={{ gap: { value: 42, kind: 'length' } }}
      onSave={() => {}}
      onCancel={() => {}}
      onPreview={preview}
    />
  );
  const x = screen.getByRole('textbox', { name: 'X' });
  fireEvent.change(x, { target: { value: '50' } });
  await waitFor(() => expect(preview.mock.calls.at(-1)?.[0]?.parts[0]?.copies?.[0]?.offset?.position).toEqual([50, 0, 0]));
  fireEvent.change(x, { target: { value: '#gap' } });
  await waitFor(() =>
    expect(preview.mock.calls.at(-1)?.[0]?.parts[0]?.copies).toEqual([
      expect.objectContaining({
        id: 'copy',
        offset: expect.objectContaining({ position: [42, 0, 0], positionExpressions: ['#gap', null, null] }),
      }),
    ])
  );
  expect(part.copies[0]?.offset?.position).toEqual([30, 0, 0]);
});

it.each([false, true])('copies from the original connector to a connector in the same part family (target copy: %s)', async copy => {
  const { latest, part, pick } = setup(true);
  fireEvent.click(screen.getByRole('checkbox', { name: 'Copy part' }));
  fireEvent.change(screen.getByRole('combobox', { name: 'Transform type' }), { target: { value: 'mate' } });
  // Mate mode starts From; accepting From starts To, with no extra button clicks.
  pick({ partId: part.id, point: [20, 10, 18], normal: [0, 0, 1] });
  expect(screen.getByRole('button', { name: 'Mate connector to move to' }).hasAttribute('data-active')).toBe(true);
  pick({ partId: part.id, copy, point: [20, 10, copy ? 300 : 0], normal: [0, 0, -1] });
  await waitFor(() => expect(latest()?.parts[0]?.copies?.find(copy => !copy.pattern)?.offset?.position).toEqual([0, 0, copy ? 282 : -18]));
  expect(screen.queryByRole('alert')).toBeNull();
});

it('releases an existing distance copy before previewing typed XYZ and saves that preview', async () => {
  const document = createPlateDocument({ width: 200, height: 100 });
  const part = document.parts[0]!;
  part.drawnOn = { on: { plane: 'top' }, offset: 0 };
  part.copies = [
    {
      id: 'along-copy',
      along: { along: { plane: 'front' }, distance: 30 },
      offset: { position: [0, -30, 0], rotation: [0, 0, 0, 1] },
    },
  ];
  const preview = vi.fn<(document: CadDocument | null) => void>();
  const save = vi.fn();
  render(<TransformDialog document={document} part={part} copyId="along-copy" onSave={save} onCancel={() => {}} onPreview={preview} />);
  fireEvent.change(screen.getByRole('combobox', { name: 'Transform type' }), { target: { value: 'xyz' } });
  fireEvent.change(screen.getByRole('textbox', { name: 'X' }), { target: { value: '80' } });
  await waitFor(() =>
    expect(preview.mock.calls.at(-1)?.[0]?.parts[0]?.copies?.[0]).toMatchObject({
      id: 'along-copy',
      offset: { position: [80, -30, 0] },
      placement: { position: [80, -30, 0] },
    })
  );
  const candidate = preview.mock.calls.at(-1)![0]!;
  expect(candidate.parts[0]!.copies![0]!.along).toBeUndefined();
  expect(part.copies[0]!.along).toEqual({ along: { plane: 'front' }, distance: 30 });
  fireEvent.click(screen.getByRole('button', { name: 'OK' }));
  await waitFor(() => expect(save).toHaveBeenCalledWith(candidate));
});

it('previews bare cm moves on an already moved part and stores explicit units for its numeric baseline', async () => {
  const document = createPlateDocument();
  document.lengthUnit = 'cm';
  const part = document.parts[0]!;
  part.drawnOn = { on: { plane: 'top' }, offset: 0 };
  part.moved = { by: [100, 0, 0] };
  const preview = vi.fn<(document: CadDocument | null) => void>();
  render(
    <DesignUnitContext value="cm">
      <TransformDialog document={document} part={part} onSave={() => {}} onCancel={() => {}} onPreview={preview} />
    </DesignUnitContext>
  );
  fireEvent.change(screen.getByRole('textbox', { name: 'X' }), { target: { value: '2' } });
  await waitFor(() => expect(preview.mock.calls.at(-1)?.[0]?.parts[0]?.moved).toMatchObject({ by: [120, 0, 0] }));
  const moved = preview.mock.calls.at(-1)![0]!.parts[0]!.moved!;
  expect('by' in moved && parseCadValue(moved.byExpressions![0]!)).toMatchObject({ value: 120 });
});

it('numbers a new copy after the pattern copies, in the preview and as saved', async () => {
  const { latest, save } = setup(true, 3);
  fireEvent.click(screen.getByRole('checkbox', { name: 'Copy part' }));
  fireEvent.change(screen.getByRole('textbox', { name: 'X' }), { target: { value: '10' } });
  await waitFor(() => expect(latest()?.parts[0]?.copies?.find(copy => !copy.pattern)?.number).toBe(4));
  fireEvent.click(screen.getByRole('button', { name: 'OK' }));
  await waitFor(() => expect(save).toHaveBeenCalled());
  expect(save.mock.calls[0]?.[0].parts[0].copies.find((copy: { pattern?: string }) => !copy.pattern).number).toBe(4);
});
