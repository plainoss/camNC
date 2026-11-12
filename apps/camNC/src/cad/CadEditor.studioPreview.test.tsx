import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react';
import { userEvent } from '@vitest/browser/context';
import { createPlateDocument, resolvePartPatterns, type CadDocument } from '@wbcnc/cad';
import { endCadSession } from '@wbcnc/cad-editor/session';
import { afterEach, expect, it, vi } from 'vitest';
import { ModelViewport } from '@/cam/model/ModelViewport';
import { CadEditor } from './CadEditor';
import { settled } from '@/test/settled';
import { studioCommand } from './studioToolbarTesting';

vi.mock('@/cam/model/ModelViewport', { spy: true });
const sessions: string[] = [];
afterEach(() => {
  cleanup();
  sessions.splice(0).forEach(endCadSession);
});
const documentElement = () => window.document.querySelector('.cad-editor')!;
const viewport = () => vi.mocked(ModelViewport).mock.calls.at(-1)![0];
const extent = (index: number, axis = 0) => {
  const values = Array.from(viewport().meshes[index]!.positions).filter((_, coordinate) => coordinate % 3 === axis);
  return [Math.min(...values), Math.max(...values)];
};
function plate() {
  const document = createPlateDocument({ width: 200, height: 100, thickness: 18 });
  document.parts[0]!.drawnOn = { on: { plane: 'top' }, offset: 0 };
  return document;
}
async function studio(document = plate()) {
  sessions.push(document.id);
  const change = vi.fn<(document: CadDocument) => void>();
  render(
    <div style={{ height: 700, display: 'flex' }}>
      <CadEditor document={document} startIn3D onDraftChange={change} onFinish={async () => {}} onCancel={() => {}} />
    </div>
  );
  // The viewport is loaded lazily, which the settled signal can't see before its module arrives: wait for its props.
  await waitFor(() => expect(viewport().instanceIds).toContain(document.parts[0]!.id), { timeout: 20_000 });
  // Then the opening solver, which can publish normalized placements after the viewport renders.
  await settled();
  expect(documentElement().getAttribute('aria-busy')).toBe('false');
  expect(screen.queryByText(/^Checking sketch/)).toBeNull();
  const latest = () => change.mock.calls.at(-1)?.[0] ?? document;
  return { document, change, latest };
}
async function transform() {
  await userEvent.click(await studioCommand(/Transform/));
  return screen.findByRole('dialog', { name: /^Transform/ });
}
async function typeX(dialog: HTMLElement, value: string) {
  const field = within(dialog).getByRole('textbox', { name: 'X' });
  await userEvent.clear(field);
  await userEvent.type(field, value);
  expect(document.activeElement).toBe(field);
}

it('previews XYZ geometry while the field retains focus, cancels cleanly, and accepts one undoable change', async () => {
  const { change, latest } = await studio();
  expect(extent(0)).toEqual([0, 200]);
  let dialog = await transform();
  change.mockClear();
  await typeX(dialog, '25');
  await settled();
  expect(extent(0)).toEqual([25, 225]);
  expect(change).not.toHaveBeenCalled();
  await userEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
  await settled();
  expect(extent(0)).toEqual([0, 200]);
  expect(change).not.toHaveBeenCalled();
  dialog = await transform();
  await typeX(dialog, '35');
  await settled();
  expect(extent(0)).toEqual([35, 235]);
  await typeX(dialog, '60');
  await settled();
  expect(extent(0)).toEqual([60, 260]);
  expect(change).not.toHaveBeenCalled();
  await userEvent.click(within(dialog).getByRole('button', { name: 'OK' }));
  await settled();
  expect(latest().parts[0]!.moved).toEqual({ by: [60, 0, 0] });
  await userEvent.click(screen.getByRole('button', { name: /^Undo/ }));
  await settled();
  expect(extent(0)).toEqual([0, 200]);
  expect(latest().parts[0]!.moved).toBeUndefined();
});

