import { createPlateDocument, evaluateCadDocument, type CadDocument } from '@wbcnc/cad';
import { cadSession, commitCadSession, endCadSession } from '@wbcnc/cad-editor/session';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { userEvent } from '@vitest/browser/context';
import { afterEach, expect, it, vi } from 'vitest';
import { StudioProposals } from './StudioProposals';
import { useAssistantProposal } from './assistant/useAssistantProposal';

function width(document: CadDocument) {
  const outline = evaluateCadDocument(document).parts[0]!.outline;
  return Math.max(...outline.map(point => point.x)) - Math.min(...outline.map(point => point.x));
}

vi.mock('./WorkspaceView', () => ({
  default: ({ document }: { document: CadDocument }) => <output aria-label="Preview width">{width(document)}</output>,
}));

const ids: string[] = [];
afterEach(() => {
  cleanup();
  ids.splice(0).forEach(endCadSession);
});

function setup() {
  const source = createPlateDocument({ width: 120, height: 80 });
  ids.push(source.id);
  const session = cadSession(source);
  const onApply = vi.fn<(document: CadDocument) => void>();
  let disabled = false;
  const Component = () => {
    const checkedProposal = useAssistantProposal(session.document);
    return (
      <div className="cad-editor">
        <StudioProposals
          checkedProposal={checkedProposal}
          document={session.document}
          session={session}
          disabled={disabled}
          onApply={onApply}
        />
      </div>
    );
  };
  const view = render(<Component />);
  const input = view.container.querySelector<HTMLInputElement>('input[type="file"]')!;
  const upload = (candidate: CadDocument) =>
    fireEvent.change(input, { target: { files: [new File([JSON.stringify(candidate)], 'candidate.json', { type: 'application/json' })] } });
  return {
    source,
    session,
    onApply,
    input,
    upload,
    refresh: () => view.rerender(<Component />),
    setDisabled: (value: boolean) => {
      disabled = value;
      view.rerender(<Component />);
    },
  };
}

function resized(source: CadDocument) {
  const candidate = structuredClone(source);
  const dimension = candidate.parts[0]!.sketch.constraints.find(constraint => constraint.label === 'Width')!;
  if (!('value' in dimension)) throw new Error('Missing width dimension');
  dimension.value = 200;
  return candidate;
}

it('solves an imported design before previewing or applying its geometry', async () => {
  const { source, session, onApply, upload } = setup();
  const candidate = resized(source);
  expect(width(candidate)).toBe(120);
  upload(candidate);
  const review = await screen.findByRole('dialog', { name: 'Review design change' }, { timeout: 20_000 });
  const preview = await within(review).findByLabelText('Preview width', {}, { timeout: 20_000 });
  expect(Number(preview.textContent)).toBeCloseTo(200, 6);
  expect(session.document).toEqual(source);
  expect(session.past).toHaveLength(0);
  await userEvent.click(within(review).getByRole('button', { name: 'Apply as one undo step' }));
  expect(onApply).toHaveBeenCalledTimes(1);
  expect(width(onApply.mock.calls[0]![0])).toBeCloseTo(200, 6);
  expect(session.past).toHaveLength(1);
}, 30_000);

it('rejects an inconsistent imported sketch and clears its error after a valid retry', async () => {
  const { source, session, upload } = setup();
  const candidate = resized(source);
  const original = source.parts[0]!.sketch.constraints.find(constraint => constraint.label === 'Width')!;
  candidate.parts[0]!.sketch.constraints.push({ ...original, id: crypto.randomUUID(), label: 'Conflicting width' });
  upload(candidate);
  await screen.findByRole('alert', {}, { timeout: 20_000 });
  expect(screen.queryByRole('dialog', { name: 'Review design change' })).toBeNull();
  expect(session.document).toEqual(source);
  expect(session.past).toHaveLength(0);
  upload(resized(source));
  await screen.findByRole('dialog', { name: 'Review design change' }, { timeout: 20_000 });
  expect(screen.queryByRole('alert')).toBeNull();
}, 30_000);

it('keeps the pre-import snapshot for stale refusal and blocks concurrent file selection', async () => {
  const { source, session, input, refresh } = setup();
  let finishRead: ((text: string) => void) | undefined;
  const file = new File([], 'candidate.json', { type: 'application/json' });
  Object.defineProperty(file, 'text', {
    value: () =>
      new Promise<string>(resolve => {
        finishRead = resolve;
      }),
  });
  fireEvent.change(input, { target: { files: [file] } });
  await waitFor(() => expect(input.disabled).toBe(true));
  commitCadSession(session, { ...source, name: 'Hand edit while reading' });
  refresh();
  finishRead!(JSON.stringify(resized(source)));
  const review = await screen.findByRole('dialog', { name: 'Review design change' }, { timeout: 20_000 });
  expect(within(review).getByText(/The design has changed/)).toBeDefined();
  expect(within(review).getByRole<HTMLButtonElement>('button', { name: 'Apply as one undo step' }).disabled).toBe(true);
  expect(session.document.name).toBe('Hand edit while reading');
  expect(session.past).toHaveLength(1);
}, 30_000);

it('keeps a reviewed candidate pending while the host has an uncommitted feature preview', async () => {
  const { source, session, onApply, upload, setDisabled } = setup();
  upload(resized(source));
  const review = await screen.findByRole('dialog', { name: 'Review design change' }, { timeout: 20_000 });
  setDisabled(true);
  const apply = within(review).getByRole<HTMLButtonElement>('button', { name: 'Apply as one undo step' });
  expect(apply.disabled).toBe(true);
  expect(within(review).getByText(/Finish or cancel the current edit/)).toBeDefined();
  expect(onApply).not.toHaveBeenCalled();
  expect(session.past).toHaveLength(0);
  setDisabled(false);
  await waitFor(() => expect(apply.disabled).toBe(false));
  await userEvent.click(apply);
  expect(onApply).toHaveBeenCalledTimes(1);
  expect(width(onApply.mock.calls[0]![0])).toBeCloseTo(200, 6);
}, 30_000);
