import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import { userEvent } from '@vitest/browser/context';
import { createPlateDocument, type CadDocument } from '@wbcnc/cad';
import { inspectCadDocument } from '@wbcnc/cad-script';
import { cadProposal, compareCadProposal, type CadProposal } from '@wbcnc/cad-editor/proposal';
import { cadSession, endCadSession } from '@wbcnc/cad-editor/session';
import { afterEach, expect, it, vi } from 'vitest';
import WorkspaceView from './WorkspaceView';
import { CadEditor } from './CadEditor';
import { runDesignAssistant } from './assistant/loop';
import { createAssistantUsage } from './assistant/runBudget';
import { defaultProvider, rememberAssistantCredentials } from './assistant/keyStore';
import { readConversation } from './assistant/conversationStore';

vi.mock('./assistant/loop', { spy: true });
vi.mock('./WorkspaceView', { spy: true });
const ids: string[] = [];
afterEach(() => {
  cleanup();
  ids.splice(0).forEach(endCadSession);
  rememberAssistantCredentials(null);
  vi.restoreAllMocks();
});
const review = () => screen.findByRole('dialog', { name: 'Review design change' });
const dock = () => screen.getByRole('complementary', { name: 'Design assistant' });
const retainedWarning = 'The target copy of Plate is not present. Restore its pattern count or choose another target.';
const ready = () => waitFor(() => expect(document.querySelector('.cad-editor')).toHaveAttribute('aria-busy', 'false'), { timeout: 20_000 });
async function checkedProposal() {
  const source = createPlateDocument();
  ids.push(source.id);
  let proposal: CadProposal | undefined;
  vi.mocked(runDesignAssistant).mockImplementation(async options => {
    const candidate = structuredClone(options.base);
    candidate.parts[0]!.thickness = 24;
    candidate.partCuts = [
      { id: 'pending-copy-cut', tools: [candidate.parts[0]!.id], targets: [`${candidate.parts[0]!.id}:missing-copy`], clearance: 0 },
    ];
    const checked = await inspectCadDocument(candidate);
    expect(checked.report.ok).toBe(true);
    proposal = cadProposal(options.base, checked.document);
    expect(compareCadProposal(proposal).newWarnings).toEqual([retainedWarning]);
    return { status: 'proposal', proposal, messages: [], checks: 1, usage: createAssistantUsage() };
  });
  rememberAssistantCredentials({ config: { ...defaultProvider, model: 'recorded' }, key: 'recorded-key' });
  const changed = vi.fn<(document: CadDocument) => void>();
  render(
    <div style={{ height: 700, width: 1100, display: 'flex' }}>
      <CadEditor document={source} startIn3D onDraftChange={changed} onFinish={() => {}} onCancel={() => {}} />
    </div>
  );
  await screen.findByTestId('workspace-3d', {}, { timeout: 20_000 });
  await ready();
  await waitFor(() => expect(screen.queryByText(/^Checking sketch/)).toBeNull(), { timeout: 20_000 });
  await userEvent.click(screen.getByRole('button', { name: 'Assistant' }));
  // The toolbar toggles before the lazy Dock chunk mounts; wait for its actual accessible panel.
  await screen.findByRole('complementary', { name: 'Design assistant' }, { timeout: 20_000 });
  await userEvent.type(within(dock()).getByRole('textbox', { name: 'Message' }), 'Make the plate 24 mm thick.');
  await userEvent.click(within(dock()).getByRole('button', { name: 'Send' }));
  // Publishing the checked candidate rerenders the portal's parent; wait for the review action itself.
  await screen.findByRole('button', { name: /(?:Preview|Review) proposal/ }, { timeout: 30_000 });
  return { source, session: cadSession(source), proposal: proposal!, latest: () => changed.mock.calls.at(-1)?.[0] ?? source };
}

it('retains the identical checked candidate and warnings after Escape, Close and closing the dock, then applies once with Undo', async () => {
  const { source, session, proposal, latest } = await checkedProposal();
  const before = structuredClone(latest()),
    history = session.past.length;
  const open = async () => {
    await userEvent.click(within(dock()).getByRole('button', { name: /(?:Preview|Review) proposal/ }));
    const dialog = await review();
    expect(within(dialog).getByText(retainedWarning)).toBeTruthy();
    await waitFor(() => expect(vi.mocked(WorkspaceView).mock.calls.at(-1)?.[0].document).toBe(proposal.document));
    return dialog;
  };
  await open();
  await userEvent.keyboard('{Escape}');
  await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Review design change' })).toBeNull());
  expect(readConversation(source.id).some(message => message.proposalOutcome)).toBe(false);
  await within(dock()).findByRole('button', { name: 'Review proposal' });
  let dialog = await open();
  await userEvent.click(within(dialog).getByRole('button', { name: 'Close' }));
  await userEvent.click(within(dock()).getByRole('button', { name: 'Close assistant' }));
  await userEvent.click(screen.getByRole('button', { name: 'Assistant' }));
  await screen.findByRole('complementary', { name: 'Design assistant' });
  expect(latest()).toEqual(before);
  expect(session.past).toHaveLength(history);
  expect(runDesignAssistant).toHaveBeenCalledTimes(1);
  dialog = await open();
  await userEvent.click(within(dialog).getByRole('button', { name: 'Apply as one undo step' }));
  await waitFor(() => expect(latest().parts[0]!.thickness).toBe(24));
  expect(session.past).toHaveLength(history + 1);
  expect(latest().parts).toEqual(proposal.document.parts);
  expect(latest().partCuts).toEqual(proposal.document.partCuts);
  expect(latest().parts[0]!.id).toBe(source.parts[0]!.id);
  expect(readConversation(source.id).filter(message => message.proposalOutcome === 'applied')).toHaveLength(1);
  expect(within(dock()).queryByRole('button', { name: 'Review proposal' })).toBeNull();
  await userEvent.click(within(screen.getByRole('toolbar', { name: 'Part Studio toolbar' })).getByRole('button', { name: /^Undo/ }));
  await waitFor(() => expect(latest().parts[0]!.thickness).toBe(18));
  expect(readConversation(source.id).some(message => message.event && message.text.includes('was undone'))).toBe(true);
}, 60_000);

