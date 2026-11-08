import { createCadDocument, createCadPart, createPlateDocument, pointEquivalence, type CadDocument, type CadLineEntity } from '@wbcnc/cad';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { userEvent } from '@vitest/browser/context';
import { afterEach, expect, it, vi } from 'vitest';
import { CadEditor } from './CadEditor';
import { endCadSession } from './session';

const sessions: string[] = [];
afterEach(() => {
  cleanup();
  sessions.splice(0).forEach(endCadSession);
});
const settled = () =>
  waitFor(
    () => {
      expect(screen.queryByText(/^Checking sketch/)).toBeNull();
      expect(document.querySelector('.cad-editor')!.getAttribute('aria-busy')).toBe('false');
    },
    { timeout: 20_000 }
  );

it('ties a part drawn on a face to that face’s edges when it is drawn onto them, and keeps the edges', async () => {
  const bottom = { ...createPlateDocument({ width: 100, height: 60 }).parts[0]!, name: 'Bottom' };
  const top = { ...createCadPart('Top'), drawnOn: { on: { partId: bottom.id, face: 'top' as const }, offset: 0 } };
  const source: CadDocument = { ...createCadDocument(), parts: [top, bottom] };
  sessions.push(source.id);
  const change = vi.fn<(document: CadDocument) => void>();
  render(
    <div style={{ height: 700 }}>
      <CadEditor document={source} onDraftChange={change} onFinish={() => {}} onCancel={() => {}} />
    </div>
  );
  await settled();
  const canvas = screen.getByTestId('cad-canvas') as unknown as SVGSVGElement;
  const latest = () => change.mock.calls.at(-1)?.[0].parts.find(part => part.id === top.id)!.sketch ?? top.sketch;
  const click = async (x: number, y: number) => {
    const client = new DOMPoint(x, -y).matrixTransform(canvas.getScreenCTM()!),
      bounds = canvas.getBoundingClientRect();
    await userEvent.click(canvas, { position: { x: client.x - bounds.left, y: client.y - bounds.top } });
    await settled();
  };
  // The bottom's outline is in the sketch as the face's edges, shown like the face.
  await waitFor(() => expect(canvas.querySelectorAll('g.cad-entity[data-entity-id*=":face:"] title')).toHaveLength(4));
  expect(canvas.querySelector('g.cad-entity[data-entity-id*=":face:"] title')!.textContent).toBe('line (face edge)');
  // The face's edges can't be deleted.
  await click(50, 60);
  await userEvent.keyboard('{Delete}');
  await settled();
  expect(latest().entities.filter(e => e.faceEdge)).toHaveLength(8);
  expect(screen.getByText('The edges of the face this part is drawn on stay. Draw onto them so the part follows that face.')).toBeDefined();

  await userEvent.keyboard('g');
  await click(0, 0);
  await click(100, 60);
  await userEvent.keyboard('{Escape}{Escape}');
  await settled();
  const sketch = latest();
  const edges = sketch.entities.filter((e): e is CadLineEntity => e.type === 'line' && !e.construction);
  expect(edges).toHaveLength(4);
  const faceCorners = sketch.entities.filter(e => e.type === 'point' && e.faceEdge).map(e => e.id);
  const same = pointEquivalence(sketch.constraints);
  const tied = (id: string) => faceCorners.some(corner => corner === id || same.equivalent(id, corner));
  // Both clicked corners are held to the face's corners, so the part follows them.
  expect(edges.flatMap(e => [e.startId, e.endId]).filter(tied).length).toBeGreaterThanOrEqual(2);

  // Select all takes the drawing, not the face's edges, so it can all be moved.
  await userEvent.keyboard('{Control>}a{/Control}');
  await waitFor(() =>
    expect(canvas.querySelector(`g.cad-entity[data-entity-id="${edges[0]!.id}"] [data-visible-curve]`)!.getAttribute('stroke')).toBe(
      '#ff9b23'
    )
  );
  for (const face of canvas.querySelectorAll('g.cad-entity[data-entity-id*=":face:"] [data-visible-curve]'))
    expect(face.getAttribute('stroke')).toBe('#7f8c96');
});
