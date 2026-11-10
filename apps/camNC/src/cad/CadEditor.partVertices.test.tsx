import { extrudedSketch } from './editorHelpers';
import { addLine, createCadDocument, createCadPart, createPlateDocument, withUsedPoints, type CadDocument } from '@wbcnc/cad';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import { userEvent } from '@vitest/browser/context';
import { afterEach, expect, it, vi } from 'vitest';
import { endCadSession } from '@wbcnc/cad-editor/session';
import { CadEditor } from './CadEditor';

const sessions: string[] = [];
afterEach(() => {
  cleanup();
  sessions.splice(0).forEach(endCadSession);
});

it('uses visible vertices on the top plane, by selecting then U and by U then clicking, and follows the source', async () => {
  const side = createPlateDocument({ width: 300, height: 600, thickness: 19 }).parts[0]!;
  side.drawnOn = { on: { plane: 'front' }, offset: 0 };
  const next = createCadPart('Next');
  next.drawnOn = { on: { plane: 'top' }, offset: 0 };
  next.sketch = addLine(next.sketch, { x1: -30, y1: -40, x2: 330, y2: -40 });
  const source: CadDocument = { ...createCadDocument(), parts: [side, next] };
  sessions.push(source.id);
  const change = vi.fn<(document: CadDocument) => void>();
  render(
    <div style={{ height: 700, display: 'flex' }}>
      <CadEditor document={source} startIn3D onDraftChange={change} onFinish={() => {}} onCancel={() => {}} />
    </div>
  );
  const latest = () => change.mock.calls.at(-1)?.[0] ?? source;
  await waitFor(() => expect(document.querySelector('.cad-editor')?.getAttribute('aria-busy')).toBe('false'), { timeout: 20000 });
  await userEvent.dblClick(within(await screen.findByRole('region', { name: 'Features' })).getByRole('button', { name: /Sketch · Next/ }));
  await screen.findByRole('dialog', { name: 'Sketch · Next' });
  screen.getByTestId('cad-canvas').focus();
  await userEvent.keyboard('nf');
  await waitFor(() => expect(document.querySelectorAll('[data-part-vertex]').length).toBe(4), { timeout: 10000 });
  const vertices = [...document.querySelectorAll<SVGCircleElement>('[data-part-vertex]')];
  const vertex = vertices.find(vertex => Number(vertex.getAttribute('cx')) === 300 && Number(vertex.getAttribute('cy')) === 0)!;
  await userEvent.click(vertex);
  await waitFor(() => expect(vertex.classList.contains('is-picked')).toBe(true));
  await userEvent.keyboard('u');
  const points = () => latest().parts[1]!.sketch.entities.filter(entity => entity.type === 'point' && entity.used);
  await waitFor(() => expect(points()).toHaveLength(1));
  expect(points()[0]).toMatchObject({ x: 300, y: 0, fixed: true, standalone: true, used: { partId: side.id } });
  // The other row is projected from a face off the sketch plane and remains usable in the normal view.
  await userEvent.keyboard('u');
  const other = vertices.find(candidate => Number(candidate.getAttribute('cx')) === 300 && Number(candidate.getAttribute('cy')) !== 0)!;
  await userEvent.click(other);
  await waitFor(() => expect(points()).toHaveLength(2));
  await userEvent.keyboard('{Escape}');
  expect(latest().parts[1]!.sketch.entities.filter(entity => entity.type === 'line')).toHaveLength(1);
  const changed = latest();
  const grown = {
    ...changed.parts[0]!,
    thickness: 25,
    sketch: {
      ...side.sketch,
      entities: side.sketch.entities.map(entity => (entity.type === 'point' && entity.x === 300 ? { ...entity, x: 350 } : entity)),
    },
  };
  const updated = withUsedPoints({ ...changed, parts: [grown, changed.parts[1]!] }, changed.parts[1]!);
  expect(updated.entities.flatMap(entity => (entity.type === 'point' && entity.used ? [[entity.x, entity.y]] : []))).toEqual(
    expect.arrayContaining([
      [350, 0],
      [350, -25],
    ])
  );
}, 60_000);

it('starts an extrusion from a copy-face sketch as a new part instead of adding to the source family', () => {
  const source = createPlateDocument({ width: 300, height: 600, thickness: 19 }).parts[0]!;
  const child = createPlateDocument({ width: 80, height: 40, thickness: 19 }).parts[0]!;
  child.drawnOn = { on: { partId: source.id, copyId: 'copy', face: 'top' }, offset: 0 };
  child.extrude = false;
  const document = { ...createCadDocument(), parts: [source, child] };
  expect(extrudedSketch(document, child, true).addTo).toBeUndefined();
});
