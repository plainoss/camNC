import { createPlateDocument, type CadDrawnOn } from '@wbcnc/cad';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { MirrorDialog } from './MirrorDialog';

afterEach(cleanup);

it.each(['self', 'dependent'])('rejects a %s mirror plane dependency and allows correction', kind => {
  const document = createPlateDocument({ width: 100, height: 60 });
  const part = document.parts[0]!;
  part.copies = [
    { id: 'first', mirrored: true, mirror: { across: { plane: 'top' } } },
    { id: 'second', mirrored: true, mirror: { across: { partId: part.id, copyId: 'first', face: 'top' } } },
  ];
  let picked: (on: CadDrawnOn['on']) => void = () => {};
  render(
    <MirrorDialog
      document={document}
      partId={part.id}
      copyId="first"
      pickPlane={callback => {
        picked = callback;
      }}
      onSave={vi.fn()}
      onCancel={vi.fn()}
    />
  );
  fireEvent.click(screen.getByRole('button', { name: 'Mirror plane' }));
  act(() => picked({ partId: part.id, copyId: kind === 'self' ? 'first' : 'second', face: 'top' }));
  expect(screen.getByRole('alert').textContent).toContain('does not depend on this mirror');
  expect(screen.getByRole('button', { name: 'OK' })).toBeDisabled();
  fireEvent.click(screen.getByRole('button', { name: 'Mirror plane' }));
  act(() => picked({ plane: 'right' }));
  expect(screen.queryByRole('alert')).toBeNull();
  expect(screen.getByRole('button', { name: 'OK' })).not.toBeDisabled();
});

it.each([false, true])('blocks a copy face without persisted placement and permits a valid replacement (editing: %s)', editing => {
  const document = createPlateDocument({ width: 100, height: 60 });
  const part = document.parts[0]!;
  part.placement = { position: [0, 0, 0], rotation: [0, 0, 0, 1] };
  const support = createPlateDocument({ width: 100, height: 60 }).parts[0]!;
  support.copies = [{ id: 'unplaced' }];
  document.parts.push(support);
  const across: CadDrawnOn['on'] = { partId: support.id, copyId: 'unplaced', face: 'top' };
  if (editing) part.copies = [{ id: 'mirror', mirrored: true, mirror: { across } }];
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
      onCancel={vi.fn()}
    />
  );
  if (!editing) act(() => picked(across));
  expect(screen.getByRole('alert').textContent).toContain('cannot be placed');
  expect(screen.getByRole('button', { name: 'OK' })).toBeDisabled();
  fireEvent.click(screen.getByRole('button', { name: 'OK' }));
  expect(save).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Mirror plane' }));
  act(() => picked({ plane: 'right' }));
  expect(screen.queryByRole('alert')).toBeNull();
  expect(screen.getByRole('button', { name: 'OK' })).not.toBeDisabled();
});
