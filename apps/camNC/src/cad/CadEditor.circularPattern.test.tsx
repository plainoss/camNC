import { addCircle, circularPatternSketchEntities, createPlateDocument, type CadDocument } from '@wbcnc/cad';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { CadEditor } from './CadEditor';
import { endCadSession } from './session';
import { saveCadViewState } from './viewState';
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
  fireEvent.change(input, { target: { value: 'circular pattern' } });
  fireEvent.keyDown(input, { key: 'Enter' });
}
const value = (name: string, text: string) => fireEvent.change(screen.getByLabelText(name), { target: { value: text } });

it('creates a closed pattern with a free center and one undo entry, and validates an open sweep', async () => {
  const { canvas, latest } = await setup(true);
  choose(canvas);
  value('Pattern center X', '60');
  value('Pattern center Y', '40');
  expect(screen.getByRole('button', { name: /Finish sketch/ })).toBeDisabled();
  fireEvent.click(screen.getByLabelText('Closed circular pattern'));
  value('Pattern sweep', '0');
  expect(screen.getByRole('button', { name: 'Apply pattern' })).toBeDisabled();
  value('Pattern sweep', '180');
  value('Circular instances', '4');
  fireEvent.click(screen.getByRole('button', { name: 'Apply pattern' }));
  await checked();
  expect(latest().entities.filter(e => e.type === 'circle')).toHaveLength(4);
  const group = latest().constraints.find(c => c.type === 'circularPattern')!;
  if (group.type !== 'circularPattern') throw new Error('missing pattern');
  expect(group.closed).toBe(false);
  expect(group.angle).toBe(180);
  expect(latest().entities.find(e => e.id === group.centerId)).not.toMatchObject({ fixed: true });
  fireEvent.click(screen.getByRole('button', { name: /^Undo/ }));
  await checked();
  expect(latest().entities.filter(e => e.type === 'circle')).toHaveLength(1);
  fireEvent.click(screen.getByRole('button', { name: /^Redo/ }));
  await checked();
  expect(latest().entities.filter(e => e.type === 'circle')).toHaveLength(4);
});
it('drags the center and sweep, retains the open sweep when count changes, and cancels without history', async () => {
  const { canvas, latest } = await setup(true, false);
  choose(canvas);
  pick(canvas, 48, 40);
  const unit = canvas.getScreenCTM()!.a;
  const drag = (kind: string, dx: number, dy: number) => {
    const h = canvas.querySelector(`[data-circular-handle="${kind}"]`)!,
      b = h.getBoundingClientRect(),
      x = b.x + b.width / 2,
      y = b.y + b.height / 2;
    fireEvent.pointerDown(h, { pointerId: 2, button: 0, clientX: x, clientY: y });
    fireEvent.pointerMove(canvas, { pointerId: 2, clientX: x + dx * unit, clientY: y - dy * unit });
    fireEvent.pointerUp(canvas, { pointerId: 2 });
  };
  drag('center', 10, 5);
  expect(Number((screen.getByLabelText('Pattern center X') as HTMLInputElement).value)).toBeCloseTo(10, 5);
  expect(Number((screen.getByLabelText('Pattern center Y') as HTMLInputElement).value)).toBeCloseTo(5, 5);
  drag('sweep', 5, 10);
  expect(screen.getByLabelText('Closed circular pattern')).not.toBeChecked();
  const sweep = (screen.getByLabelText('Pattern sweep') as HTMLInputElement).value;
  value('Circular instances', '6');
  expect(screen.getByLabelText('Pattern sweep')).toHaveValue(sweep);
  fireEvent.doubleClick(screen.getByRole('button', { name: 'Edit circular instance count' }));
  expect(screen.getByLabelText('Circular instances')).toHaveFocus();
  fireEvent.keyDown(screen.getByLabelText('Circular instances'), { key: 'Escape' });
  expect(latest().entities.filter(e => e.type === 'circle')).toHaveLength(1);
  expect(screen.getByRole('button', { name: /^Undo/ })).toBeDisabled();
});
it('applies all twelve instances despite the ten-instance preview cap', async () => {
  const { canvas, latest } = await setup(true);
  choose(canvas);
  value('Circular instances', '12');
  expect(screen.getByText('Showing up to 10 instances. Apply creates the full pattern.')).toBeVisible();
  fireEvent.keyDown(canvas, { key: 'Enter' });
  await checked();
  expect(latest().entities.filter(e => e.type === 'circle')).toHaveLength(12);
});
it('edits a reloaded circular pattern from its icon and keeps exclusions through count edits', async () => {
  const doc = createPlateDocument({ width: 120, height: 80 });
  doc.parts[0]!.sketch = addCircle(doc.parts[0]!.sketch, { x: 40, y: 40, radius: 5 });
  const source = doc.parts[0]!.sketch.entities.find(e => e.type === 'circle')!;
  const initial = circularPatternSketchEntities(doc.parts[0]!.sketch, { entityIds: [source.id], count: 4, center: { x: 60, y: 40 } });
  if (!initial.ok) throw new Error(initial.message);
  doc.parts[0]!.sketch = initial.sketch;
  const group = initial.sketch.constraints.find(c => c.id === initial.patternId)!;
  if (group.type !== 'circularPattern') throw new Error('missing pattern');
  const copy = group.instances.find(i => i.x === 1)!.idMap[source.id]!;
  let fixture = await setup(false, true, doc, copy);
  fireEvent.keyDown(fixture.canvas, { key: 'Delete' });
  await checked();
  const saved = JSON.parse(JSON.stringify({ ...doc, revision: doc.revision + 1, parts: [{ ...doc.parts[0]!, sketch: fixture.latest() }] }));
  cleanup();
  endCadSession(doc.id);
  fixture = await setup(false, false, saved);
  const glyph = () => fixture.canvas.querySelector(`[data-constraint-id="${group.id}"]`)!;
  fireEvent.doubleClick(glyph());
  value('Circular instances', '2');
  fireEvent.click(screen.getByRole('button', { name: 'Apply pattern' }));
  await checked();
  fireEvent.doubleClick(glyph());
  value('Circular instances', '4');
  fireEvent.click(screen.getByRole('button', { name: 'Apply pattern' }));
  await checked();
  expect(fixture.latest().entities.some(e => e.id === copy)).toBe(false);
  expect(fixture.latest().entities.filter(e => e.type === 'circle')).toHaveLength(3);
});

it('preserves a reloaded clockwise closed pattern when applying unchanged controls', async () => {
  const doc = createPlateDocument({ width: 120, height: 80 });
  doc.parts[0]!.sketch = addCircle(doc.parts[0]!.sketch, { x: 40, y: 40, radius: 5 });
  const circle = doc.parts[0]!.sketch.entities.find(e => e.type === 'circle')!;
  const initial = circularPatternSketchEntities(doc.parts[0]!.sketch, {
    entityIds: [circle.id],
    count: 3,
    angle: -360,
    closed: true,
    center: { x: 60, y: 40 },
  });
  if (!initial.ok) throw new Error(initial.message);
  doc.parts[0]!.sketch = initial.sketch;
  const { canvas, latest } = await setup(false, false, JSON.parse(JSON.stringify(doc)));
  fireEvent.doubleClick(canvas.querySelector(`[data-constraint-id="${initial.patternId}"]`)!);
  fireEvent.keyDown(canvas, { key: 'Enter' });
  const group = latest().constraints.find(c => c.id === initial.patternId)!;
  expect(group).toMatchObject({ type: 'circularPattern', angle: -360, closed: true });
  expect(screen.getByRole('button', { name: /^Undo/ })).toBeDisabled();
});
