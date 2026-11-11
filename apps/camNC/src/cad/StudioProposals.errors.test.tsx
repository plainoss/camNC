import { createCadDocument, createCadPart, createPlateDocument, type CadDocument } from '@wbcnc/cad';
import { cadSession, endCadSession } from '@wbcnc/cad-editor/session';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { userEvent } from '@vitest/browser/context';
import { afterEach, expect, it, vi } from 'vitest';
import { StudioProposals } from './StudioProposals';
import { useAssistantProposal } from './assistant/useAssistantProposal';

vi.mock('./WorkspaceView', () => ({ default: () => <output aria-label="Preview" /> }));

const ids: string[] = [];
afterEach(() => {
  cleanup();
  ids.splice(0).forEach(endCadSession);
});

function setup(source: CadDocument = createPlateDocument({ width: 120, height: 80 })) {
  ids.push(source.id);
  const session = cadSession(source);
  const Component = () => {
    const checkedProposal = useAssistantProposal(session.document);
    return (
      // A narrow editor puts the banner right under the Insert menu, as in a docked toolbar.
      <div className="cad-editor" style={{ position: 'relative', width: 320, height: 400 }}>
        <StudioProposals checkedProposal={checkedProposal} document={session.document} session={session} onApply={() => {}} />
      </div>
    );
  };
  const view = render(<Component />);
  const input = view.container.querySelector<HTMLInputElement>('input[type="file"]')!;
  const upload = (candidate: CadDocument) =>
    fireEvent.change(input, { target: { files: [new File([JSON.stringify(candidate)], 'candidate.json', { type: 'application/json' })] } });
  return { source, upload, input };
}

it('explains a file from another design and can be dismissed with its button or Escape', async () => {
  const { upload } = setup();
  upload(createPlateDocument());
  const banner = await screen.findByRole('alert', {}, { timeout: 20_000 });
  expect(banner.textContent).toContain('This file is a different design. Open it from Projects › Open model… instead.');
  await userEvent.click(screen.getByRole('button', { name: 'Dismiss message' }));
  expect(screen.queryByRole('alert')).toBeNull();
  upload(createPlateDocument());
  await screen.findByRole('alert', {}, { timeout: 20_000 });
  await userEvent.keyboard('{Escape}');
  expect(screen.queryByRole('alert')).toBeNull();
}, 30_000);

it('keeps the open Insert menu above the error banner and clickable', async () => {
  const { upload, input } = setup();
  upload(createPlateDocument());
  const banner = await screen.findByRole('alert', {}, { timeout: 20_000 });
  await userEvent.click(screen.getByText('Insert'));
  for (const name of ['Cupboard…', 'Review design file…']) {
    const item = screen.getByRole('button', { name });
    const box = item.getBoundingClientRect();
    const bannerBox = banner.getBoundingClientRect();
    // Without the overlap this test would pass for the wrong reason.
    expect(box.bottom > bannerBox.top && box.top < bannerBox.bottom).toBe(true);
    expect(document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2)).toBe(item);
  }
  const chooser = vi.fn();
  input.addEventListener('click', event => {
    event.preventDefault();
    chooser();
  });
  await userEvent.click(screen.getByRole('button', { name: 'Review design file…' }));
  expect(chooser).toHaveBeenCalledTimes(1);
  // Starting another action clears the old message.
  expect(screen.queryByRole('alert')).toBeNull();
}, 30_000);

it('says nothing would change for a file identical to the open design, without a review', async () => {
  const { source, upload } = setup();
  upload(structuredClone(source));
  const banner = await screen.findByRole('alert', {}, { timeout: 20_000 });
  expect(banner.textContent).toContain('This file matches the open design. Reviewing it would change nothing.');
  expect(screen.queryByRole('dialog', { name: 'Review design change' })).toBeNull();
  expect(screen.queryByRole('button', { name: 'Apply as one undo step' })).toBeNull();
}, 30_000);

it('says nothing would change for an untouched new design instead of asking for a profile', async () => {
  const fresh = { ...createCadDocument(), parts: [createCadPart()] };
  const { upload } = setup(fresh);
  upload(structuredClone(fresh));
  const banner = await screen.findByRole('alert', {}, { timeout: 20_000 });
  expect(banner.textContent).toContain('Reviewing it would change nothing.');
  expect(banner.textContent).not.toContain('closed profile');
  await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Review design change' })).toBeNull());
}, 30_000);
