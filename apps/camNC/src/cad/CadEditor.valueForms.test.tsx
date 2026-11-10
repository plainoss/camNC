import { createCadDocument, createCadPart, createPlateDocument, type CadDocument } from '@wbcnc/cad';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { userEvent } from '@vitest/browser/context';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CadEditor } from './CadEditor';
import { endCadSession } from '@wbcnc/cad-editor/session';

// Characterizes the cancel and close buttons of the sketch value forms (fillet, chamfer, rho, polygon), which no other
// test presses.
const ids: string[] = [];
afterEach(() => {
  cleanup();
  ids.splice(0).forEach(endCadSession);
});
const checked = () =>
  waitFor(
    () => {
      expect(screen.queryByText(/^Checking sketch/)).toBeNull();
      expect(document.querySelector('.cad-editor')!.getAttribute('aria-busy')).toBe('false');
    },
    { timeout: 20_000 }
  );

async function setup(source: CadDocument) {
  const change = vi.fn<(document: CadDocument) => void>();
  ids.push(source.id);
  render(
    <div style={{ height: 700 }}>
      <CadEditor document={source} onDraftChange={change} onFinish={() => {}} onCancel={() => {}} />
    </div>
  );
  await checked();
  const canvas = screen.getByTestId('cad-canvas') as unknown as SVGSVGElement;
  vi.spyOn(canvas, 'setPointerCapture').mockImplementation(() => {});
  const click = async (x: number, y: number) => {
    const p = new DOMPoint(x, -y).matrixTransform(canvas.getScreenCTM()!),
      bounds = canvas.getBoundingClientRect();
    await userEvent.click(canvas, { position: { x: p.x - bounds.left, y: p.y - bounds.top } });
    await checked();
  };
  const latest = () => change.mock.calls.at(-1)?.[0].parts[0]!.sketch ?? source.parts[0]!.sketch;
  return { canvas, click, latest };
}

describe('sketch value forms', () => {
  it('Cancel fillets closes the fillet form without adding arcs', async () => {
    const { click, latest } = await setup(createPlateDocument({ width: 100, height: 60 }));
    await click(100, 60);
    await userEvent.keyboard('{Shift>}f{/Shift}');
    expect(screen.getByRole('textbox', { name: 'Fillet radius' })).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'Cancel fillets' }));
    expect(screen.queryByRole('textbox', { name: 'Fillet radius' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Apply fillets' })).toBeNull();
    expect(latest().entities.filter(e => e.type === 'arc')).toHaveLength(0);
  });

  it('Cancel chamfers closes the chamfer form without changing the sketch', async () => {
    const source = createPlateDocument({ width: 100, height: 60 });
    const { canvas, click, latest } = await setup(source);
    const before = latest().entities.length;
    await click(100, 60);
    fireEvent.keyDown(canvas, { key: 'c', altKey: true, code: 'KeyC' });
    const search = screen.getByRole('combobox');
    fireEvent.change(search, { target: { value: 'chamfer' } });
    fireEvent.keyDown(search, { key: 'Enter' });
    expect(screen.getByRole('textbox', { name: 'Chamfer distance 1' })).toBeTruthy();
    expect(screen.getByRole('textbox', { name: 'Chamfer distance 2' })).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'Cancel chamfers' }));
    expect(screen.queryByRole('textbox', { name: 'Chamfer distance 1' })).toBeNull();
    expect(latest().entities).toHaveLength(before);
  });

  it('Close rho closes the rho form and keeps the conic', async () => {
    const doc = createCadDocument();
    doc.parts.push(createCadPart());
    const { canvas, latest } = await setup(doc);
    await userEvent.click(
      screen.getByRole('button', { name: screen.queryByRole('button', { name: 'Drawing tools' }) ? 'Drawing tools' : 'Arc tools' })
    );
    await userEvent.click(screen.getByRole('menuitem', { name: 'Conic' }));
    for (const [x, y] of [
      [20, 20],
      [100, 20],
      [60, 75],
    ]) {
      const p = new DOMPoint(x, -y).matrixTransform(canvas.getScreenCTM()!);
      fireEvent.pointerDown(canvas, { clientX: p.x, clientY: p.y, button: 0, pointerId: 1 });
    }
    expect(screen.getByRole('textbox', { name: 'Conic rho' })).toBeTruthy();
    expect(screen.getByText('0 < ρ < 1')).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'Close rho' }));
    await checked();
    expect(screen.queryByRole('textbox', { name: 'Conic rho' })).toBeNull();
    expect(latest().entities.filter(e => e.type === 'conic')).toHaveLength(1);
  });

  it('Escape in the polygon sides field leaves the polygon tool', async () => {
    const doc = createCadDocument();
    doc.parts.push(createCadPart());
    await setup(doc);
    fireEvent.keyDown(screen.getByTestId('cad-canvas'), { key: 'c', altKey: true, code: 'KeyC' });
    const search = screen.getByRole('combobox');
    fireEvent.change(search, { target: { value: 'Inscribed polygon' } });
    fireEvent.keyDown(search, { key: 'Enter' });
    const sides = screen.getByRole('spinbutton', { name: 'Polygon sides' });
    expect((screen.getByRole('button', { name: 'Create polygon' }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.keyDown(sides, { key: 'Escape' });
    expect(screen.queryByRole('spinbutton', { name: 'Polygon sides' })).toBeNull();
  });
});
