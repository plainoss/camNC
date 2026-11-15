import { createCadDocument, createCadPart, type CadDocument } from '@wbcnc/cad';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { userEvent } from '@vitest/browser/context';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CadEditor } from './CadEditor';
import { endCadSession } from '@wbcnc/cad-editor/session';

const ids: string[] = [];
afterEach(() => {
  cleanup();
  ids.forEach(endCadSession);
  ids.length = 0;
});
const checked = () => waitFor(() => expect(screen.queryByText(/^Checking sketch/)).toBeNull(), { timeout: 20000 });
async function setup() {
  const doc = createCadDocument();
  doc.parts.push(createCadPart());
  ids.push(doc.id);
  render(
    <div style={{ height: 700 }}>
      <CadEditor document={doc} onDraftChange={vi.fn<(document: CadDocument) => void>()} onFinish={() => {}} onCancel={() => {}} />
    </div>
  );
  const canvas = screen.getByTestId('cad-canvas') as unknown as SVGSVGElement;
  vi.spyOn(canvas, 'setPointerCapture').mockImplementation(() => {});
  await checked();
  return canvas;
}
function at(canvas: SVGSVGElement, x: number, y: number) {
  const p = new DOMPoint(x, -y).matrixTransform(canvas.getScreenCTM()!);
  return { clientX: p.x, clientY: p.y, button: 0, pointerId: 1 };
}
async function tool(name: string) {
  const family = name === 'Conic' ? 'Arc tools' : 'Spline tools';
  await userEvent.click(
    screen.getByRole('button', { name: screen.queryByRole('button', { name: 'Drawing tools' }) ? 'Drawing tools' : family })
  );
  await userEvent.click(screen.getByRole('menuitem', { name }));
}
const previewPoints = (canvas: SVGSVGElement, kind: string) =>
  canvas.querySelector(`[data-curve-preview="${kind}"]`)?.getAttribute('points')?.split(' ').filter(Boolean).length ?? 0;

describe('curve previews while drawing', () => {
  it.each([
    ['Spline', 'spline'],
    ['Bezier', 'bezier'],
  ])('draws a tessellated %s preview through the picked points and the cursor', async (name, kind) => {
    const canvas = await setup();
    await tool(name);
    expect(canvas.querySelector('[data-curve-preview]')).toBeNull();
    fireEvent.pointerDown(canvas, at(canvas, 20, 20));
    fireEvent.pointerDown(canvas, at(canvas, 60, 50));
    fireEvent.pointerMove(canvas, at(canvas, 100, 20));
    await waitFor(() => expect(previewPoints(canvas, kind)).toBeGreaterThan(3));
  });

  it('shows a conic as its picked points until the third point shapes it', async () => {
    const canvas = await setup();
    await tool('Conic');
    fireEvent.pointerDown(canvas, at(canvas, 20, 20));
    fireEvent.pointerMove(canvas, at(canvas, 100, 20));
    await waitFor(() => expect(previewPoints(canvas, 'conic')).toBe(2));
    fireEvent.pointerDown(canvas, at(canvas, 100, 20));
    fireEvent.pointerMove(canvas, at(canvas, 60, 70));
    await waitFor(() => expect(previewPoints(canvas, 'conic')).toBeGreaterThan(3));
  });
});
