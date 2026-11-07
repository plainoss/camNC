import { addCircle, addFaceSketch, addLine, addRectangle, createCadPart, createPlateDocument, type CadDocument } from '@wbcnc/cad';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CadEditor } from './CadEditor';
import { endCadSession } from './session';

const ids: string[] = [];
afterEach(() => {
  cleanup();
  ids.splice(0).forEach(endCadSession);
});
function plate() {
  const document = createPlateDocument({ width: 120, height: 80, thickness: 18 }),
    part = document.parts[0]!;
  part.sketch = addCircle(part.sketch, { x: 45, y: 40, radius: 32 });
  return document;
}
function setup(document: CadDocument, props: Partial<Parameters<typeof CadEditor>[0]> = {}) {
  ids.push(document.id);
  const change = vi.fn<(document: CadDocument) => void>(),
    result = render(
      <div style={{ height: 700 }}>
        <CadEditor document={document} onDraftChange={change} onFinish={vi.fn()} onCancel={vi.fn()} saveStatus="Saved" {...props} />
      </div>
    );
  vi.spyOn(result.getByTestId('cad-canvas'), 'setPointerCapture').mockImplementation(() => {});
  return { change, ...result };
}
const canvas = () => screen.getByTestId('cad-canvas') as unknown as SVGSVGElement;
function clickWorld(x: number, y: number) {
  const point = new DOMPoint(x, -y).matrixTransform(canvas().getScreenCTM()!);
  fireEvent.pointerDown(canvas(), { clientX: point.x, clientY: point.y, button: 0, pointerId: 1 });
  fireEvent.pointerUp(canvas(), { clientX: point.x, clientY: point.y, button: 0, pointerId: 1 });
}
const depthField = () => screen.findByLabelText('Depth in mm');
const lastDocument = (change: ReturnType<typeof setup>['change']) => change.mock.lastCall![0];

