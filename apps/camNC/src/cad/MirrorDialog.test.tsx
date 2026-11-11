import { createPlateDocument, type CadDocument, type CadDrawnOn } from '@wbcnc/cad';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { MirrorDialog } from './MirrorDialog';

afterEach(cleanup);

it.each(['self', 'dependent'])('rejects a %s mirror plane dependency and allows correction', async kind => {
  const document = createPlateDocument({ width: 100, height: 60 });
  const part = document.parts[0]!;
  const save = vi.fn();
  part.copies = [
    { id: 'first', mirrored: true, mirror: { across: { plane: 'top' } } },
    { id: 'second', mirrored: true, mirror: { across: { partId: part.id, copyId: 'first', face: 'top' } } },
  ];
  const preview = vi.fn<(document: CadDocument | null) => void>();
  let picked: (on: CadDrawnOn['on']) => void = () => {};
  render(
    <MirrorDialog
      document={document}
      partId={part.id}
      copyId="first"
      pickPlane={callback => {
        picked = callback;
      }}
      onSave={save}
      onPreview={preview}
      onCancel={vi.fn()}
    />
  );
  fireEvent.click(screen.getByRole('button', { name: 'Mirror plane' }));
  act(() => picked({ partId: part.id, copyId: kind === 'self' ? 'first' : 'second', face: 'top' }));
  expect(screen.getByRole('alert').textContent).toContain('does not depend on this mirror');
  expect(preview.mock.calls.at(-1)?.[0]).toBeNull();
  expect(screen.getByRole('button', { name: 'OK' })).toBeDisabled();
  fireEvent.click(screen.getByRole('button', { name: 'Mirror plane' }));
  act(() => picked({ plane: 'right' }));
  expect(screen.queryByRole('alert')).toBeNull();
  expect(screen.getByRole('button', { name: 'OK' })).not.toBeDisabled();
  const candidate = preview.mock.calls.at(-1)?.[0];
  expect(candidate?.parts[0]?.copies?.[0]).toMatchObject({ id: 'first', mirror: { across: { plane: 'right' } } });
  fireEvent.click(screen.getByRole('button', { name: 'OK' }));
  await waitFor(() => expect(save).toHaveBeenCalledWith(candidate));
});

it.each([false, true])('blocks a copy face without persisted placement and permits a valid replacement (editing: %s)', async editing => {
  const document = createPlateDocument({ width: 100, height: 60 });
  const part = document.parts[0]!;
  part.placement = { position: [0, 0, 0], rotation: [0, 0, 0, 1] };
  const support = createPlateDocument({ width: 100, height: 60 }).parts[0]!;
  support.copies = [{ id: 'unplaced' }];
  document.parts.push(support);
  const across: CadDrawnOn['on'] = { partId: support.id, copyId: 'unplaced', face: 'top' };
  if (editing) part.copies = [{ id: 'mirror', mirrored: true, mirror: { across } }];
  const preview = vi.fn<(document: CadDocument | null) => void>();
  let picked: (on: CadDrawnOn['on']) => void = () => {};
  const save = vi.fn();
  render(
    <MirrorDialog
      document={document}
      partId={part.id}
      copyId={editing ? 'mirror' : undefined}
      pickPlane={callback => {
        picked = callback;
      }}
      onSave={save}
      onPreview={preview}
      onCancel={vi.fn()}
    />
  );
  if (!editing) act(() => picked(across));
  expect(screen.getByRole('alert').textContent).toContain('cannot be placed');
  expect(preview.mock.calls.at(-1)?.[0]).toBeNull();
  expect(screen.getByRole('button', { name: 'OK' })).toBeDisabled();
  fireEvent.click(screen.getByRole('button', { name: 'OK' }));
  expect(save).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Mirror plane' }));
  act(() => picked({ plane: 'right' }));
  expect(screen.queryByRole('alert')).toBeNull();
  expect(screen.getByRole('button', { name: 'OK' })).not.toBeDisabled();
  const first = preview.mock.calls.at(-1)?.[0]?.parts[0]?.copies?.[0];
  expect(first).toMatchObject({ mirror: { across: { plane: 'right' } } });
  fireEvent.click(screen.getByRole('button', { name: 'Mirror plane' }));
  act(() => picked({ plane: 'front' }));
  const candidate = preview.mock.calls.at(-1)?.[0];
  expect(candidate?.parts[0]?.copies).toHaveLength(1);
  expect(candidate?.parts[0]?.copies?.[0]).toMatchObject({ id: first!.id, mirror: { across: { plane: 'front' } } });
  expect(document.parts[0]?.copies?.length ?? 0).toBe(editing ? 1 : 0);
  fireEvent.click(screen.getByRole('button', { name: 'OK' }));
  await waitFor(() => expect(save).toHaveBeenCalledWith(candidate));
});

it('numbers a new mirror after the pattern copies, in the preview and as saved', async () => {
  const document = createPlateDocument({ width: 100, height: 60 });
  const part = document.parts[0]!;
  part.placement = { position: [0, 0, 0], rotation: [0, 0, 0, 1] };
  part.pattern = { id: 'pattern', axis: 'x', count: 3, spacing: 120 };
  part.copies = [1, 2].map(k => ({
    id: `pattern:${k}`,
    pattern: 'pattern',
    placement: { position: [120 * k, 0, 0] as [number, number, number], rotation: [0, 0, 0, 1] as [number, number, number, number] },
  }));
  const preview = vi.fn<(document: CadDocument | null) => void>();
  let picked: (on: CadDrawnOn['on']) => void = () => {};
  const save = vi.fn();
  render(
    <MirrorDialog
      document={document}
      partId={part.id}
      pickPlane={callback => {
        picked = callback;
      }}
      onSave={save}
      onPreview={preview}
      onCancel={vi.fn()}
    />
  );
  act(() => picked({ plane: 'right' }));
  await waitFor(() => expect(preview.mock.calls.at(-1)?.[0]?.parts[0]?.copies?.find(copy => !copy.pattern)?.number).toBe(4));
  fireEvent.click(screen.getByRole('button', { name: 'OK' }));
  await waitFor(() => expect(save).toHaveBeenCalled());
  expect(save.mock.calls[0]?.[0].parts[0].copies.find((copy: { pattern?: string }) => !copy.pattern).number).toBe(4);
});
