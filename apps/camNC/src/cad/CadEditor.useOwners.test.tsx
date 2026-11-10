import { createCadDocument, createCadPart, createPlateDocument, addLine, type CadDocument } from '@wbcnc/cad';
import { endCadSession } from '@wbcnc/cad-editor/session';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import { userEvent } from '@vitest/browser/context';
import { afterEach, expect, it, vi } from 'vitest';
import { CadEditor } from './CadEditor';
import { solveCadDocument } from './solveCad';

const sessions: string[] = [];
afterEach(() => {
  cleanup();
  sessions.splice(0).forEach(endCadSession);
});

function fixture(overlap = false) {
  const source = createPlateDocument({ width: 100, height: 20, thickness: 18 }).parts[0]!;
  source.name = 'Source';
  source.placement = { position: [0, 0, 0], rotation: [0, 0, 0, 1] };
  source.copies = [{ id: 'copy', name: 'Picked copy', placement: { position: [overlap ? 0 : -100, 0, 0], rotation: [0, 0, 0, 1] } }];
  const target = createCadPart('Target');
  target.drawnOn = { on: { plane: 'front' }, offset: 0 };
  target.extrude = false;
  target.sketch = addLine(target.sketch, { x1: -180, y1: -40, x2: 180, y2: -40 });
  return { document: { ...createCadDocument(), parts: [source, target] }, source, target };
}

async function open(document: CadDocument) {
  const solved = (await solveCadDocument(document)).document;
  sessions.push(solved.id);
  const change = vi.fn<(document: CadDocument) => void>();
  render(
    <div style={{ height: 800, display: 'flex' }}>
      <CadEditor document={solved} startIn3D onDraftChange={change} onFinish={() => {}} onCancel={() => {}} />
    </div>
  );
  await screen.findByTestId('workspace-3d', {}, { timeout: 20_000 });
  await waitFor(() => expect(documentElement()).toHaveAttribute('aria-busy', 'false'), { timeout: 20_000 });
  await userEvent.dblClick(within(screen.getByRole('region', { name: 'Features' })).getByRole('button', { name: 'Sketch · Target' }));
  await screen.findByRole('dialog', { name: 'Sketch · Target' });
  screen.getByTestId('cad-canvas').focus();
  await userEvent.keyboard('nf');
  await waitFor(() => expect(window.document.querySelectorAll('.cad-part-edge').length).toBeGreaterThan(0), { timeout: 20_000 });
  return { latest: () => change.mock.calls.at(-1)?.[0] ?? solved };
}
const documentElement = () => window.document.querySelector('.cad-editor');
function topEdge(left: number, right: number) {
  const edge = [...window.document.querySelectorAll<SVGLineElement>('.cad-part-edge')].find(edge => {
    const xs = [Number(edge.getAttribute('x1')), Number(edge.getAttribute('x2'))].sort((a, b) => a - b);
    return xs[0] === left && xs[1] === right && Number(edge.getAttribute('y1')) === -18 && Number(edge.getAttribute('y2')) === -18;
  });
  expect(edge).toBeDefined();
  return edge!;
}
async function clickEdge(edge: SVGLineElement) {
  const svg = screen.getByTestId('cad-canvas') as unknown as SVGSVGElement,
    point = svg.createSVGPoint();
  point.x = (Number(edge.getAttribute('x1')) + Number(edge.getAttribute('x2'))) / 2;
  point.y = (Number(edge.getAttribute('y1')) + Number(edge.getAttribute('y2'))) / 2;
  const at = point.matrixTransform(edge.getScreenCTM()!),
    box = svg.getBoundingClientRect();
  // Horizontal SVG lines have zero-height DOM boxes. Click their real painted stroke through the full-size canvas.
  expect(window.document.elementFromPoint(at.x, at.y)).toBe(edge);
  await userEvent.click(svg, { position: { x: at.x - box.left, y: at.y - box.top } });
}

it('carries a picked copy through the actual sketch backdrop and keeps its two imported endpoints on that copy', async () => {
  const { document, source, target } = fixture(),
    original = JSON.stringify(document);
  const { latest } = await open(document);
  const before = structuredClone(latest());
  await userEvent.keyboard('u');
  expect(topEdge(-100, 0)).toHaveAttribute('data-part-copy', 'copy');
  await clickEdge(topEdge(-100, 0));
  const references = () =>
    latest()
      .parts.find(part => part.id === target.id)!
      .sketch.entities.flatMap(entity => (entity.type === 'point' && entity.used ? [entity.used] : []));
  await waitFor(() => expect(references()).toHaveLength(2));
  expect(references().every(reference => reference.partId === source.id && reference.copyId === 'copy')).toBe(true);
  expect(latest().parts.find(part => part.id === source.id)).toEqual(before.parts.find(part => part.id === source.id));
  expect(latest().parts.map(part => part.id)).toEqual(before.parts.map(part => part.id));
  expect(JSON.stringify(document)).toBe(original);
}, 40_000);

it('refuses an ambiguous projected copy without a source edit and can recover by hiding the other physical instance', async () => {
  const { document, source, target } = fixture(true),
    original = JSON.stringify(document);
  const { latest } = await open(document);
  const before = JSON.stringify(latest());
  await userEvent.keyboard('u');
  expect(topEdge(0, 100)).toHaveAttribute('data-part-ambiguous');
  await clickEdge(topEdge(0, 100));
  await waitFor(() => expect(screen.getByText(/Use: this projection has more than one possible part or copy source/)).toBeVisible());
  expect(JSON.stringify(latest())).toBe(before);
  await userEvent.click(within(screen.getByRole('region', { name: 'Parts panel' })).getByRole('button', { name: 'Hide Source' }));
  await waitFor(() =>
    expect(within(screen.getByRole('region', { name: 'Parts panel' })).getByRole('button', { name: 'Show Source' })).toBeVisible()
  );
  await waitFor(() => expect(topEdge(0, 100)).toHaveAttribute('data-part-copy', 'copy'));
  await clickEdge(topEdge(0, 100));
  const references = () =>
    latest()
      .parts.find(part => part.id === target.id)!
      .sketch.entities.flatMap(entity => (entity.type === 'point' && entity.used ? [entity.used] : []));
  await waitFor(() => expect(references()).toHaveLength(2));
  expect(references().every(reference => reference.partId === source.id && reference.copyId === 'copy')).toBe(true);
  expect(screen.queryByText(/Use: this projection has more than one possible part or copy source/)).toBeNull();
  expect(JSON.stringify(document)).toBe(original);
}, 40_000);
