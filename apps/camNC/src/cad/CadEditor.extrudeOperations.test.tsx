import { parseCadDocument, evaluateCadDocument, cadPartsToCut, type CadDocument } from '@wbcnc/cad';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import { userEvent } from '@vitest/browser/context';
import { afterEach, expect, it, vi } from 'vitest';
import saved from '../../../../packages/cad-script/fixtures/designs/extrude-operation-history.json';
import { CadEditor } from './CadEditor';
import { assemblyModel } from './assemblyModel';
import { endCadSession } from '@wbcnc/cad-editor/session';

const sessions: string[] = [];
afterEach(() => {
  cleanup();
  sessions.splice(0).forEach(endCadSession);
});
async function studio(withLaterCut = true) {
  const source = parseCadDocument(structuredClone(saved));
  if (!withLaterCut) delete source.partCuts;
  sessions.push(source.id);
  const change = vi.fn<(document: CadDocument) => void>();
  render(
    <div style={{ height: 700, display: 'flex' }}>
      <CadEditor document={source} startIn3D onDraftChange={change} onFinish={async () => {}} onCancel={() => {}} />
    </div>
  );
  await settled();
  const features = await screen.findByRole('region', { name: 'Features' });
  await userEvent.dblClick(within(features).getByRole('button', { name: /Extrude · Part 3/ }));
  const dialog = await screen.findByRole('dialog', { name: 'Extrude · Part 3' });
  return { source, latest: () => change.mock.calls.at(-1)?.[0] ?? source, dialog, features };
}
const settled = () =>
  waitFor(() => expect(document.querySelector('.cad-editor')!.getAttribute('aria-busy')).toBe('false'), { timeout: 20_000 });
const field = (dialog: HTMLElement, name: string) => within(dialog).getByRole('textbox', { name: new RegExp(name) });
async function typeField(dialog: HTMLElement, name: string, text: string) {
  const input = field(dialog, name);
  await userEvent.clear(input);
  await userEvent.type(input, text);
  await userEvent.tab();
  await settled();
}

it('changes an earlier New to Add with its later cut intact and editable extent controls', async () => {
  const { source, latest, dialog, features } = await studio();
  await userEvent.click(within(dialog).getByRole('tab', { name: 'Add' }));
  await waitFor(() => expect(latest().parts[1]!.addTo).toBe(source.parts[0]!.id));
  expect(latest().partCuts).toEqual(source.partCuts);
  await userEvent.click(within(dialog).getByRole('tab', { name: 'Remove' }));
  expect(within(dialog).getByRole('alert').textContent).toMatch(/stays a part/);
  expect(latest().parts[1]!.addTo).toBe(source.parts[0]!.id);
  await userEvent.click(within(dialog).getByRole('tab', { name: 'Add' }));
  expect(within(dialog).queryByRole('alert')).toBeNull();
  expect(within(dialog).getByRole('combobox', { name: 'End type' })).toBeDefined();
  expect(within(dialog).getByRole('checkbox', { name: 'Symmetric' })).toBeDefined();
  expect(within(dialog).getByRole('button', { name: 'Flip direction' })).toBeDefined();
  await typeField(dialog, 'Thickness', '30');
  expect(latest().parts[1]!.thickness).toBe(30);
  await typeField(dialog, 'Offset', '-200');
  expect(latest().parts[1]!.drawnOn!.offset).toBe(-200);
  await userEvent.click(within(dialog).getByRole('button', { name: 'OK' }));
  await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Extrude · Part 3' })).toBeNull());
  expect(within(features).getByRole('button', { name: /Extrude · Part 3/ }).textContent).toMatch(/add to Part 2/);
  expect(latest().partCuts).toEqual(source.partCuts);
});

it('removes from a default plane, edits its depth and offset, and restores the original on Cancel', async () => {
  const { source, latest, dialog } = await studio(false);
  await userEvent.click(within(dialog).getByRole('tab', { name: 'Remove' }));
  await waitFor(() => expect(latest().parts[1]!.remove).toBeDefined());
  expect(within(dialog).queryByRole('alert')).toBeNull();
  expect(within(dialog).getByRole('listbox', { name: 'Parts to cut' })).toBeDefined();
  expect(within(dialog).getByRole('checkbox', { name: 'Symmetric' })).toBeDefined();
  expect(within(dialog).getByRole('button', { name: 'Flip direction' })).toBeDefined();
  await typeField(dialog, 'Cut depth', '25');
  expect(latest().parts[1]!.remove!.depth).toBe(25);
  await typeField(dialog, 'Offset', '-203');
  expect(latest().parts[1]!.drawnOn!.offset).toBe(-203);
  const evaluated = evaluateCadDocument(latest());
  expect(evaluated.diagnostics.filter(problem => problem.severity === 'error')).toEqual([]);
  expect(evaluated.parts[0]!.cuts).toHaveLength(1);
  expect(cadPartsToCut(latest(), evaluated.parts)).toHaveLength(1);
  const model = assemblyModel(latest());
  expect(model.problems).toEqual([]);
  expect(model.meshes).toHaveLength(1);
  const z = Array.from(model.meshes[0]!.positions).filter((_, i) => i % 3 === 2);
  expect(Math.min(...z)).toBeCloseTo(-178, 3);
  await userEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
  await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Extrude · Part 3' })).toBeNull());
  expect(latest().parts[1]!.remove).toBeUndefined();
  expect(latest().parts[1]!.thickness).toBe(source.parts[1]!.thickness);
  expect(latest().parts[1]!.drawnOn!.offset).toBe(-202);
});
