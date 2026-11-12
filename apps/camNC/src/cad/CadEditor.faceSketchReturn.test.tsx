import { addFaceSketch, createPlateDocument } from '@wbcnc/cad';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import { userEvent } from '@vitest/browser/context';
import { afterEach, expect, it, vi } from 'vitest';
import { CadEditor } from './CadEditor';
import { endCadSession } from '@wbcnc/cad-editor/session';

const sessions: string[] = [];
afterEach(() => {
  cleanup();
  sessions.splice(0).forEach(endCadSession);
});

/** A plate on the top plane with a sketch on its top face. */
function plateWithFaceSketch() {
  const source = createPlateDocument({ width: 120, height: 80, thickness: 18 });
  source.parts[0]!.drawnOn = { on: { plane: 'top' }, offset: 0 };
  const added = addFaceSketch(source, source.parts[0]!.id, 'top');
  const document = added.document;
  const stepId = document.parts[0]!.features!.find(f => f.type === 'sketch' && f.sketch.id === added.sketchId)!.id;
  sessions.push(document.id);
  return { document, partId: document.parts[0]!.id, sketchId: added.sketchId, stepId };
}

it('says a face sketch opened from the Part Studio’s feature list came from there', async () => {
  const { document: source, partId, sketchId } = plateWithFaceSketch();
  const edit = vi.fn();
  render(
    <div style={{ height: 700, display: 'flex' }}>
      <CadEditor document={source} startIn3D onDraftChange={() => {}} onFinish={() => {}} onCancel={() => {}} onEditFaceSketch={edit} />
    </div>
  );
  // A face sketch opens only once the design's sketches are checked.
  await waitFor(
    () => {
      expect(document.querySelector('.cad-editor')!.getAttribute('aria-busy')).toBe('false');
      expect(document.querySelector('.cad-status')!.textContent).not.toContain('Checking sketch');
    },
    { timeout: 20_000 }
  );
  const features = await screen.findByRole('region', { name: 'Features' });
  await userEvent.dblClick(within(features).getByRole('button', { name: /^Sketch on the top/ }));
  await waitFor(() => expect(edit).toHaveBeenCalledOnce());
  expect(edit.mock.calls[0]!.slice(1, 3)).toEqual([partId, sketchId]);
  expect(edit.mock.calls[0]![4]).toBe(true);
});

it('opens the Part Studio with a step selected, such as a face sketch just finished', async () => {
  const { document, stepId } = plateWithFaceSketch();
  render(
    <div style={{ height: 700, display: 'flex' }}>
      <CadEditor
        document={document}
        startIn3D
        selectedStepId={stepId}
        onDraftChange={() => {}}
        onFinish={() => {}}
        onCancel={() => {}}
        onEditFaceSketch={vi.fn()}
      />
    </div>
  );
  expect(await screen.findByRole('toolbar', { name: 'Part Studio toolbar' })).toBeDefined();
  const features = screen.getByRole('region', { name: 'Features' });
  const row = within(features).getByRole('button', { name: /^Sketch on the top/ });
  expect(row.getAttribute('aria-current')).toBe('true');
  expect(within(features).getAllByRole('button', { current: true })).toEqual([row]);
});
