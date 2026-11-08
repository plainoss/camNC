import { addCircle, cadCuts, createPlateDocument, setCadVariable, type CadDimension, type CadDocument, type CadPart } from '@wbcnc/cad';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CadEditor } from './CadEditor';
import { endCadSession } from './session';

const ids: string[] = [];
afterEach(() => {
  cleanup();
  ids.splice(0).forEach(endCadSession);
});
const width = (part: CadPart) => part.sketch.constraints.find((c): c is CadDimension => c.label === 'Width')!;
function plate(name: string, expression: string): CadPart {
  const part = createPlateDocument({ width: 200, height: 100 }).parts[0]!;
  part.name = name;
  width(part).expression = expression;
  return part;
}
/** A side and a shelf, both sized from `width`, the shelf less two boards. */
function cupboard(): CadDocument {
  let document: CadDocument = { ...createPlateDocument(), parts: [plate('Side', 'width'), plate('Shelf', 'width - 2*board')] };
  for (const [name, expression] of [
    ['board', '18mm'],
    ['width', '200mm'],
  ]) {
    const result = setCadVariable(document, { name: name!, expression: expression! });
    if ('error' in result) throw new Error(result.error);
    document = result.document;
  }
  return document;
}
function setup(document: CadDocument) {
  ids.push(document.id);
  const change = vi.fn<(document: CadDocument) => void>();
  const result = render(
    <div style={{ height: 700 }}>
      <CadEditor document={document} onDraftChange={change} onFinish={vi.fn()} onCancel={vi.fn()} saveStatus="Saved" />
    </div>
  );
  vi.spyOn(result.getByTestId('cad-canvas'), 'setPointerCapture').mockImplementation(() => {});
  return { last: () => change.mock.lastCall![0] };
}
const setWidth = (text: string) => {
  const input = screen.getByRole('textbox', { name: 'Value of width' });
  fireEvent.change(input, { target: { value: text } });
  fireEvent.keyDown(input, { key: 'Enter' });
};

describe('design variables in the editor', () => {
  it('updates every part that uses a variable, and marks a part that can’t follow', async () => {
    const ui = setup(cupboard());
    setWidth('300mm');
    await waitFor(() => expect(ui.last().parts.map(part => width(part).value)).toEqual([300, 264]));
    expect(screen.queryByRole('img', { name: /flip/ })).toBeNull();
    setWidth('30mm');
    await waitFor(() => expect(ui.last().parts.map(part => width(part).value)).toEqual([30, 264]));
    expect(screen.getByRole('img', { name: 'width - 2*board: That would flip this line over. It needs to stay above zero.' })).toBeTruthy();
    // The mark sits on the shelf only.
    expect(screen.getByRole('img', { name: /flip/ }).closest('button')!.textContent).toContain('Shelf');
    fireEvent.click(within(screen.getByRole('list', { name: 'Parts' })).getByRole('button', { name: /Shelf/ }));
    expect(await screen.findByText(/keeps its last good shape/)).toBeTruthy();
  });

  it('cuts a pocket to a depth that uses a variable, which then follows it', async () => {
    let document = createPlateDocument({ width: 120, height: 80, thickness: 18 });
    document.parts[0]!.sketch = addCircle(document.parts[0]!.sketch, { x: 60, y: 40, radius: 20 });
    const housing = setCadVariable(document, { name: 'housing', expression: '6mm' });
    if ('error' in housing) throw new Error(housing.error);
    document = housing.document;
    const ui = setup(document);
    const canvas = screen.getByTestId('cad-canvas') as unknown as SVGSVGElement;
    const point = new DOMPoint(70, -48).matrixTransform(canvas.getScreenCTM()!);
    fireEvent.pointerDown(canvas, { clientX: point.x, clientY: point.y, button: 0, pointerId: 1 });
    fireEvent.pointerUp(canvas, { clientX: point.x, clientY: point.y, button: 0, pointerId: 1 });
    const depth = await screen.findByLabelText('Depth in mm');
    fireEvent.change(depth, { target: { value: 'housing' } });
    fireEvent.keyDown(depth, { key: 'Enter' });
    await waitFor(() => expect(cadCuts(ui.last().parts[0]!)[0]).toMatchObject({ depth: 6, depthExpression: 'housing' }));
    const value = screen.getByRole('textbox', { name: 'Value of housing' });
    fireEvent.change(value, { target: { value: '9mm' } });
    fireEvent.keyDown(value, { key: 'Enter' });
    await waitFor(() => expect(cadCuts(ui.last().parts[0]!)[0]).toMatchObject({ depth: 9, depthExpression: 'housing' }));
  });
});
