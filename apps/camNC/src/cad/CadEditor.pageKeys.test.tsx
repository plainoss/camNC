import { createPlateDocument, type CadDocument } from '@wbcnc/cad';
import { inspectCadDocument } from '@wbcnc/cad-script';
import { cadProposal } from '@wbcnc/cad-editor/proposal';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { userEvent } from '@vitest/browser/context';
import { afterEach, expect, it, vi } from 'vitest';
import { CadEditor } from './CadEditor';
import { endCadSession } from '@wbcnc/cad-editor/session';
import { ModelViewport } from '@/cam/model/ModelViewport';
import { runDesignAssistant } from './assistant/loop';
import { createAssistantUsage } from './assistant/runBudget';
import { defaultProvider, rememberAssistantCredentials } from './assistant/keyStore';

vi.mock('@/cam/model/ModelViewport', { spy: true });
vi.mock('./assistant/loop', { spy: true });

// Shortcuts must work while focus is on the page itself: after a load, and after the focused control unmounts.
const sessions: string[] = [];
afterEach(() => {
  cleanup();
  sessions.splice(0).forEach(endCadSession);
  rememberAssistantCredentials(null);
  vi.mocked(runDesignAssistant).mockReset();
});
const editorRoot = () => document.querySelector<HTMLElement>('.cad-editor')!;
const settled = () => waitFor(() => expect(editorRoot().getAttribute('aria-busy')).toBe('false'), { timeout: 20_000 });
const props = () => vi.mocked(ModelViewport).mock.calls.at(-1)![0];
const toolbar = () => screen.getByRole('toolbar', { name: 'Part Studio toolbar' });
const features = () => screen.getByRole('region', { name: 'Features' });
/** Where the browser leaves focus after a load. */
const focusPage = () => {
  (document.activeElement as HTMLElement | null)?.blur();
  expect(document.activeElement).toBe(document.body);
};
/** The action took the focused control away, and the editor didn't get focus back. */
const focusLeftEditor = () => waitFor(() => expect(editorRoot().contains(document.activeElement)).toBe(false));

async function studio(source = createPlateDocument({ width: 100, height: 60 }), modal = false) {
  sessions.push(source.id);
  const change = vi.fn<(document: CadDocument) => void>();
  render(
    <div style={{ height: 700, width: 1100, display: 'flex' }}>
      <input aria-label="Outside field" />
      {modal && (
        <div role="dialog" aria-modal="true" aria-label="Outside modal">
          Modal
        </div>
      )}
      <CadEditor document={source} startIn3D onDraftChange={change} onFinish={vi.fn()} onCancel={() => {}} />
    </div>
  );
  await settled();
  await screen.findByTestId('workspace-3d', undefined, { timeout: 10_000 });
  await waitFor(() => expect(props().planes).toHaveLength(3));
  return { source, latest: () => change.mock.calls.at(-1)?.[0] ?? source };
}

/** Removes the extrude and then the sketch, which takes the part with it: two undo steps. */
async function deleteBoth(latest: () => CadDocument) {
  within(features())
    .getByRole('button', { name: /Extrude · Plate/ })
    .focus();
  await userEvent.keyboard('{Delete}');
  await waitFor(() => expect(latest().parts[0]?.extrude).toBe(false));
  within(features())
    .getByRole('button', { name: /Sketch · Plate/ })
    .focus();
  await userEvent.keyboard('{Delete}');
  await waitFor(() => expect(latest().parts).toHaveLength(0));
}

async function openFillet(source: CadDocument) {
  await userEvent.click(within(toolbar()).getByRole('button', { name: /^Fillet/ }));
  const dialog = await screen.findByRole('dialog', { name: 'Fillet' });
  const a: [number, number, number] = [100, 60, 0];
  const b: [number, number, number] = [100, 60, 18];
  act(() => props().onSelect!(source.parts[0]!.id, 0, { point: a, normal: [1, 0, 0], edge: { a, b } } as never));
  await waitFor(() => expect(within(dialog).getByText(/1 edge of Plate/)).toBeDefined());
  return dialog;
}
const placedPlate = () => {
  const source = createPlateDocument({ width: 100, height: 60 });
  source.parts[0]!.placement = { position: [0, 0, 0], rotation: [0, 0, 0, 1] };
  return source;
};

it('takes studio shortcuts, undo and redo after the page loads with focus on the page', async () => {
  const { latest } = await studio();
  focusPage();
  await userEvent.keyboard('p');
  await waitFor(() => expect(props().planes).toBeUndefined());
  await userEvent.keyboard('p');
  await waitFor(() => expect(props().planes).toHaveLength(3));
  await deleteBoth(latest);
  focusPage();
  await userEvent.keyboard('{Control>}z{/Control}');
  await waitFor(() => expect(latest().parts[0]?.extrude).toBe(false));
  await userEvent.keyboard('{Control>}{Shift>}z{/Shift}{/Control}');
  await waitFor(() => expect(latest().parts).toHaveLength(0));
  await userEvent.keyboard('{Control>}z{/Control}');
  await waitFor(() => expect(latest().parts[0]?.extrude).toBe(false));
  focusPage();
  await userEvent.keyboard('{Shift>}S{/Shift}');
  expect(await screen.findByRole('dialog', { name: /^Sketch/ })).toBeDefined();
}, 60_000);

