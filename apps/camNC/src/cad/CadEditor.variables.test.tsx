import { createPlateDocument, setCadVariable, type CadDimension, type CadDocument, type CadPart } from '@wbcnc/cad';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
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
  render(
    <div style={{ height: 700 }}>
      <CadEditor document={document} onDraftChange={change} onFinish={vi.fn()} onCancel={vi.fn()} saveStatus="Saved" />
    </div>
  );
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
    fireEvent.click(screen.getByRole('button', { name: /Shelf/ }));
    expect(await screen.findByText(/keeps its last good shape/)).toBeTruthy();
  });
});