it('discards only through the explicit dock action without applying or creating an Undo step', async () => {
  const { source, session, latest } = await checkedProposal();
  const before = structuredClone(latest()),
    history = session.past.length;
  await userEvent.click(within(dock()).getByRole('button', { name: 'Review proposal' }));
  const dialog = await review();
  await userEvent.click(within(dialog).getByRole('button', { name: 'Close' }));
  await userEvent.click(within(dock()).getByRole('button', { name: 'Discard proposal' }));
  expect(within(dock()).queryByRole('button', { name: 'Review proposal' })).toBeNull();
  expect(within(dock()).getByRole('status')).toHaveTextContent('Proposal discarded.');
  expect(readConversation(source.id).filter(message => message.proposalOutcome === 'discarded')).toHaveLength(1);
  expect(readConversation(source.id).some(message => message.proposalOutcome === 'applied')).toBe(false);
  expect(latest()).toEqual(before);
  expect(session.past).toHaveLength(history);
  expect(runDesignAssistant).toHaveBeenCalledTimes(1);
}, 60_000);

it('retains a stale candidate across real Sketch editing and Finish, and refuses Apply after reopening the assistant', async () => {
  const { source, session, proposal, latest } = await checkedProposal();
  await userEvent.click(within(dock()).getByRole('button', { name: 'Review proposal' }));
  await userEvent.keyboard('{Escape}');
  await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Review design change' })).toBeNull());
  await userEvent.dblClick(within(screen.getByRole('region', { name: 'Features' })).getByRole('button', { name: /^Sketch · Plate/ }));
  const canvas = await screen.findByTestId('cad-canvas');
  expect(screen.queryByRole('complementary', { name: 'Design assistant' })).toBeNull();
  expect(screen.queryByRole('button', { name: 'Assistant' })).toBeNull();
  const width = source.parts[0]!.sketch.constraints.find(constraint => constraint.label === 'Width')!;
  await userEvent.dblClick(canvas.querySelector(`[data-dimension="${width.id}"]`)!);
  const value = await screen.findByRole('textbox', { name: 'Width mm' });
  await userEvent.clear(value);
  await userEvent.type(value, '140{Enter}');
  await waitFor(() => expect(screen.queryByText(/^Checking sketch/)).toBeNull(), { timeout: 20_000 });
  await userEvent.click(screen.getByRole('button', { name: '✓ Finish sketch' }));
  await screen.findByRole('button', { name: 'Assistant' });
  await ready();
  expect(latest().parts[0]!.sketch.constraints.find(constraint => constraint.id === width.id)).toMatchObject({ value: 140 });
  await userEvent.click(screen.getByRole('button', { name: 'Assistant' }));
  await screen.findByRole('complementary', { name: 'Design assistant' });
  const before = structuredClone(latest()),
    history = session.past.length;
  expect(within(dock()).getByText(/The design has changed/)).toBeTruthy();
  expect(within(dock()).getByRole('status')).toHaveTextContent('Proposal out of date.');
  expect(within(dock()).getByRole('status')).not.toHaveTextContent('Checked proposal ready');
  await userEvent.click(within(dock()).getByRole('button', { name: 'Review proposal' }));
  const dialog = await review();
  expect(within(dialog).getByRole('button', { name: 'Apply as one undo step' })).toBeDisabled();
  expect(within(dialog).getByText(/The design has changed/)).toBeTruthy();
  expect(within(dialog).getByText(retainedWarning)).toBeTruthy();
  await waitFor(() => expect(vi.mocked(WorkspaceView).mock.calls.at(-1)![0].document).toBe(proposal.document));
  expect(latest()).toEqual(before);
  expect(session.past).toHaveLength(history);
  await userEvent.click(within(dialog).getByRole('button', { name: 'Discard proposal' }));
  await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Review design change' })).toBeNull());
  expect(within(dock()).queryByRole('button', { name: 'Review proposal' })).toBeNull();
  expect(readConversation(source.id).filter(message => message.proposalOutcome === 'discarded')).toHaveLength(1);
  expect(latest()).toEqual(before);
  expect(session.past).toHaveLength(history);
  expect(runDesignAssistant).toHaveBeenCalledTimes(1);
}, 60_000);