describe('setting a cut depth on the drawing', () => {
  it('offers a depth when a loop is clicked, showing through as its starting value', async () => {
    setup(plate());
    clickWorld(60, 45);
    expect(((await depthField()) as HTMLInputElement).value).toBe('18');
  });

  it('offers nothing for the part around its loops', () => {
    setup(plate());
    clickWorld(105, 70);
    expect(screen.queryByLabelText('Depth in mm')).toBeNull();
  });

  it('turns a loop into a pocket on Enter, and shows the depth on the drawing', async () => {
    const { change, container } = setup(plate());
    clickWorld(60, 45);
    fireEvent.change(await depthField(), { target: { value: '6' } });
    fireEvent.keyDown(await depthField(), { key: 'Enter' });
    await waitFor(() => expect(lastDocument(change).parts[0]!.features).toHaveLength(1));
    expect(lastDocument(change).version).toBe(2);
    expect(screen.queryByLabelText('Depth in mm')).toBeNull();
    await waitFor(() => expect(container.querySelector('[data-cut-depth="6"]')).not.toBeNull());
    // The label stays a readable size on screen, whatever the zoom.
    const label = container.querySelector('[data-cut-depth="6"] text')!.getBoundingClientRect();
    expect(label.height).toBeGreaterThan(8);
    expect(label.height).toBeLessThan(24);
  });

  it('removes the cut when set back to through, so the design returns to its plain form', async () => {
    const { change } = setup(plate());
    clickWorld(60, 45);
    fireEvent.change(await depthField(), { target: { value: '6' } });
    fireEvent.keyDown(await depthField(), { key: 'Enter' });
    await waitFor(() => expect(lastDocument(change).version).toBe(2));
    clickWorld(60, 45);
    expect(((await depthField()) as HTMLInputElement).value).toBe('6');
    fireEvent.click(screen.getByRole('button', { name: 'Through' }));
    await waitFor(() => expect(lastDocument(change).version).toBe(1));
    expect('features' in lastDocument(change).parts[0]!).toBe(false);
  });

  it('treats a depth past the board’s thickness as through', async () => {
    const { change } = setup(plate());
    clickWorld(60, 45);
    fireEvent.change(await depthField(), { target: { value: '30' } });
    fireEvent.keyDown(await depthField(), { key: 'Enter' });
    expect(screen.queryByLabelText('Depth in mm')).toBeNull();
    expect(change.mock.calls.every(([document]) => !document.parts[0]!.features)).toBe(true);
  });

  it('leaves a loop uncut with No cut, and lists it for removal', async () => {
    const { change, container } = setup(plate());
    clickWorld(60, 45);
    await depthField();
    fireEvent.click(screen.getByRole('button', { name: 'No cut' }));
    await waitFor(() => expect(container.querySelector('[data-cut-depth="0"]')).not.toBeNull());
    expect((lastDocument(change).parts[0]!.features![0] as { depth: number }).depth).toBe(0);
    fireEvent.click(screen.getByRole('button', { name: 'Remove cut 1' }));
    await waitFor(() => expect(lastDocument(change).version).toBe(1));
  });

  it('leaves the design alone on Escape, and rejects a depth that isn’t a number', async () => {
    const { change } = setup(plate());
    clickWorld(60, 45);
    fireEvent.change(await depthField(), { target: { value: 'deep' } });
    fireEvent.keyDown(await depthField(), { key: 'Enter' });
    expect(await depthField()).toHaveProperty('ariaInvalid', 'true');
    fireEvent.keyDown(await depthField(), { key: 'Escape' });
    expect(screen.queryByLabelText('Depth in mm')).toBeNull();
    expect(change.mock.calls.every(([document]) => !document.parts[0]!.features)).toBe(true);
  });

  it('lets a region of a face sketch be cut, and picks the smaller of two regions', async () => {
    const base = plate(),
      partId = base.parts[0]!.id,
      added = addFaceSketch(base, partId, 'top'),
      face = added.document.parts[0]!.features![0]!;
    if (face.type !== 'sketch') throw new Error('Expected a sketch');
    face.sketch = addLine(face.sketch, { x1: 90, y1: -5, x2: 90, y2: 85 });
    const { change, container } = setup(added.document);
    clickWorld(105, 40);
    expect(((await depthField()) as HTMLInputElement).value).toBe('0');
    fireEvent.change(await depthField(), { target: { value: '4' } });
    fireEvent.keyDown(await depthField(), { key: 'Enter' });
    await waitFor(() => expect(container.querySelector('[data-cut-depth="4"]')).not.toBeNull());
    expect(lastDocument(change).parts[0]!.features!.filter(f => f.type === 'cut')).toHaveLength(1);
  });

  it('closes the depth field when the part changes, so it can’t write a stale cut', async () => {
    const document = plate(),
      other = createCadPart('Other');
    other.sketch = addRectangle(other.sketch, { x: 0, y: 0, width: 50, height: 50 });
    document.parts.push(other);
    const { change } = setup(document);
    clickWorld(60, 45);
    await depthField();
    fireEvent.click(screen.getByRole('button', { name: /Other/ }));
    await waitFor(() => expect(screen.queryByLabelText('Depth in mm')).toBeNull());
    expect(change.mock.calls.every(([next]) => next.parts.every(part => !part.features))).toBe(true);
  });

  it('opens a new face sketch through its host', async () => {
    const open = vi.fn();
    setup(plate(), { onEditFaceSketch: open });
    await waitFor(() => expect(screen.getByRole('button', { name: '✓ Finish sketch' })).toHaveProperty('disabled', false));
    // The editor rightly refuses while a sketch check is running, so keep asking until it's free.
    await waitFor(() => {
      fireEvent.click(screen.getByRole('button', { name: 'New sketch on top' }));
      expect(open).toHaveBeenCalledOnce();
    });
    const [document, partId, sketchId] = open.mock.lastCall as [CadDocument, string, string];
    expect(document.parts.find(p => p.id === partId)!.features!.some(f => f.type === 'sketch' && f.sketch.id === sketchId)).toBe(true);
  });

  it('won’t open a face sketch until the part has an outline', async () => {
    const open = vi.fn(),
      document = createPlateDocument({ width: 120, height: 80, thickness: 18 }),
      part = document.parts[0]!;
    part.sketch = addLine(
      { ...part.sketch, entities: part.sketch.entities.filter(e => e.type === 'point' && e.fixed), constraints: [] },
      { x1: 90, y1: 0, x2: 90, y2: 80 }
    );
    const { change } = setup(document, { onEditFaceSketch: open }),
      button = await screen.findByRole('button', { name: 'New sketch on top' });
    expect(button).toHaveProperty('disabled', true);
    expect(screen.getByText(/Close the outline/)).toBeTruthy();
    fireEvent.click(button);
    expect(open).not.toHaveBeenCalled();
    expect(change.mock.calls.every(([next]) => next.parts.every(candidate => !candidate.features))).toBe(true);
  });

  it('accepts an open drawing in a face sketch, with the outline behind it', async () => {
    const document = createPlateDocument({ width: 120, height: 80, thickness: 18 }),
      part = document.parts[0]!;
    part.sketch = addLine(
      { ...part.sketch, entities: part.sketch.entities.filter(e => e.type === 'point' && e.fixed), constraints: [] },
      { x1: 90, y1: 0, x2: 90, y2: 80 }
    );
    const { container } = setup(document, {
      faceSketch: {
        label: 'Top face',
        outline: [
          { x: 0, y: 0 },
          { x: 120, y: 0 },
          { x: 120, y: 80 },
          { x: 0, y: 80 },
        ],
      },
    });
    expect(container.querySelector('[data-face-outline]')).not.toBeNull();
    expect(screen.queryByRole('button', { name: 'Add part' })).toBeNull();
    await waitFor(() => expect(screen.getByRole('button', { name: '✓ Finish sketch' })).toHaveProperty('disabled', false));
  });
});
