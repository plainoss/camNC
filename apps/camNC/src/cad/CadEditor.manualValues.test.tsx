import { addConic, createCadDocument, createCadPart, createPlateDocument, type CadDocument } from '@wbcnc/cad';
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
async function setup(source?: CadDocument) {
  if (!source) {
    source = createCadDocument();
    source.parts.push(createCadPart());
  }
  ids.push(source.id);
  const change = vi.fn<(document: CadDocument) => void>();
  render(
    <div style={{ height: 700 }}>
      <CadEditor document={source} onDraftChange={change} onFinish={() => {}} onCancel={() => {}} />
    </div>
  );
  const canvas = screen.getByTestId('cad-canvas') as unknown as SVGSVGElement;
  const latest = () => change.mock.calls.at(-1)?.[0] ?? source;
  const settled = () => waitFor(() => expect(screen.queryByText(/^Checking sketch/)).toBeNull(), { timeout: 20_000 });
  await settled();
  const click = async (x: number, y: number) => {
    const client = new DOMPoint(x, -y).matrixTransform(canvas.getScreenCTM()!),
      bounds = canvas.getBoundingClientRect();
    await userEvent.click(canvas, { position: { x: client.x - bounds.left, y: client.y - bounds.top } });
  };
  const fill = async (name: string, text: string) => {
    await userEvent.dblClick(screen.getByRole('textbox', { name }));
    await userEvent.keyboard(text);
  };
  return { canvas, latest, settled, click, fill };
}

describe('manual sketch parameter expressions', () => {
  it('reports a rectangle field parsing error without creating geometry, then preserves unit expressions on its dimensions', async () => {
    const { latest, click, fill, settled } = await setup();
    await userEvent.keyboard('g');
    await click(20, 20);
    await fill('Rectangle width', '10cm/0');
    await userEvent.click(screen.getByRole('button', { name: 'Create' }));
    expect(screen.getByText('Rectangle width: Cannot divide by zero.')).toBeTruthy();
    expect(latest().parts[0]!.sketch.entities.filter(e => e.type !== 'point')).toHaveLength(0);
    const input = screen.getByRole('textbox', { name: 'Rectangle width' }) as HTMLInputElement;
    await userEvent.click(input);
    input.select();
    await userEvent.keyboard('10cm');
    await fill('Rectangle height', '1/2in');
    await userEvent.click(screen.getByRole('button', { name: 'Create' }));
    await settled();
    expect(latest().parts[0]!.sketch.constraints.find(c => c.label === 'Width')).toMatchObject({ value: 100, expression: '10cm' });
    expect(latest().parts[0]!.sketch.constraints.find(c => c.label === 'Height')).toMatchObject({ value: 12.7, expression: '1/2in' });
  });

  it('converts manual circle radius units and preserves the corresponding diameter expression', async () => {
    const { latest, click, fill, settled } = await setup();
    await userEvent.keyboard('c');
    await click(70, 60);
    await fill('Circle radius', '1/2in');
    await userEvent.click(screen.getByRole('button', { name: 'Create' }));
    await settled();
    expect(latest().parts[0]!.sketch.entities.find(e => e.type === 'circle')).toMatchObject({ radius: 12.7 });
    expect(latest().parts[0]!.sketch.constraints.find(c => c.type === 'diameter')).toMatchObject({ value: 25.4, expression: '2*(1/2in)' });
  });

  it('applies a fillet radius expression to the shared driver as one undoable corner group', async () => {
    const { latest, fill, settled } = await setup(createPlateDocument());
    await userEvent.keyboard('{Control>}a{/Control}{Shift>}f{/Shift}');
    await fill('Fillet radius', '1cm/2');
    await userEvent.click(screen.getByRole('button', { name: 'Apply fillets' }));
    await settled();
    expect(latest().parts[0]!.sketch.entities.filter(e => e.type === 'arc')).toHaveLength(4);
    expect(latest().parts[0]!.sketch.constraints.find(c => c.type === 'radius')).toMatchObject({ value: 5, expression: '1cm/2' });
    await userEvent.keyboard('{Control>}z{/Control}');
    await settled();
    expect(latest().parts[0]!.sketch.entities.filter(e => e.type === 'arc')).toHaveLength(0);
  });

  it('accepts scalar rho arithmetic, rejects dimensional rho units, and retains full source precision', async () => {
    const source = createCadDocument(),
      part = createCadPart();
    part.sketch = addConic(part.sketch, { start: { x: 20, y: 20 }, end: { x: 100, y: 20 }, control: { x: 60, y: 80 } });
    source.parts.push(part);
    const { latest, settled } = await setup(source);
    await userEvent.dblClick(screen.getByRole('button', { name: 'Edit conic rho: 0.5' }));
    await userEvent.keyboard('1cm{Enter}');
    expect(screen.getByText(/Conic rho:.*unitless/)).toBeTruthy();
    expect(latest().parts[0]!.sketch.entities.find(e => e.type === 'conic')).toMatchObject({ rho: 0.5 });
    await userEvent.keyboard('{Backspace}{Backspace}{Backspace}1/3{Enter}');
    await settled();
    expect(latest().parts[0]!.sketch.entities.find(e => e.type === 'conic')).toMatchObject({ rho: 1 / 3 });
  });
});

it('uses the design unit for bare manual lengths and converts defaults without changing their size', async () => {
  const document = createCadDocument();
  document.lengthUnit = 'cm';
  document.parts.push(createCadPart());
  const { latest, click, fill, settled } = await setup(document);
  await userEvent.keyboard('g');
  await click(20, 20);
  expect((screen.getByRole('textbox', { name: 'Rectangle width' }) as HTMLInputElement).value).toBe('10');
  await fill('Rectangle width', '12');
  await fill('Rectangle height', '8');
  await userEvent.click(screen.getByRole('button', { name: 'Create' }));
  await settled();
  expect(latest().parts[0]!.sketch.constraints.find(c => c.label === 'Width')).toMatchObject({ value: 120, expression: '(12) cm' });
  expect(latest().parts[0]!.sketch.constraints.find(c => c.label === 'Height')).toMatchObject({ value: 80, expression: '(8) cm' });
});

it('keeps slot and offset physical defaults when the design uses cm', async () => {
  const document = createPlateDocument();
  document.lengthUnit = 'cm';
  const { canvas, click } = await setup(document);
  await click(60, 80);
  const choose = (name: string) => {
    fireEvent.keyDown(canvas, { key: 'c', altKey: true, code: 'KeyC' });
    const search = screen.getByRole('combobox');
    fireEvent.change(search, { target: { value: name } });
    fireEvent.keyDown(search, { key: 'Enter' });
  };
  choose('Slot');
  expect((screen.getByRole('textbox', { name: 'Slot width' }) as HTMLInputElement).value).toBe('1');
  choose('Offset');
  await userEvent.click(screen.getByRole('button', { name: 'Edit offset distance' }));
  expect((screen.getByRole('textbox', { name: 'Offset distance' }) as HTMLInputElement).value).toBe('0.5');
});
