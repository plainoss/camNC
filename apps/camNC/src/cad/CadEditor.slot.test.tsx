import { addLine, createCadPart, createCadDocument, parseCadDocument, type CadDocument } from '@wbcnc/cad';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { CadEditor } from './CadEditor';
import { endCadSession } from '@wbcnc/cad-editor/session';
import { saveCadViewState } from '@wbcnc/cad-editor/viewState';
const sessions: string[] = [];
afterEach(() => {
  cleanup();
  sessions.forEach(endCadSession);
  sessions.length = 0;
});
const checked = () => waitFor(() => expect(screen.queryByText(/^Checking sketch/)).toBeNull(), { timeout: 20000 });
async function setup(mode: 'single' | 'chain' | 'separate' = 'single', preselect = true, saved?: CadDocument) {
  const doc = saved ?? createCadDocument();
  if (!saved) {
    const part = createCadPart();
    part.sketch = addLine(part.sketch, { x1: 20, y1: 20, x2: 70, y2: 20 });
    if (mode === 'chain') part.sketch = addLine(part.sketch, { x1: 70, y1: 20, x2: 70, y2: 60 });
    if (mode === 'separate') part.sketch = addLine(part.sketch, { x1: 20, y1: 60, x2: 70, y2: 60 });
    doc.parts = [part];
  }
  sessions.push(doc.id);
  const source = doc.parts[0]!.sketch.entities.filter(e => e.type === 'line' && !e.construction).map(e => e.id);
  saveCadViewState(doc.id, {
    selectedPartId: doc.parts[0]!.id,
    view: { x: 0, y: -100, w: 120, h: 110 },
    selectedEntityIds: preselect ? source.slice(0, 1) : [],
  });
  const change = vi.fn<(d: CadDocument) => void>();
  render(
    <div style={{ height: 700 }}>
      <CadEditor document={doc} onDraftChange={change} onFinish={() => {}} onCancel={() => {}} />
    </div>
  );
  const canvas = screen.getByTestId('cad-canvas') as unknown as SVGSVGElement;
  vi.spyOn(canvas, 'setPointerCapture').mockImplementation(() => {});
  await checked();
  return { canvas, source, doc, latest: () => change.mock.calls.at(-1)?.[0] ?? doc };
}
function choose(canvas: SVGSVGElement) {
  fireEvent.keyDown(canvas, { key: 'c', altKey: true, code: 'KeyC' });
  const input = screen.getByRole('combobox');
  fireEvent.change(input, { target: { value: 'slot' } });
  fireEvent.keyDown(input, { key: 'Enter' });
}
function pick(canvas: SVGSVGElement, id: string) {
  const target = canvas.querySelector(`[data-entity-id="${id}"]`)!;
  const b = target.getBoundingClientRect(),
    e = { pointerId: 1, button: 0, clientX: b.x + b.width / 2, clientY: b.y + b.height / 2 };
  fireEvent.pointerDown(target, e);
  fireEvent.pointerUp(canvas, e);
}
const value = (text: string) => fireEvent.change(screen.getByLabelText('Slot width'), { target: { value: text } });
it('previews and creates a diameter-controlled slot around a selected path with undo/redo', async () => {
  const { canvas, latest } = await setup();
  choose(canvas);
  value('0');
  expect(screen.getByRole('button', { name: 'Create slot' })).toBeDisabled();
  value('8');
  expect(latest().parts[0]!.sketch.constraints.some(c => c.type === 'slot')).toBe(false);
  expect(screen.getByRole('button', { name: /Finish sketch/ })).toBeDisabled();
  fireEvent.click(screen.getByRole('button', { name: 'Create slot' }));
  await checked();
  expect(latest().parts[0]!.sketch.entities.filter(e => e.type === 'arc')).toHaveLength(2);
  expect(canvas).toHaveFocus();
  expect(latest().parts[0]!.sketch.constraints.find(c => c.type === 'diameter')).toMatchObject({ value: 8 });
  fireEvent.click(screen.getByRole('button', { name: /^Undo/ }));
  await checked();
  expect(latest().parts[0]!.sketch.constraints.some(c => c.type === 'slot')).toBe(false);
  fireEvent.click(screen.getByRole('button', { name: /^Redo/ }));
  await checked();
  expect(latest().parts[0]!.sketch.constraints.some(c => c.type === 'slot')).toBe(true);
});
it('selects a connected chain and drags its width, then cancels without committing geometry', async () => {
  const { canvas, source, latest } = await setup('chain', false);
  choose(canvas);
  pick(canvas, source[0]!);
  fireEvent.click(screen.getByLabelText('Select connected slot path'));
  value('8');
  const handle = canvas.querySelector('[data-slot-width-handle]')!,
    b = handle.getBoundingClientRect(),
    unit = canvas.getScreenCTM()!.a,
    x = b.x + b.width / 2,
    y = b.y + b.height / 2;
  fireEvent.pointerDown(handle, { pointerId: 2, button: 0, clientX: x, clientY: y });
  fireEvent.pointerMove(canvas, { pointerId: 2, clientX: x + 4 * unit, clientY: y });
  fireEvent.pointerUp(canvas, { pointerId: 2 });
  expect(Number((screen.getByLabelText('Slot width') as HTMLInputElement).value)).toBeCloseTo(16, 4);
  fireEvent.click(screen.getByRole('button', { name: 'Cancel slot' }));
  expect(latest().parts[0]!.sketch.entities.filter(e => e.type === 'line')).toHaveLength(2);
  expect(screen.getByRole('button', { name: /^Undo/ })).toBeDisabled();
});
it('keeps successive paths in one shared-width group and edits the diameter after reload', async () => {
  const fixture = await setup('separate');
  choose(fixture.canvas);
  value('8');
  fireEvent.click(screen.getByRole('button', { name: 'Create slot' }));
  await checked();
  pick(fixture.canvas, fixture.source[1]!);
  value('12');
  fireEvent.keyDown(fixture.canvas, { key: 'Enter' });
  await checked();
  fireEvent.keyDown(fixture.canvas, { key: 'Escape' });
  const sketch = fixture.latest().parts[0]!.sketch,
    groups = sketch.constraints.filter(c => c.type === 'slot');
  expect(groups).toHaveLength(2);
  expect(groups[0]!.widthEntityId).toBe(groups[1]!.widthEntityId);
  expect(sketch.constraints.filter(c => c.type === 'diameter')).toHaveLength(1);
  const saved = parseCadDocument(JSON.parse(JSON.stringify(fixture.latest())));
  cleanup();
  endCadSession(saved.id);
  const reloaded = await setup('single', false, saved),
    dimension = sketch.constraints.find(c => c.type === 'diameter')!;
  fireEvent.doubleClick(reloaded.canvas.querySelector(`[data-dimension="${dimension.id}"]`)!);
  fireEvent.change(document.getElementById('cad-edit-dimension')!, { target: { value: '16' } });
  fireEvent.click(screen.getByRole('button', { name: 'Apply dimension' }));
  await checked();
  expect(reloaded.latest().parts[0]!.sketch.entities.find(e => e.id === groups[0]!.widthEntityId)).toMatchObject({ radius: 8 });
});

