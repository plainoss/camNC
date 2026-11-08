import { cleanup, render, screen } from '@testing-library/react';
import { createPlateDocument, type CadDimension, type CadDocument } from '@wbcnc/cad';
import { userEvent } from '@vitest/browser/context';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CadVariablesPanel } from './CadVariablesPanel';

afterEach(cleanup);

/** A plate whose width dimension already reads `width - 2*board`, with no variables yet. */
function plate(): CadDocument {
  const document = createPlateDocument({ width: 200, height: 100 });
  const width = document.parts[0]!.sketch.constraints.find((c): c is CadDimension => c.label === 'Width')!;
  width.expression = 'width - 2*board';
  return document;
}
const widthOf = (document: CadDocument) => document.parts[0]!.sketch.constraints.find((c): c is CadDimension => c.label === 'Width')!.value;

function setup(initial = plate()) {
  const changes = vi.fn<(next: CadDocument) => void>();
  let current = initial;
  function Host() {
    const [document, setDocument] = useState(initial);
    return (
      <div>
        <CadVariablesPanel
          document={document}
          onChange={next => {
            current = next;
            changes(next);
            setDocument(next);
          }}
        />
        <button>Elsewhere</button>
      </div>
    );
  }
  render(<Host />);
  return { changes, document: () => current };
}

async function add(name: string, expression: string) {
  await userEvent.click(screen.getByRole('button', { name: 'Add variable' }));
  await userEvent.keyboard(name);
  await userEvent.click(screen.getByRole('textbox', { name: `Value of ${name}` }));
  await userEvent.keyboard(`${expression}{Enter}`);
}

describe('design variables panel', () => {
  it('adds variables, and the dimensions that use them follow', async () => {
    const ui = setup();
    expect(screen.getByText(/Name a size/)).toBeTruthy();
    await add('board', '18mm');
    await add('width', '600mm');
    expect(ui.document().variables!.map(v => [v.name, v.expression])).toEqual([
      ['board', '18mm'],
      ['width', '600mm'],
    ]);
    expect(widthOf(ui.document())).toBe(564);
    const value = screen.getByRole('textbox', { name: 'Value of width' }) as HTMLInputElement;
    await userEvent.click(value);
    value.select();
    await userEvent.keyboard('board * 20{Enter}');
    expect(widthOf(ui.document())).toBe(324);
    expect(screen.getByLabelText('width is').textContent).toBe('360 mm');
  });

  it('keeps a refused change on screen with the reason, and saves nothing', async () => {
    const ui = setup();
    await userEvent.click(screen.getByRole('button', { name: 'Add variable' }));
    await userEvent.keyboard('in');
    await userEvent.click(screen.getByRole('textbox', { name: 'Value of in' }));
    await userEvent.keyboard('3{Enter}');
    expect(screen.getByRole('alert').textContent).toBe("in is a unit, so it can't be a variable name.");
    expect((screen.getByRole('textbox', { name: 'Variable name' }) as HTMLInputElement).value).toBe('in');
    expect(ui.changes).not.toHaveBeenCalled();
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('textbox', { name: 'Variable name' })).toBeNull();
  });

  it('won’t delete a variable that’s in use, and saves when focus leaves the row', async () => {
    const ui = setup();
    await add('board', '18mm');
    await add('width', '600mm');
    await userEvent.click(screen.getByRole('button', { name: 'Delete width' }));
    expect(screen.getByRole('alert').textContent).toBe('width is used in one place. Change those first.');
    const name = screen.getAllByRole('textbox', { name: 'Variable name' })[0] as HTMLInputElement;
    await userEvent.click(name);
    name.select();
    await userEvent.keyboard('thick');
    await userEvent.click(screen.getByRole('button', { name: 'Elsewhere' }));
    expect(ui.document().variables!.map(v => v.name)).toEqual(['thick', 'width']);
    expect(ui.document().parts[0]!.sketch.constraints.find(c => c.label === 'Width')).toMatchObject({ expression: 'width - 2*thick' });
  });
});
