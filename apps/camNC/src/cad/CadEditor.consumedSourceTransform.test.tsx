import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import { userEvent } from '@vitest/browser/context';
import {
  addPartCut,
  addRectangle,
  consumedTools,
  createCadDocument,
  createCadPart,
  evaluateCadDocument,
  type CadDocument,
} from '@wbcnc/cad';
import { endCadSession } from '@wbcnc/cad-editor/session';
import { afterEach, expect, it, vi } from 'vitest';
import { nativePart } from '@/cam/nativeCadModel';
import { CadEditor } from './CadEditor';
import { solveCadDocument } from './solveCad';
import { studioCommand } from './studioToolbarTesting';

const sessions: string[] = [];
afterEach(() => {
  cleanup();
  sessions.splice(0).forEach(endCadSession);
});
const toolbar = () => within(screen.getByRole('toolbar', { name: 'Part Studio toolbar' }));
const settled = () =>
  waitFor(() => expect(document.querySelector('.cad-editor')).toHaveAttribute('aria-busy', 'false'), { timeout: 20_000 });

/** Independent occupied-triangle check on the actual milled top face, including its holes. */
function topMaterial(document: CadDocument, baseId: string, x: number, y: number) {
  const base = evaluateCadDocument(document).parts.find(part => part.partId === baseId)!;
  const { mesh } = nativePart(base);
  for (let i = 0; i < mesh.indices.length; i += 3) {
    const points = [0, 1, 2].map(k => {
      const at = mesh.indices[i + k]! * 3;
      return [mesh.positions[at]!, mesh.positions[at + 1]!, mesh.positions[at + 2]!] as const;
    });
    if (!points.every(point => Math.abs(point[2] - 12) < 1e-6)) continue;
    const sides = points.map((a, k) => {
      const b = points[(k + 1) % 3]!;
      return (b[0] - a[0]) * (y - a[1]) - (b[1] - a[1]) * (x - a[0]);
    });
    if (sides.every(value => value >= -1e-6) || sides.every(value => value <= 1e-6)) return true;
  }
  return false;
}

it.each([false, true])(
  'transforms a consumed source selected in Features before its downstream cut (copy: %s)',
  async withCopy => {
    const base = createCadPart('Base', 12),
      tool = createCadPart('Tool', 12);
    for (const [part, x, y, width, height] of [
      [base, 0, 0, 100, 100],
      [tool, 30, 30, 20, 20],
    ] as const) {
      part.sketch = addRectangle(part.sketch, { x, y, width, height, dimensioned: true, positioned: true });
      part.drawnOn = { on: { plane: 'top' }, offset: 0 };
    }
    if (withCopy) tool.copies = [{ id: 'tool-copy', offset: { position: [40, 0, 0], rotation: [0, 0, 0, 1] } }];
    const made = addPartCut({ ...createCadDocument(), parts: [base, tool] }, [tool.id], [base.id], { value: 0 }).document;
    made.partCuts![0]!.consumeTools = true;
    const source = (await solveCadDocument(made)).document;
    const before = structuredClone(source);
    sessions.push(source.id);
    expect(consumedTools(source).has(tool.id)).toBe(true);
    expect(topMaterial(source, base.id, 32.5, 40.5)).toBe(false);
    expect(topMaterial(source, base.id, 52.5, 40.5)).toBe(true);
    const change = vi.fn<(document: CadDocument) => void>();
    const latest = () => change.mock.calls.at(-1)?.[0] ?? source;
    render(
      <div style={{ height: 700, display: 'flex' }}>
        <CadEditor document={source} startIn3D onDraftChange={change} onFinish={() => {}} onCancel={() => {}} />
      </div>
    );
    await settled();
    expect(within(screen.getByRole('list', { name: 'Parts' })).queryByRole('button', { name: 'Tool' })).toBeNull();
    await userEvent.click(within(screen.getByRole('region', { name: 'Features' })).getByRole('button', { name: /Extrude · Tool/ }));
    const transform = await studioCommand(/Transform/);
    expect(transform).not.toHaveAttribute('aria-disabled', 'true');
    await userEvent.click(transform);
    let dialog = await screen.findByRole('dialog', { name: /^Transform/ });
    expect(screen.queryByRole('alert')).toBeNull();
    await userEvent.clear(within(dialog).getByRole('textbox', { name: 'X' }));
    await userEvent.type(within(dialog).getByRole('textbox', { name: 'X' }), '5');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(latest().parts.find(part => part.id === tool.id)?.moved).toBeUndefined();
    expect(latest().partCuts).toEqual(before.partCuts);

    await userEvent.click(await studioCommand(/Transform/));
    dialog = await screen.findByRole('dialog', { name: /^Transform/ });
    await userEvent.clear(within(dialog).getByRole('textbox', { name: 'X' }));
    await userEvent.type(within(dialog).getByRole('textbox', { name: 'X' }), '5');
    await userEvent.click(within(dialog).getByRole('button', { name: 'OK' }));
    await waitFor(() => expect(latest().parts.find(part => part.id === tool.id)?.moved).toEqual({ by: [5, 0, 0] }));
    await settled();
    expect(latest().parts.map(part => part.id)).toEqual(before.parts.map(part => part.id));
    const moved = latest().parts.find(part => part.id === tool.id)!;
    expect(moved.sketch).toEqual(tool.sketch);
    expect(moved.copies?.map(copy => ({ id: copy.id, offset: copy.offset }))).toEqual(
      before.parts.find(part => part.id === tool.id)?.copies?.map(copy => ({ id: copy.id, offset: copy.offset }))
    );
    expect(latest().partCuts).toEqual(before.partCuts);
    expect(consumedTools(latest()).has(tool.id)).toBe(true);
    expect(topMaterial(latest(), base.id, 32.5, 40.5)).toBe(true);
    expect(topMaterial(latest(), base.id, 52.5, 40.5)).toBe(false);
    if (withCopy) {
      expect(topMaterial(before, base.id, 72.5, 40.5)).toBe(false);
      expect(topMaterial(before, base.id, 92.5, 40.5)).toBe(true);
      expect(topMaterial(latest(), base.id, 72.5, 40.5)).toBe(true);
      expect(topMaterial(latest(), base.id, 92.5, 40.5)).toBe(false);
    }
    await userEvent.click(toolbar().getByRole('button', { name: /^Undo/ }));
    await waitFor(() => expect(latest().parts.find(part => part.id === tool.id)?.moved).toBeUndefined());
    expect(latest().partCuts).toEqual(before.partCuts);
    expect(topMaterial(latest(), base.id, 32.5, 40.5)).toBe(false);
    await userEvent.click(toolbar().getByRole('button', { name: /^Redo/ }));
    await waitFor(() => expect(latest().parts.find(part => part.id === tool.id)?.moved).toEqual({ by: [5, 0, 0] }));
    expect(topMaterial(latest(), base.id, 52.5, 40.5)).toBe(false);
  },
  30_000
);
