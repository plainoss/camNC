import { createPlateDocument, type CadDocument } from '@wbcnc/cad';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { userEvent } from '@vitest/browser/context';
import { afterEach, expect, it, vi } from 'vitest';
import { CadEditor } from './CadEditor';
import { endCadSession } from '@wbcnc/cad-editor/session';

const ids: string[] = [];
afterEach(() => {
  cleanup();
  ids.forEach(endCadSession);
  ids.length = 0;
});
const checked = () =>
  waitFor(
    () => {
      expect(screen.queryByText(/^Checking sketch/)).toBeNull();
      expect(document.querySelector('.cad-editor')!.getAttribute('aria-busy')).toBe('false');
    },
    { timeout: 20_000 }
  );

it('places a redundant new size as a read-only reference, keeps old drivers and supports one Undo', async () => {
  const source = createPlateDocument({ width: 100, height: 60 }),
    change = vi.fn<(document: CadDocument) => void>();
  ids.push(source.id);
  render(
    <div style={{ height: 700 }}>
      <CadEditor document={source} onDraftChange={change} onFinish={() => {}} onCancel={() => {}} />
    </div>
  );
  const canvas = screen.getByTestId('cad-canvas') as unknown as SVGSVGElement;
  const latest = () => change.mock.calls.at(-1)?.[0].parts[0]!.sketch ?? source.parts[0]!.sketch;
  const click = async (x: number, y: number) => {
    const p = new DOMPoint(x, -y).matrixTransform(canvas.getScreenCTM()!),
      bounds = canvas.getBoundingClientRect();
    await userEvent.click(canvas, { position: { x: p.x - bounds.left, y: p.y - bounds.top } });
    await checked();
  };
  await checked();
  const original = structuredClone(latest());
  await userEvent.keyboard('d');
  await click(50, 60);
  await click(50, 90);
  const reference = latest().constraints.find(c => 'driven' in c && c.driven)!;
  expect(reference).toMatchObject({ type: 'distanceX', value: 100, driven: true });
  expect(latest().constraints.filter(c => c.id !== reference.id)).toEqual(original.constraints);
  expect(latest().entities).toEqual(original.entities);
  // Its value box opens with the length it measures, and Enter takes it as it is.
  const measured = screen.getByRole('textbox', { name: /mm$/ });
  expect((measured as HTMLInputElement).value).toBe('100');
  await userEvent.keyboard('{Enter}');
  expect(screen.queryByRole('textbox', { name: /mm$/ })).toBeNull();
  expect(latest().constraints.find(c => c.id === reference.id)).toMatchObject({ value: 100, driven: true });
  const label = screen.getByRole('button', { name: /^Reference .*: 100 mm$/ });
  await userEvent.dblClick(label);
  expect(screen.queryByRole('textbox', { name: /mm$/ })).toBeNull();
  await userEvent.click(canvas);
  await userEvent.keyboard('{Control>}z{/Control}');
  await checked();
  expect(latest().constraints).toEqual(original.constraints);
  await userEvent.keyboard('{Control>}y{/Control}');
  await checked();
  expect(latest().constraints).toContainEqual(reference);
});

it('takes zero for a line-owned horizontal size, collapsing the line', async () => {
  const source = createPlateDocument({ width: 100, height: 60 }),
    change = vi.fn<(document: CadDocument) => void>();
  ids.push(source.id);
  render(
    <div style={{ height: 700 }}>
      <CadEditor document={source} onDraftChange={change} onFinish={() => {}} onCancel={() => {}} />
    </div>
  );
  await checked();
  await userEvent.dblClick(screen.getByRole('button', { name: 'Edit Width: 100 mm' }));
  const input = screen.getByRole('textbox', { name: 'Width mm' });
  await userEvent.clear(input);
  await userEvent.keyboard('0{Enter}');
  await waitFor(() =>
    expect((change.mock.calls.at(-1)?.[0] ?? source).parts[0]!.sketch.constraints.find(c => c.label === 'Width')).toMatchObject({
      value: 0,
    })
  );
});