it('takes redo once the toolbar Undo button has disabled itself', async () => {
  const { latest } = await studio();
  await deleteBoth(latest);
  const undo = within(toolbar()).getByRole('button', { name: /^Undo/ });
  await userEvent.click(undo);
  await waitFor(() => expect(latest().parts[0]?.extrude).toBe(false));
  await userEvent.click(undo);
  await waitFor(() => expect(latest().parts[0]?.extrude).toBeUndefined());
  await waitFor(() => expect(undo).toBeDisabled());
  await focusLeftEditor();
  await userEvent.keyboard('{Control>}{Shift>}z{/Shift}{/Control}');
  await waitFor(() => expect(latest().parts[0]?.extrude).toBe(false));
}, 60_000);

it("takes undo and redo after a dialog's OK", async () => {
  const source = placedPlate();
  const { latest } = await studio(source);
  const dialog = await openFillet(source);
  await userEvent.click(within(dialog).getByRole('button', { name: 'OK' }));
  await waitFor(() => expect(latest().parts[0]!.fillets).toHaveLength(1));
  await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Fillet' })).toBeNull());
  await settled();
  await focusLeftEditor();
  await userEvent.keyboard('{Control>}z{/Control}');
  await waitFor(() => expect(latest().parts[0]!.fillets ?? []).toHaveLength(0));
  await userEvent.keyboard('{Control>}y{/Control}');
  await waitFor(() => expect(latest().parts[0]!.fillets).toHaveLength(1));
}, 60_000);

it('cancels an open step dialog with Escape while focus is on the page', async () => {
  const source = placedPlate();
  const { latest } = await studio(source);
  await openFillet(source);
  focusPage();
  await userEvent.keyboard('{Escape}');
  await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Fillet' })).toBeNull());
  expect(latest().parts[0]!.fillets ?? []).toHaveLength(0);
}, 60_000);

it("takes undo after a proposal review's Apply", async () => {
  vi.mocked(runDesignAssistant).mockImplementation(async options => {
    const candidate = structuredClone(options.base);
    candidate.parts[0]!.thickness = 24;
    const checked = await inspectCadDocument(candidate);
    const proposal = cadProposal(options.base, checked.document);
    return { status: 'proposal', proposal, messages: [], checks: 1, usage: createAssistantUsage() };
  });
  rememberAssistantCredentials({ config: { ...defaultProvider, model: 'recorded' }, key: 'recorded-key' });
  const { latest } = await studio(createPlateDocument());
  await userEvent.click(screen.getByRole('button', { name: 'Assistant' }));
  const dock = await screen.findByRole('complementary', { name: 'Design assistant' }, { timeout: 20_000 });
  await userEvent.type(within(dock).getByRole('textbox', { name: 'Message' }), 'Make the plate 24 mm thick.');
  await userEvent.click(within(dock).getByRole('button', { name: 'Send' }));
  await userEvent.click(await screen.findByRole('button', { name: /(?:Preview|Review) proposal/ }, { timeout: 30_000 }));
  const review = await screen.findByRole('dialog', { name: 'Review design change' });
  await userEvent.click(within(review).getByRole('button', { name: 'Apply as one undo step' }));
  await waitFor(() => expect(latest().parts[0]!.thickness).toBe(24));
  await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Review design change' })).toBeNull());
  await focusLeftEditor();
  await userEvent.keyboard('{Control>}z{/Control}');
  await waitFor(() => expect(latest().parts[0]!.thickness).toBe(18));
}, 60_000);

// Each negative case ends with one P that should work: planes end up hidden only if the guarded one was ignored.
it('leaves keys typed in a text field outside the editor to that field', async () => {
  await studio();
  const field = screen.getByRole('textbox', { name: 'Outside field' });
  await userEvent.click(field);
  await userEvent.keyboard('p');
  expect((field as HTMLInputElement).value).toBe('p');
  focusPage();
  await userEvent.keyboard('p');
  await waitFor(() => expect(props().planes).toBeUndefined());
});

it('leaves keys to an open menu, even once focus has fallen to the page', async () => {
  await studio();
  fireEvent.contextMenu(within(features()).getByRole('button', { name: /Extrude · Plate/ }));
  const menu = await screen.findByRole('menu');
  expect(menu.contains(document.activeElement)).toBe(true);
  await userEvent.keyboard('p');
  focusPage();
  await userEvent.keyboard('p');
  within(menu).getAllByRole('menuitem')[0]!.focus();
  await userEvent.keyboard('{Escape}');
  await waitFor(() => expect(screen.queryByRole('menu')).toBeNull());
  focusPage();
  await userEvent.keyboard('p');
  await waitFor(() => expect(props().planes).toBeUndefined());
});

it('leaves keys to a modal dialog outside the editor', async () => {
  await studio(undefined, true);
  focusPage();
  await userEvent.keyboard('p');
  screen.getByRole('dialog', { name: 'Outside modal' }).hidden = true;
  await userEvent.keyboard('p');
  await waitFor(() => expect(props().planes).toBeUndefined());
});

it('takes sketch shortcuts in a sketch editor while focus is on the page', async () => {
  const source = createPlateDocument({ width: 100, height: 60 });
  sessions.push(source.id);
  render(
    <div style={{ height: 700 }}>
      <CadEditor document={source} onDraftChange={() => {}} onFinish={() => {}} onCancel={() => {}} />
    </div>
  );
  await settled();
  focusPage();
  await userEvent.keyboard('l');
  await waitFor(() => expect(screen.getByRole('button', { name: 'Line (L)' })).toHaveAttribute('aria-pressed', 'true'));
});
