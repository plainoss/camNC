import type { ComponentProps } from 'react';
import { addPartCut, createCadPart, createPlateDocument, type CadDocument } from '@wbcnc/cad';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { StudioDialogHost } from './StudioDialogHost';

afterEach(cleanup);

type Props = ComponentProps<typeof StudioDialogHost>;

function host(document: CadDocument, dialog: Props['dialog'], props: Partial<Props> = {}) {
  return (
    <StudioDialogHost
      dialog={dialog}
      document={document}
      variables={{}}
      change={() => {}}
      close={() => {}}
      onOk={() => {}}
      onCancel={() => {}}
      onPreview={() => {}}
      setDirectionPicker={() => {}}
      pickPoint={() => {}}
      {...props}
    />
  );
}

it('forwards a mirror plane pick into its live candidate', async () => {
  const document = createPlateDocument();
  const setDirectionPicker = vi.fn<Props['setDirectionPicker']>();
  const onPreview = vi.fn<Props['onPreview']>();
  const change = vi.fn<Props['change']>();
  render(host(document, { kind: 'mirror', partId: document.parts[0]!.id }, { change, onPreview, setDirectionPicker }));
  const pick = setDirectionPicker.mock.calls.at(-1)?.[0];
  expect(pick).toBeTypeOf('function');
  act(() => pick?.({ plane: 'front' }));
  await waitFor(() => expect(onPreview.mock.calls.at(-1)?.[0]?.parts[0]?.copies?.[0]?.mirror).toEqual({ across: { plane: 'front' } }));
  expect(change).not.toHaveBeenCalled();
});

it('closes a save-only dialog on Cancel without changing the design', () => {
  const document = createPlateDocument();
  const change = vi.fn<Props['change']>();
  const close = vi.fn();
  render(host(document, { kind: 'variable' }, { change, close }));
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
  expect(close).toHaveBeenCalledOnce();
  expect(change).not.toHaveBeenCalled();
});

it('removes the edited cut parts step from the design as it is when asked, then closes', () => {
  const base = createPlateDocument();
  const second = { ...structuredClone(base.parts[0]!), id: 'second', name: 'Second' };
  const made = addPartCut({ ...base, parts: [...base.parts, second] }, [base.parts[0]!.id], ['second'], { value: 0 });
  const change = vi.fn<Props['change']>();
  const close = vi.fn();
  render(host(made.document, { kind: 'partCut', id: made.id }, { change, close }));
  fireEvent.click(screen.getByRole('button', { name: 'Delete step' }));
  expect(close).toHaveBeenCalledOnce();
  const later = { ...made.document, revision: made.document.revision + 5 };
  expect(change.mock.calls[0]![0](later).partCuts ?? []).toEqual([]);
});

it('gives an Extrude dialog its part from the design it reads', () => {
  const document = createPlateDocument({ thickness: 18 });
  const partId = document.parts[0]!.id;
  const dialog: Props['dialog'] = { kind: 'extrude', partId, before: { document, past: [], future: [] } };
  const view = render(host(document, dialog));
  expect(screen.getByRole('textbox', { name: 'Thickness' })).toHaveProperty('value', '18');
  // A depth dragged in the view reaches the dialog as the design it reads, before the design itself changes.
  const dragged = { ...document, parts: [{ ...document.parts[0]!, thickness: 40 }] };
  view.rerender(host(dragged, dialog, { depthDragging: true }));
  expect(screen.getByRole('textbox', { name: 'Thickness' })).toHaveProperty('value', '40');
});

function twoBoards() {
  const base = createPlateDocument();
  return { ...base, parts: [...base.parts, { ...createCadPart('Back', 6), id: 'back' }] };
}

it('adds a cut parts step to the design as it is when saved, then closes', async () => {
  const document = twoBoards();
  const side = document.parts[0]!.id;
  const change = vi.fn<Props['change']>();
  const close = vi.fn();
  const picks = (seq: number) => ({
    change,
    close,
    cutTool: 'back',
    partPicks: { pick: seq ? { partId: side, seq } : null, select: () => {} },
  });
  const view = render(host(document, { kind: 'partCut' }, picks(0)));
  view.rerender(host(document, { kind: 'partCut' }, picks(1)));
  fireEvent.click(screen.getByRole('button', { name: 'Cut' }));
  await waitFor(() => expect(close).toHaveBeenCalledOnce());
  const later = { ...document, name: 'Renamed since' };
  const saved = change.mock.calls[0]![0](later);
  expect(saved.name).toBe('Renamed since');
  expect(saved.partCuts).toEqual([expect.objectContaining({ tools: ['back'], targets: [side] })]);
});

it('changes the edited cut parts step in place when saved', async () => {
  const document = twoBoards();
  const made = addPartCut(document, ['back'], [document.parts[0]!.id], { value: 0 });
  const change = vi.fn<Props['change']>();
  const close = vi.fn();
  render(host(made.document, { kind: 'partCut', id: made.id }, { change, close }));
  fireEvent.click(screen.getByRole('checkbox', { name: 'Keep tools' }));
  fireEvent.click(screen.getByRole('button', { name: 'Save' }));
  await waitFor(() => expect(close).toHaveBeenCalledOnce());
  const saved = change.mock.calls[0]![0](made.document).partCuts!;
  expect(saved.map(step => step.id)).toEqual([made.id]);
  expect(saved[0]!.consumeTools).not.toBe(made.document.partCuts![0]!.consumeTools);
});
