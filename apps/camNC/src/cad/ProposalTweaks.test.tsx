import { createPlateDocument } from '@wbcnc/cad';
import { cadProposal } from '@wbcnc/cad-editor/proposal';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { userEvent } from '@vitest/browser/context';
import { afterEach, expect, it, vi } from 'vitest';
import { ProposalTweaks } from './ProposalTweaks';
import { bindProposalOrigin, recheckAssistantCandidate } from './assistant/recheck';

vi.mock('./assistant/recheck', async original => ({
  ...(await original<typeof import('./assistant/recheck')>()),
  recheckAssistantCandidate: vi.fn(),
}));
afterEach(() => {
  cleanup();
  vi.mocked(recheckAssistantCandidate).mockReset();
});

const parameters = { width: 600, height: 720, depth: 300, board: 18, shelves: 3, folderName: 'Cupboard', at: [0, 0, 0] };

it('re-checks a recipe with a slider value and hands the new proposal over', async () => {
  const base = createPlateDocument();
  const proposal = cadProposal(base, { ...base, name: 'Candidate' });
  bindProposalOrigin(proposal, { source: 'recipe source', recipe: { name: 'cupboard', parameters } });
  const next = cadProposal(base, { ...base, name: 'Wider' });
  vi.mocked(recheckAssistantCandidate).mockResolvedValue(next);
  const onReplace = vi.fn();
  render(<ProposalTweaks proposal={proposal} currentDocument={base} stale={false} onReplace={onReplace} />);
  expect(screen.queryByRole('button', { name: 'Re-check on current design' })).toBeNull();
  fireEvent.change(screen.getByRole('slider', { name: /Width/ }), { target: { value: '700' } });
  await waitFor(() => expect(onReplace).toHaveBeenCalledWith(next));
  expect(vi.mocked(recheckAssistantCandidate).mock.calls[0]![3]).toMatchObject({ width: 700, shelves: 3, folderName: 'Cupboard' });
  expect(screen.getByRole('status').textContent).toContain('no model request');
});

it('offers a re-check on the current design for a stale script proposal and reports a failure', async () => {
  const base = createPlateDocument();
  const current = { ...base, name: 'Edited' };
  const proposal = cadProposal(base, { ...base, name: 'Candidate' });
  bindProposalOrigin(proposal, { source: 'd => {}' });
  vi.mocked(recheckAssistantCandidate).mockRejectedValue(new Error('Plate is gone.'));
  const onReplace = vi.fn();
  render(<ProposalTweaks proposal={proposal} currentDocument={current} stale onReplace={onReplace} />);
  await userEvent.click(screen.getByRole('button', { name: 'Re-check on current design' }));
  expect((await screen.findByText('Plate is gone.')).textContent).toBeTruthy();
  expect(vi.mocked(recheckAssistantCandidate).mock.calls[0]![0]).toEqual(current);
  expect(onReplace).not.toHaveBeenCalled();
});

it('reports busy from the slider move until the re-check ends, and puts a refused value back', async () => {
  const base = createPlateDocument();
  const proposal = cadProposal(base, { ...base, name: 'Candidate' });
  bindProposalOrigin(proposal, { source: 'recipe source', recipe: { name: 'cupboard', parameters } });
  let refuse!: (error: Error) => void;
  vi.mocked(recheckAssistantCandidate).mockReturnValue(new Promise((_, reject) => (refuse = reject)));
  const onBusy = vi.fn();
  render(<ProposalTweaks proposal={proposal} currentDocument={base} stale={false} onReplace={vi.fn()} onBusy={onBusy} />);
  const width = screen.getByRole('slider', { name: /Width/ });
  fireEvent.change(width, { target: { value: '800' } });
  expect(onBusy).toHaveBeenLastCalledWith(true);
  await waitFor(() => expect(recheckAssistantCandidate).toHaveBeenCalled());
  refuse(new Error('Width 800 mm breaks the brief.'));
  await screen.findByText('Width 800 mm breaks the brief.');
  expect(onBusy).toHaveBeenLastCalledWith(false);
  expect(width).toHaveProperty('value', '600');
});
