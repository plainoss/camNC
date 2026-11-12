import { createPlateDocument } from '@wbcnc/cad';
import { cadProposal } from '@wbcnc/cad-editor/proposal';
import { cadSession, commitCadSession, endCadSession, undoCadSession } from '@wbcnc/cad-editor/session';
import { render } from 'vitest-browser-react';
import { describe, expect, it, vi } from 'vitest';
import { ProposalReview } from './ProposalReview';
import { bindProposalOrigin } from './assistant/recheck';

vi.mock('./assistant/recheck', async original => ({
  ...(await original<typeof import('./assistant/recheck')>()),
  recheckAssistantCandidate: vi.fn(() => new Promise(() => {})),
}));
const views = vi.hoisted(() => [] as { viewRequest?: { name: string; direction?: number[] } }[]);
vi.mock('./WorkspaceView', () => ({
  default: (props: { document: { name: string }; viewRequest?: { name: string; direction?: number[] } }) => {
    views.push(props);
    return <div>{props.document.name}</div>;
  },
}));

describe('proposal preview', () => {
  it('shows the candidate and original, then applies exactly once and can undo', async () => {
    const base = createPlateDocument({ name: 'Original' });
    const session = cadSession(base);
    const proposal = cadProposal(base, { ...base, name: 'Candidate' });
    const onApply = vi.fn(),
      onClose = vi.fn();
    const screen = render(
      <ProposalReview proposal={proposal} session={session} currentDocument={base} onApply={onApply} onClose={onClose} />
    );
    await expect.element(screen.getByText('Candidate', { exact: true })).toBeVisible();
    await screen.getByRole('radio', { name: 'Before' }).click();
    await expect.element(screen.getByText('Original', { exact: true })).toBeVisible();
    await screen.getByRole('button', { name: 'Apply as one undo step' }).click();
    expect(onApply).toHaveBeenCalledTimes(1);
    expect(session.past).toHaveLength(1);
    expect(undoCadSession(session).name).toBe('Original');
    endCadSession(base.id);
  });

  it('discarding a preview leaves no trace in the source or history', async () => {
    const base = createPlateDocument();
    const session = cadSession(base);
    const onApply = vi.fn();
    const screen = render(
      <ProposalReview
        proposal={cadProposal(base, { ...base, name: 'Candidate' })}
        session={session}
        currentDocument={base}
        onApply={onApply}
        onClose={() => {}}
      />
    );
    await screen.getByRole('button', { name: 'Discard', exact: true }).click();
    expect(onApply).not.toHaveBeenCalled();
    expect(session.past).toHaveLength(0);
    expect(session.document).toEqual(base);
    endCadSession(base.id);
  });

  it('disables Apply after the editor publishes an intervening change', async () => {
    const base = createPlateDocument();
    const session = cadSession(base);
    const proposal = cadProposal(base, { ...base, name: 'Candidate' });
    commitCadSession(session, { ...base, name: 'Hand edit' });
    const screen = render(
      <ProposalReview proposal={proposal} session={session} currentDocument={session.document} onApply={() => {}} onClose={() => {}} />
    );
    await expect.element(screen.getByRole('button', { name: 'Apply as one undo step' })).toBeDisabled();
    await expect.element(screen.getByText(/The design has changed/)).toBeVisible();
    expect(session.document.name).toBe('Hand edit');
    endCadSession(base.id);
  });

  it('keeps Apply disabled while a slider re-check is running', async () => {
    const base = createPlateDocument();
    const session = cadSession(base);
    const proposal = cadProposal(base, { ...base, name: 'Candidate' });
    const parameters = { width: 600, height: 720, depth: 300, board: 18, shelves: 3, folderName: 'Cupboard', at: [0, 0, 0] };
    bindProposalOrigin(proposal, { source: 'recipe', recipe: { name: 'cupboard', parameters } });
    const screen = render(
      <ProposalReview
        proposal={proposal}
        session={session}
        currentDocument={base}
        onApply={() => {}}
        onClose={() => {}}
        onReplace={() => {}}
      />
    );
    const apply = screen.getByRole('button', { name: 'Apply as one undo step' });
    await expect.element(apply).toBeEnabled();
    const width = screen.getByRole('slider', { name: /Width/ }).element() as HTMLInputElement;
    const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
    set.call(width, '700');
    width.dispatchEvent(new Event('input', { bubbles: true }));
    await expect.element(apply).toBeDisabled();
    endCadSession(base.id);
  });

  it('frames the whole proposal with an exact fit rather than the quick default', async () => {
    const base = createPlateDocument();
    const session = cadSession(base);
    const screen = render(
      <ProposalReview
        proposal={cadProposal(base, { ...base, name: 'Candidate' })}
        session={session}
        currentDocument={base}
        onApply={() => {}}
        onClose={() => {}}
      />
    );
    await expect.element(screen.getByText('Candidate', { exact: true })).toBeVisible();
    expect(views.at(-1)?.viewRequest).toMatchObject({ name: 'iso', direction: [0.77, -1, 0.17] });
    endCadSession(base.id);
  });
});