it('releases the slot relation contextually while retaining a closed, independently editable outline', async () => {
  const { canvas, latest } = await setup();
  choose(canvas);
  fireEvent.click(screen.getByRole('button', { name: 'Create slot' }));
  await checked();
  fireEvent.keyDown(canvas, { key: 'Escape' });
  const group = latest().parts[0]!.sketch.constraints.find(c => c.type === 'slot')!;
  if (group.type !== 'slot') throw new Error('missing slot');
  const glyph = canvas.querySelector(`[data-constraint-id="${group.id}"]`)!;
  fireEvent.pointerDown(glyph, { button: 2, pointerId: 4, clientX: 500, clientY: 300 });
  fireEvent.pointerUp(canvas, { button: 2, pointerId: 4, clientX: 500, clientY: 300 });
  fireEvent.click(screen.getByRole('menuitem', { name: 'Remove slot relation' }));
  await checked();
  expect(latest().parts[0]!.sketch.constraints.some(c => c.type === 'slot')).toBe(false);
  expect(latest().parts[0]!.sketch.entities.some(e => e.id === group.widthEntityId)).toBe(false);
  expect(latest().parts[0]!.sketch.entities.filter(e => e.type === 'arc')).toHaveLength(2);
  expect(screen.getByRole('button', { name: /Finish sketch/ })).toBeEnabled();
});
