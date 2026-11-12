import { addFaceSketch, addLine, createPlateDocument, type CadDocument } from '@wbcnc/cad';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import { userEvent } from '@vitest/browser/context';
import { useState } from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import { CadEditor } from './CadEditor';
import { endCadSession } from '@wbcnc/cad-editor/session';
import type { StudioCameraRef, StudioCameraState } from './studioCamera';
import { ModelViewport } from '@/cam/model/ModelViewport';

vi.mock('@/cam/model/ModelViewport', { spy: true });

const sessions: string[] = [];
afterEach(() => {
  cleanup();
  sessions.splice(0).forEach(endCadSession);
});

/** A plate on the top plane with a sketch holding one line on its top face. */
function plateWithFaceSketch() {
  const source = createPlateDocument({ width: 120, height: 80, thickness: 18 });
  source.parts[0]!.drawnOn = { on: { plane: 'top' }, offset: 0 };
  const added = addFaceSketch(source, source.parts[0]!.id, 'top');
  const document: CadDocument = {
    ...added.document,
    parts: added.document.parts.map(part => ({
      ...part,
      features: part.features?.map(f =>
        f.type === 'sketch' && f.sketch.id === added.sketchId ? { ...f, sketch: addLine(f.sketch, { x1: 10, y1: 10, x2: 60, y2: 10 }) } : f
      ),
    })),
  };
  const stepId = document.parts[0]!.features!.find(f => f.type === 'sketch' && f.sketch.id === added.sketchId)!.id;
  sessions.push(document.id);
  return { document, partId: document.parts[0]!.id, sketchId: added.sketchId, stepId };
}

// A face sketch opens only once the design's sketches are checked.
const checked = () =>
  waitFor(
    () => {
      expect(document.querySelector('.cad-editor')!.getAttribute('aria-busy')).toBe('false');
      expect(document.querySelector('.cad-status')!.textContent).not.toContain('Checking sketch');
    },
    { timeout: 20_000 }
  );

/** Right-drags the studio view to orbit it, and waits for the orbit to settle. */
async function orbit(camera: StudioCameraRef) {
  const canvas = await waitFor(() => screen.getByTestId('workspace-3d').querySelector('canvas')!, { timeout: 20_000 });
  await waitFor(() => expect(camera.current?.height).toBeGreaterThan(0), { timeout: 20_000 });
  const before = structuredClone(camera.current!);
  vi.spyOn(canvas, 'setPointerCapture').mockImplementation(() => {});
  const box = canvas.getBoundingClientRect(),
    x = box.left + box.width * 0.7,
    y = box.top + box.height * 0.6;
  const pointer = (type: string, factor: number, buttons: number) =>
    canvas.dispatchEvent(
      new PointerEvent(type, {
        bubbles: true,
        pointerId: 1,
        pointerType: 'mouse',
        button: 2,
        buttons,
        clientX: x + 120 * factor,
        clientY: y + 40 * factor,
      })
    );
  pointer('pointerdown', 0, 2);
  pointer('pointermove', 0.5, 2);
  pointer('pointermove', 1, 2);
  pointer('pointerup', 1, 0);
  await waitFor(() => expect(camera.current!.back).not.toEqual(before.back));
  // Damping must have settled before the view is compared with the one after the round trip.
  let previous = structuredClone(camera.current!);
  await waitFor(
    async () => {
      await new Promise(resolve => requestAnimationFrame(resolve));
      const next = structuredClone(camera.current!),
        drift = Math.hypot(...next.back.map((n, i) => n - previous.back[i]!));
      previous = next;
      expect(drift).toBeLessThan(1e-8);
    },
    { timeout: 10_000 }
  );
  return previous;
}

it('goes back to the Part Studio from a face sketch opened there, with its step selected and the view as it was', async () => {
  const { document: source, partId, sketchId, stepId } = plateWithFaceSketch();
  const camera: StudioCameraRef = { current: null };
  const edit = vi.fn();
  // The host shows the face sketch in place of the studio, and opens the studio again when it's finished, as the design
  // route does.
  function Host() {
    const [phase, setPhase] = useState<'studio' | 'face' | 'back'>('studio');
    return (
      <div style={{ height: 700, display: 'flex' }}>
        {phase === 'face' ? (
          <button type="button" onClick={() => setPhase('back')}>
            Finish face sketch
          </button>
        ) : (
          <CadEditor
            key={phase}
            document={source}
            startIn3D
            studioCameraState={camera}
            {...(phase === 'back' && { selectedStepId: stepId })}
            onDraftChange={() => {}}
            onFinish={() => {}}
            onCancel={() => {}}
            onEditFaceSketch={(...args) => {
              edit(...args);
              setPhase('face');
            }}
          />
        )}
      </div>
    );
  }
  render(<Host />);
  await checked();
  const orbited: StudioCameraState = await orbit(camera);
  const features = screen.getByRole('region', { name: 'Features' });
  await userEvent.dblClick(within(features).getByRole('button', { name: /^Sketch on the top/ }));
  await waitFor(() => expect(edit).toHaveBeenCalledOnce());
  expect(edit.mock.calls[0]!.slice(1, 3)).toEqual([partId, sketchId]);
  expect(edit.mock.calls[0]![4]).toBe(true);

  await userEvent.click(screen.getByRole('button', { name: 'Finish face sketch' }));
  expect(await screen.findByRole('toolbar', { name: 'Part Studio toolbar' })).toBeDefined();
  const row = within(screen.getByRole('region', { name: 'Features' })).getByRole('button', { name: /^Sketch on the top/ });
  expect(row.getAttribute('aria-current')).toBe('true');
  expect(within(screen.getByRole('region', { name: 'Features' })).getAllByRole('button', { current: true })).toEqual([row]);
  // The view comes back as it was orbited, not fitted again.
  await waitFor(() => expect(screen.getByTestId('workspace-3d').querySelector('canvas')).not.toBeNull());
  for (let frame = 0; frame < 10; frame++) await new Promise(resolve => requestAnimationFrame(resolve));
  // What the studio view shows, whichever camera it keeps.
  const shown = () => vi.mocked(ModelViewport).mock.calls.findLast(([props]) => props.cameraState)![0].cameraState!.current!;
  expect(shown().height).toBeCloseTo(orbited.height, 6);
  shown().back.forEach((value, axis) => expect(value).toBeCloseTo(orbited.back[axis]!, 6));
  shown().center.forEach((value, axis) => expect(value).toBeCloseTo(orbited.center[axis]!, 6));
});
