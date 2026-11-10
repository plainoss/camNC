import { addCircle, linearPatternSketchEntities, createPlateDocument, type CadDocument } from '@wbcnc/cad';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { CadEditor } from './CadEditor';
import { endCadSession } from '@wbcnc/cad-editor/session';
import { saveCadViewState } from '@wbcnc/cad-editor/viewState';
const ids: string[] = [];
afterEach(() => {
  cleanup();
  ids.forEach(endCadSession);
  ids.length = 0;
});
const checked = () => waitFor(() => expect(screen.queryByText(/^Checking sketch/)).toBeNull(), { timeout: 20000 });
async function setup(circle = false, preselect = true, saved?: CadDocument, selectedId?: string) {
  const doc = saved ?? createPlateDocument({ width: 120, height: 80 });
  ids.push(doc.id);
  if (circle && !saved) doc.parts[0]!.sketch = addCircle(doc.parts[0]!.sketch, { x: 40, y: 40, radius: 8, dimensioned: true });
  saveCadViewState(doc.id, {
    selectedPartId: doc.parts[0]!.id,
    view: { x: -10, y: -100, w: 150, h: 110 },
    selectedEntityIds: preselect ? [selectedId ?? doc.parts[0]!.sketch.entities.find(e => e.type === 'circle')!.id] : [],
  });
  const change = vi.fn<(d: CadDocument) => void>();
  render(
    <div style={{ height: 700 }}>
      <CadEditor document={doc} onDraftChange={change} onFinish={() => {}} onCancel={() => {}} />
    </div>
  );
  const canvas = screen.getByTestId('cad-canvas') as unknown as SVGSVGElement;
  canvas.dataset.testCircleId = doc.parts[0]!.sketch.entities.find(e => e.type === 'circle')!.id;
  vi.spyOn(canvas, 'setPointerCapture').mockImplementation(() => {});
  await checked();
  return { canvas, doc, latest: () => change.mock.calls.at(-1)?.[0].parts[0]!.sketch ?? doc.parts[0]!.sketch };
}
function pick(canvas: SVGSVGElement, x: number, y: number) {
  const p = new DOMPoint(x, -y).matrixTransform(canvas.getScreenCTM()!);
  const e = { clientX: p.x, clientY: p.y, pointerId: 1, button: 0 };
  const target = canvas.querySelector(`[data-entity-id="${canvas.dataset.testCircleId}"]`) ?? canvas;
  fireEvent.pointerDown(target, e);
  fireEvent.pointerUp(canvas, e);
}
function choose(canvas: SVGSVGElement) {
  fireEvent.keyDown(canvas, { key: 'c', altKey: true, code: 'KeyC' });
  const input = screen.getByRole('combobox');
  fireEvent.change(input, { target: { value: 'linear pattern' } });
  fireEvent.keyDown(input, { key: 'Enter' });
}
const value = (name: string, text: string) => fireEvent.change(screen.getByLabelText(name), { target: { value: text } });
it('previews a two-direction pattern, validates counts and commits all instances as one undoable edit', async () => {
  const { canvas, latest } = await setup(true);
  choose(canvas);
  expect(screen.getByRole('button', { name: /Finish sketch/ })).toBeDisabled();
  value('Instances 1', '1');
  expect(screen.getByRole('button', { name: 'Apply pattern' })).toBeDisabled();
  value('Instances 1', '3');
  value('Spacing 1', '25');
  fireEvent.click(screen.getByLabelText('Second direction'));
  value('Instances 2', '2');
  value('Spacing 2', '25');
  expect(latest().entities.filter(e => e.type === 'circle')).toHaveLength(1);
  fireEvent.click(screen.getByRole('button', { name: 'Apply pattern' }));
  await checked();
  await waitFor(() => expect(latest().entities.filter(e => e.type === 'circle')).toHaveLength(6));
  expect(latest().constraints.filter(c => c.type === 'linearPattern')).toHaveLength(1);
  fireEvent.click(screen.getByRole('button', { name: /^Undo/ }));
  await checked();
  expect(latest().entities.filter(e => e.type === 'circle')).toHaveLength(1);
  fireEvent.click(screen.getByRole('button', { name: /^Redo/ }));
  await checked();
  await waitFor(() => expect(latest().entities.filter(e => e.type === 'circle')).toHaveLength(6));
});
it('supports armed selection, cancellation, direction dragging and count-label editing', async () => {
  const { canvas, latest } = await setup(true, false);
  choose(canvas);
  pick(canvas, 48, 40);
  const handle = canvas.querySelector('[data-pattern-direction="0"]')!,
    b = handle.getBoundingClientRect(),
    unit = canvas.getScreenCTM()!.a;
  fireEvent.pointerDown(handle, { pointerId: 2, button: 0, clientX: b.x + b.width / 2, clientY: b.y + b.height / 2 });
  fireEvent.pointerMove(canvas, { pointerId: 2, clientX: b.x + b.width / 2, clientY: b.y + b.height / 2 - 40 * unit });
  fireEvent.pointerUp(canvas, { pointerId: 2 });
  expect(Number((screen.getByLabelText('Direction angle 1') as HTMLInputElement).value)).toBeCloseTo(45, 4);
  fireEvent.doubleClick(screen.getByRole('button', { name: 'Edit instance count 1' }));
  expect(screen.getByLabelText('Instances 1')).toHaveFocus();
  fireEvent.click(screen.getByRole('button', { name: 'Cancel pattern' }));
  expect(latest().entities.filter(e => e.type === 'circle')).toHaveLength(1);
  expect(screen.getByRole('button', { name: /^Undo/ })).toBeDisabled();
});
it('caps the preview without capping the committed pattern', async () => {
  const { canvas, latest } = await setup(true);
  choose(canvas);
  value('Instances 1', '12');
  value('Spacing 1', '20');
  expect(screen.getByText('Showing up to 10 instances. Apply creates the full pattern.')).toBeVisible();
  expect(canvas.querySelectorAll('[data-entity-id] circle:not([data-nurbs-handle])').length).toBeGreaterThan(1);
  fireEvent.click(screen.getByRole('button', { name: 'Apply pattern' }));
  await checked();
  await waitFor(() => expect(latest().entities.filter(e => e.type === 'circle')).toHaveLength(12));
});
it('edits a persisted pattern from its icon without adding history for an unchanged application', async () => {
  const { canvas, latest } = await setup(true);
  choose(canvas);
  value('Spacing 1', '25');
  fireEvent.click(screen.getByRole('button', { name: 'Apply pattern' }));
  await checked();
  const group = latest().constraints.find(c => c.type === 'linearPattern')!;
  const icon = canvas.querySelector(`[data-constraint-id="${group.id}"]`)!;
  fireEvent.doubleClick(icon);
  expect(screen.getByLabelText('Instances 1')).toHaveValue('3');
  fireEvent.keyDown(canvas, { key: 'Enter' });
  expect(screen.queryByRole('form', { name: 'Linear pattern' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: /^Undo/ }));
  await checked();
  expect(latest().entities.filter(e => e.type === 'circle')).toHaveLength(1);
});