it('previews edits to one existing transformed copy without accumulating copies or publishing drafts', async () => {
  const source = plate();
  source.parts[0]!.copies = [{ id: 'shifted', name: 'Shifted', offset: { position: [50, 0, 0], rotation: [0, 0, 0, 1] } }];
  const { change } = await studio(resolvePartPatterns(source));
  expect(viewport().meshes).toHaveLength(2);
  const features = screen.getByRole('region', { name: 'Features' });
  await userEvent.dblClick(within(features).getByRole('button', { name: /Transform · / }));
  const dialog = await screen.findByRole('dialog', { name: /^Transform/ });
  change.mockClear();
  const copyIndex = () => viewport().instanceIds!.findIndex(id => id.endsWith('/shifted'));
  await settled();
  expect(copyIndex()).toBeGreaterThanOrEqual(0);
  await typeX(dialog, '70');
  await settled();
  expect(extent(copyIndex())).toEqual([70, 270]);
  await typeX(dialog, '90');
  await settled();
  expect(extent(copyIndex())).toEqual([90, 290]);
  expect(viewport().meshes).toHaveLength(2);
  expect(change).not.toHaveBeenCalled();
  await userEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
  await settled();
  expect(extent(copyIndex())).toEqual([50, 250]);
  expect(change).not.toHaveBeenCalled();
});

it.each([false, true])(
  'picks the original connector in a patterned family and previews its copied mate (same-part destination: %s)',
  async samePart => {
    let source = plate();
    const original = source.parts[0]!;
    original.pattern = { id: 'repeat', axis: 'z', count: 3, spacing: 300 };
    const target = plate().parts[0]!;
    target.id = 'target';
    target.name = 'Target';
    target.drawnOn = { on: { plane: 'top' }, offset: 0 };
    target.moved = { by: [500, 0, 0] };
    source.parts.push(target);
    source = resolvePartPatterns(source);
    const { change } = await studio(source);
    const originalIds = new Set(viewport().instanceIds);
    const destination = samePart ? original.id : 'target';
    const destinationPoint: [number, number, number] = samePart ? [200, 100, 18] : [500, 0, 18];
    const dialog = await transform();
    await userEvent.click(within(dialog).getByRole('checkbox', { name: 'Copy part' }));
    await userEvent.selectOptions(within(dialog).getByRole('combobox', { name: 'Transform type' }), 'mate');
    change.mockClear();
    const pick = (partId: string, point: [number, number, number], normal: [number, number, number]) => {
      const props = viewport(),
        index = props.instanceIds!.indexOf(partId);
      expect(index).toBeGreaterThanOrEqual(0);
      act(() => props.onSelect!(partId, index, { partId, index, point, normal }));
    };
    // Entering mate mode already activates the original connector. Selecting it activates the destination.
    pick(original.id, [200, 100, 0], [0, 0, -1]);
    await settled();
    expect(within(dialog).getByRole('button', { name: 'Mate connector' }).textContent).toMatch(/Plate at 200, 100, 0/);
    expect(within(dialog).getByRole('button', { name: 'Mate connector to move to' }).hasAttribute('data-active')).toBe(true);
    expect(viewport().connectors).toEqual([
      expect.objectContaining({ label: 'Source mate connector', point: [200, 100, 0], normal: [0, 0, -1] }),
    ]);
    pick(destination, destinationPoint, [0, 0, 1]);
    await settled();
    expect(viewport().meshes).toHaveLength(5);
    expect(viewport().connectors).toEqual([
      expect.objectContaining({ label: 'Source mate connector', point: [200, 100, 0] }),
      expect.objectContaining({ label: 'Destination mate connector', point: destinationPoint }),
    ]);
    const copied = viewport().instanceIds!.findIndex(id => !originalIds.has(id));
    expect(copied).toBeGreaterThanOrEqual(0);
    expect(extent(copied)).toEqual(samePart ? [0, 200] : [300, 500]);
    expect(extent(copied, 1)).toEqual(samePart ? [0, 100] : [-100, 0]);
    expect(extent(copied, 2)).toEqual([18, 36]);
    expect(change).not.toHaveBeenCalled();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    await settled();
    expect(viewport().meshes).toHaveLength(4);
    expect(viewport().connectors).toEqual([]);
    expect(change).not.toHaveBeenCalled();
  }
);
