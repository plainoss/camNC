import { createRef } from 'react';
import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { StudioSketchDialog } from './StudioSketchDialog';
import { fieldsSettled } from './variableFields';

vi.mock('./variableFields', { spy: true });
afterEach(() => {
  cleanup();
  vi.mocked(fieldsSettled).mockReset();
});

function setup() {
  const editor = createRef<HTMLDivElement>();
  const confirm = vi.fn();
  const extrude = vi.fn();
  let finishField!: () => void;
  const field = new Promise<void>(resolve => {
    finishField = resolve;
  });
  vi.mocked(fieldsSettled).mockReturnValue(field);
  const view = (key = 'first', checking = false, disabled = false) => (
    <div ref={editor}>
      <StudioSketchDialog
        key={key}
        editor={editor}
        title={key}
        plane="Top plane"
        checking={checking}
        disabled={disabled}
        reason={disabled ? 'The sketch is invalid.' : null}
        showConstraints
        onShowConstraints={() => {}}
        onConfirm={confirm}
        onExtrude={extrude}
        onCancel={() => {}}
      />
    </div>
  );
  const rendered = render(view());
  const key = () => fireEvent.keyDown(editor.current!, { key: 'Enter', ctrlKey: true });
  const settle = async () => {
    await act(async () => {
      finishField();
      await field;
    });
  };
  return { ...rendered, editor, view, key, confirm, extrude, settle };
}

it('confirms once after a field and its resulting sketch check settle', async () => {
  const { key, confirm, rerender, view, settle } = setup();
  key();
  key();
  rerender(view('first', true, true));
  await settle();
  expect(confirm).not.toHaveBeenCalled();
  rerender(view());
  await waitFor(() => expect(confirm).toHaveBeenCalledTimes(1));
});

it('discards an invalid request rather than confirming after a later correction', async () => {
  const { key, confirm, rerender, view, settle } = setup();
  key();
  rerender(view('first', true, true));
  await settle();
  rerender(view('first', false, true));
  rerender(view());
  expect(confirm).not.toHaveBeenCalled();
  key();
  await waitFor(() => expect(confirm).toHaveBeenCalledTimes(1));
});

it('does not apply a queued confirmation to a different sketch', async () => {
  const { key, confirm, rerender, view, settle } = setup();
  key();
  rerender(view('second'));
  await settle();
  expect(confirm).not.toHaveBeenCalled();
  key();
  await waitFor(() => expect(confirm).toHaveBeenCalledTimes(1));
});

it('discards a queued confirmation if another interaction takes ownership', async () => {
  const { key, confirm, editor, settle } = setup();
  key();
  const secondary = document.createElement('div');
  secondary.setAttribute('role', 'dialog');
  editor.current!.append(secondary);
  await settle();
  expect(confirm).not.toHaveBeenCalled();
  secondary.remove();
  expect(confirm).not.toHaveBeenCalled();
  key();
  await waitFor(() => expect(confirm).toHaveBeenCalledTimes(1));
});

it('confirms into an Extrude with Shift+E, but leaves Shift+E to a field being typed in', async () => {
  const { editor, confirm, extrude, settle } = setup();
  const field = document.createElement('input');
  editor.current!.append(field);
  fireEvent.keyDown(field, { key: 'E', code: 'KeyE', shiftKey: true });
  fireEvent.keyDown(editor.current!, { key: 'E', code: 'KeyE', shiftKey: true, ctrlKey: true });
  await settle();
  expect(extrude).not.toHaveBeenCalled();
  fireEvent.keyDown(editor.current!, { key: 'E', code: 'KeyE', shiftKey: true });
  await waitFor(() => expect(extrude).toHaveBeenCalledTimes(1));
  expect(confirm).not.toHaveBeenCalled();
});
