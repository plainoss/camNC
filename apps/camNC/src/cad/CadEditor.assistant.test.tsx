import { createPlateDocument, setPartPattern, type CadDocument } from '@wbcnc/cad';
import { endCadSession } from '@wbcnc/cad-editor/session';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import { userEvent } from '@vitest/browser/context';
import { afterEach, expect, it, vi } from 'vitest';
import { CadEditor } from './CadEditor';
import { defaultProvider, rememberAssistantCredentials } from './assistant/keyStore';
import { requestAssistant, type AssistantMessage } from './assistant/provider';

vi.mock('./assistant/provider', { spy: true });
vi.mock('./WorkspaceView', () => ({
  default: ({ document }: { document: CadDocument }) => (
    <div data-testid="workspace-3d" tabIndex={0}>
      {document.name}
    </div>
  ),
}));
const ids: string[] = [];
afterEach(() => {
  cleanup();
  ids.splice(0).forEach(endCadSession);
  rememberAssistantCredentials(null);
  vi.restoreAllMocks();
});

async function studio(source = createPlateDocument()) {
  ids.push(source.id);
  const change = vi.fn<(document: CadDocument) => void>();
  render(
    <div style={{ height: 700, width: 1100, display: 'flex' }}>
      <CadEditor document={source} startIn3D onDraftChange={change} onFinish={async () => {}} onCancel={() => {}} />
    </div>
  );
  await waitFor(() => expect(document.querySelector('.cad-editor')?.getAttribute('aria-busy')).toBe('false'), { timeout: 20_000 });
  return { source, latest: () => change.mock.calls.at(-1)?.[0] ?? source };
}

function recorded() {
  const replies: AssistantMessage[] = [
    { role: 'assistant', text: '', calls: [{ id: 'guide-1', name: 'cad_script_guide', arguments: {} }] },
    {
      role: 'assistant',
      text: '',
      calls: [{ id: 'check-1', name: 'check_design', arguments: { source: 'd => { d.part("Plate").thickness(24); }' } }],
    },
    { role: 'assistant', text: 'Proposal: the plate is 24 mm thick, with its original outline and IDs.' },
  ];
  vi.mocked(requestAssistant).mockImplementation(async () => replies.shift()!);
  rememberAssistantCredentials({ config: { ...defaultProvider, model: 'recorded' }, key: 'recorded-key' });
}

it('sends the selected physical copy as context rather than only its family name', async () => {
  recorded();
  const start = createPlateDocument();
  start.parts[0].name = 'Shelf';
  const source = setPartPattern(start, start.parts[0].id, { axis: 'z', count: 3, spacing: 100 });
  const copyId = source.parts[0].copies![0].id;
  vi.mocked(requestAssistant).mockImplementation(async request => {
    expect(request.system).toContain(`"copyId":"${copyId}"`);
    expect(request.system).toContain('"name":"Shelf 2"');
    return { role: 'assistant', text: 'Question: what diameter should the hole have?' };
  });
  await studio(source);
  const parts = screen.getByRole('list', { name: 'Parts' });
  await userEvent.click(within(parts).getByRole('button', { name: /^Shelf 2/ }));
  await userEvent.click(screen.getByRole('button', { name: 'Assistant' }));
  const dock = await screen.findByRole('complementary', { name: 'Design assistant' });
  await userEvent.type(within(dock).getByRole('textbox', { name: 'Message' }), 'Cut a hole in this shelf.');
  await userEvent.click(within(dock).getByRole('button', { name: 'Send' }));
  await within(dock).findByText('Question: what diameter should the hole have?', {}, { timeout: 20_000 });
  expect(requestAssistant).toHaveBeenCalledTimes(1);
}, 30_000);

it('checks a recorded model proposal, previews it, applies it once and undoes through the studio', async () => {
  recorded();
  const { source, latest } = await studio();
  await userEvent.click(screen.getByRole('button', { name: 'Assistant' }));
  const dock = await screen.findByRole('complementary', { name: 'Design assistant' });
  await userEvent.type(within(dock).getByRole('textbox', { name: 'Message' }), 'Make the plate 24 mm thick.');
  await userEvent.click(within(dock).getByRole('button', { name: 'Send' }));
  const preview = await within(dock).findByRole('button', { name: 'Preview proposal' }, { timeout: 45_000 });
  expect(latest().parts[0]!.thickness).toBe(18);
  await userEvent.click(preview);
  const review = await screen.findByRole('dialog', { name: 'Review design change' });
  expect(within(review).getByText(/Extrude · Plate/)).toBeDefined();
  await userEvent.click(within(review).getByRole('button', { name: 'Apply as one undo step' }));
  await waitFor(() => expect(latest().parts[0]!.thickness).toBe(24));
  expect(latest().parts[0]!.id).toBe(source.parts[0]!.id);
  await userEvent.click(within(screen.getByRole('toolbar', { name: 'Part Studio toolbar' })).getByRole('button', { name: /Undo/ }));
  await waitFor(() => expect(latest().parts[0]!.thickness).toBe(18));
}, 60_000);

it('makes a model result stale when the user edits while the provider works', async () => {
  recorded();
  let release: ((message: AssistantMessage) => void) | undefined;
  vi.mocked(requestAssistant).mockImplementationOnce(
    () =>
      new Promise(resolve => {
        release = resolve;
      })
  );
  const { latest } = await studio();
  await userEvent.click(screen.getByRole('button', { name: 'Assistant' }));
  const dock = await screen.findByRole('complementary', { name: 'Design assistant' });
  await userEvent.type(within(dock).getByRole('textbox', { name: 'Message' }), 'Make the plate 24 mm thick.');
  await userEvent.click(within(dock).getByRole('button', { name: 'Send' }));
  await waitFor(() => expect(release).toBeDefined());
  await userEvent.dblClick(within(screen.getByRole('region', { name: 'Features' })).getByRole('button', { name: /Extrude · Plate/ }));
  const extrude = await screen.findByRole('dialog', { name: 'Extrude · Plate' });
  const thickness = within(extrude).getByRole('textbox', { name: /Thickness/ });
  await userEvent.clear(thickness);
  await userEvent.type(thickness, '30');
  await userEvent.click(within(extrude).getByRole('button', { name: 'OK' }));
  await waitFor(() => expect(latest().parts[0]!.thickness).toBe(30));
  release!({ role: 'assistant', text: '', calls: [{ id: 'read-1', name: 'cad_script_guide', arguments: {} }] });
  const preview = await within(dock).findByRole('button', { name: 'Preview proposal' }, { timeout: 45_000 });
  expect(preview).toHaveProperty('disabled', true);
  expect(within(dock).getByText(/The design has changed/)).toBeDefined();
  expect(latest().parts[0]!.thickness).toBe(30);
}, 60_000);