it('persists an individually deleted instance through contextual edits, shrinking and regrowth', async () => {
  const doc = createPlateDocument({ width: 120, height: 80 });
  doc.parts[0]!.sketch = addCircle(doc.parts[0]!.sketch, { x: 25, y: 40, radius: 5 });
  const circle = doc.parts[0]!.sketch.entities.find(e => e.type === 'circle')!;
  const result = linearPatternSketchEntities(doc.parts[0]!.sketch, { entityIds: [circle.id], countX: 4, stepX: { x: 20, y: 0 } });
  if (!result.ok) throw new Error(result.message);
  doc.parts[0]!.sketch = result.sketch;
  const group = result.sketch.constraints.find(c => c.id === result.patternId)!;
  if (group.type !== 'linearPattern') throw new Error('missing group');
  const deletedId = group.instances.find(i => i.x === 1)!.idMap[circle.id]!;
  let fixture = await setup(false, true, doc, deletedId);
  fireEvent.keyDown(fixture.canvas, { key: 'Delete' });
  await checked();
  expect(fixture.latest().entities.some(e => e.id === deletedId)).toBe(false);
  const saved = JSON.parse(JSON.stringify({ ...doc, revision: doc.revision + 1, parts: [{ ...doc.parts[0]!, sketch: fixture.latest() }] }));
  cleanup();
  endCadSession(doc.id);
  fixture = await setup(false, false, saved);
  const glyph = () => fixture.canvas.querySelector(`[data-constraint-id="${group.id}"]`)!;
  fireEvent.pointerDown(glyph(), { button: 2, pointerId: 4, clientX: 500, clientY: 300 });
  fireEvent.pointerUp(fixture.canvas, { button: 2, pointerId: 4, clientX: 500, clientY: 300 });
  fireEvent.click(screen.getByRole('menuitem', { name: 'Edit pattern' }));
  value('Instances 1', '2');
  fireEvent.click(screen.getByRole('button', { name: 'Apply pattern' }));
  await checked();
  fireEvent.doubleClick(glyph());
  value('Instances 1', '4');
  fireEvent.click(screen.getByRole('button', { name: 'Apply pattern' }));
  await checked();
  expect(fixture.latest().entities.filter(e => e.type === 'circle')).toHaveLength(3);
  expect(fixture.latest().entities.some(e => e.id === deletedId)).toBe(false);
});
