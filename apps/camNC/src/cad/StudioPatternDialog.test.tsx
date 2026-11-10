import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { createPlateDocument, setPartPattern, type CadDocument } from '@wbcnc/cad';
import { afterEach, expect, it, vi } from 'vitest';
import { PartPatternDialog } from './PartFeatureDialogs';
import { StudioPatternDialog } from './StudioPatternDialog';
import { StudioFeatureDialog, type StudioFeatureDialogState } from './StudioFeatureDialog';

vi.mock('./PartFeatureDialogs', { spy: true });
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const current = () => vi.mocked(PartPatternDialog).mock.lastCall![0];
function setup(document = createPlateDocument()) {
  const onChange = vi.fn<(change: (document: CadDocument) => CadDocument) => void>();
  const onOk = vi.fn(),
    onCancel = vi.fn(),
    onPreview = vi.fn<(document: CadDocument | null) => void>();
  let source = document,
    owner: object = {};
  const view = () => (
    <StudioPatternDialog
      owner={owner}
      document={source}
      part={source.parts[0]!}
      onChange={onChange}
      onOk={onOk}
      onCancel={onCancel}
      onPreview={onPreview}
    />
  );
  const rendered = render(view());
  return {
    ...rendered,
    onChange,
    onOk,
    onCancel,
    onPreview,
    replace: (document: CadDocument, nextOwner = owner) => {
      source = document;
      owner = nextOwner;
      rendered.rerender(view());
    },
  };
}

it('keeps one pattern identity through local previews and publishes only one accepted candidate', async () => {
  const document = createPlateDocument(),
    before = JSON.stringify(document);
  const { onChange, onOk, onPreview } = setup(document);
  await waitFor(() => expect(current().part.pattern).toBeDefined());
  const patternId = current().part.pattern!.id;
  for (const count of [4, 5])
    act(() => current().onChange(document => setPartPattern(document, document.parts[0]!.id, { axis: 'x', count, spacing: 100 })));
  expect(current().part.pattern!.id).toBe(patternId);
  expect(current().part.copies).toHaveLength(4);
  expect(onPreview.mock.lastCall![0]!.parts[0]!.pattern!.id).toBe(patternId);
  expect(onChange).not.toHaveBeenCalled();
  expect(JSON.stringify(document)).toBe(before);
  const confirm = current().onOk;
  act(() => {
    confirm();
    confirm();
  });
  expect(onChange).toHaveBeenCalledOnce();
  expect(onOk).toHaveBeenCalledOnce();
  const accepted = onChange.mock.calls[0]![0](document);
  expect(accepted.parts[0]!.pattern).toMatchObject({ id: patternId, count: 5 });
  expect(accepted.parts[0]!.copies!.map(copy => copy.id)).toEqual(current().part.copies!.map(copy => copy.id));
  expect(JSON.stringify(document)).toBe(before);
});

it('cancels without publishing and rejects retained field or confirmation callbacks afterward', async () => {
  const document = createPlateDocument(),
    before = JSON.stringify(document);
  const { onChange, onOk, onCancel, onPreview } = setup(document);
  await waitFor(() => expect(current().part.pattern).toBeDefined());
  const stale = current();
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
  const previewCalls = onPreview.mock.calls.length;
  act(() => {
    stale.onChange(document => setPartPattern(document, document.parts[0]!.id, { axis: 'x', count: 9, spacing: 100 }));
    stale.onOk();
    stale.onCancel();
  });
  expect(onCancel).toHaveBeenCalledOnce();
  expect(onChange).not.toHaveBeenCalled();
  expect(onOk).not.toHaveBeenCalled();
  expect(onPreview).toHaveBeenCalledTimes(previewCalls);
  expect(JSON.stringify(document)).toBe(before);
});

it.each(['source', 'dialog'] as const)('blocks an old candidate when its opening %s is replaced', async changed => {
  const document = createPlateDocument();
  const { onChange, onOk, onCancel, onPreview, replace } = setup(document);
  await waitFor(() => expect(current().part.pattern).toBeDefined());
  const stale = current();
  const replacement = changed === 'source' ? { ...document, name: 'A newer design', revision: document.revision + 1 } : document;
  const before = JSON.stringify(replacement);
  replace(replacement, changed === 'dialog' ? {} : undefined);
  expect(screen.getByRole('button', { name: 'OK' })).toBeDisabled();
  expect(screen.getByRole('alert')).toHaveTextContent('The design changed while this pattern was open.');
  expect(onPreview).toHaveBeenLastCalledWith(null);
  act(() => {
    stale.onChange(document => setPartPattern(document, document.parts[0]!.id, { axis: 'x', count: 9, spacing: 100 }));
    stale.onOk();
  });
  expect(onChange).not.toHaveBeenCalled();
  expect(onOk).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
  expect(onCancel).toHaveBeenCalledOnce();
  expect(JSON.stringify(replacement)).toBe(before);
});

it('ignores callbacks after unmount and starts a fresh candidate when the same feature is opened again', async () => {
  const document = createPlateDocument();
  const onChange = vi.fn(),
    onOk = vi.fn(),
    onCancel = vi.fn(),
    onPreview = vi.fn();
  let state: StudioFeatureDialogState = { kind: 'pattern', partId: document.parts[0]!.id, before: document };
  const view = () => (
    <StudioFeatureDialog
      state={state}
      document={document}
      variables={{}}
      onChange={onChange}
      onOk={onOk}
      onCancel={onCancel}
      onPreview={onPreview}
      profilePicking={false}
      onPickProfile={vi.fn()}
      onEditSketch={vi.fn()}
      pickDirection={vi.fn()}
      pickPoint={vi.fn()}
    />
  );
  const rendered = render(view());
  await waitFor(() => expect(current().part.pattern).toBeDefined());
  const stale = current(),
    firstId = stale.part.pattern!.id;
  act(() => stale.onChange(document => setPartPattern(document, document.parts[0]!.id, { axis: 'x', count: 5, spacing: 100 })));
  state = { ...state };
  rendered.rerender(view());
  await waitFor(() => expect(current().part.pattern!.id).not.toBe(firstId));
  expect(current().part.pattern!.count).toBe(2);
  const previewCalls = onPreview.mock.calls.length;
  act(() => {
    stale.onChange(document => setPartPattern(document, document.parts[0]!.id, { axis: 'x', count: 9, spacing: 100 }));
    stale.onOk();
  });
  expect(onChange).not.toHaveBeenCalled();
  expect(onOk).not.toHaveBeenCalled();
  expect(onPreview).toHaveBeenCalledTimes(previewCalls);
  const closed = current();
  rendered.unmount();
  act(() => {
    closed.onChange(document => setPartPattern(document, document.parts[0]!.id, { axis: 'x', count: 9, spacing: 100 }));
    closed.onOk();
  });
  expect(onChange).not.toHaveBeenCalled();
  expect(onOk).not.toHaveBeenCalled();
});
