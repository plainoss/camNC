import { createPlateDocument, addFaceSketch, cadFaceFrame, faceSketchDocument, type CadDocument } from '@wbcnc/cad';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { userEvent } from '@vitest/browser/context';
import { afterEach, expect, it, vi } from 'vitest';
import { useState } from 'react';
import { OrthographicCamera, Vector3 } from 'three';
import { CadEditor } from './CadEditor';
import { ModelViewport } from '@/cam/model/ModelViewport';
vi.mock('@/cam/model/ModelViewport', { spy: true });
import type { FaceSketchScene } from './faceSketchScene';
import type { StudioCameraRef } from './studioCamera';
import { endCadSession } from '@wbcnc/cad-editor/session';

afterEach(cleanup);

it.each(['create', 'reopen', 'reopen-studio'])(
  'keeps the 3D view through face sketch %s and returning to 3D',
  async mode => {
    let source = createPlateDocument({ width: 120, height: 80, thickness: 18 });
    if (mode === 'reopen-studio') source.parts[0]!.drawnOn = { on: { plane: 'front' }, offset: 0 };
    if (mode !== 'create') source = addFaceSketch(source, source.parts[0]!.id, 'top').document;
    const camera: StudioCameraRef = { current: null };
    const visibleCamera = () =>
      mode === 'reopen-studio'
        ? vi.mocked(ModelViewport).mock.calls.findLast(([props]) => props.cameraState)?.[0].cameraState?.current
        : camera.current;
    let carried = camera.current;
    let editedId = '';
    function Host() {
      const [returned, setReturned] = useState(false);
      const [edit, setEdit] = useState<{ document: CadDocument; scene?: FaceSketchScene } | null>(null);
      return (
        <div style={{ height: 700, display: 'flex' }}>
          {edit ? (
            <CadEditor
              key="face"
              document={edit.document}
              faceSketch={{
                outline: [
                  { x: 0, y: 0 },
                  { x: 120, y: 0 },
                  { x: 120, y: 80 },
                  { x: 0, y: 80 },
                ],
                label: 'Top face',
                scene: edit.scene,
              }}
              onDraftChange={() => {}}
              onFinish={() => {
                setReturned(true);
                setEdit(null);
              }}
              onCancel={() => {
                setReturned(true);
                setEdit(null);
              }}
            />
          ) : (
            <CadEditor
              key="part"
              document={source}
              startIn3D={mode === 'reopen-studio' && !returned ? true : 'part'}
              partCameraState={camera}
              onDraftChange={() => {}}
              onFinish={() => {}}
              onCancel={() => {}}
              onEditFaceSketch={(document, partId, sketchId, scene) => {
                carried = scene?.cameraState.current ? structuredClone(scene.cameraState.current) : null;
                const documentForFace = faceSketchDocument(document, partId, sketchId);
                editedId = documentForFace.id;
                setEdit({ document: documentForFace, scene });
              }}
            />
          )}
        </div>
      );
    }
    render(<Host />);
    try {
      await waitFor(() => expect(visibleCamera()?.height).toBeGreaterThan(0), { timeout: 20000 });
      const before = structuredClone(visibleCamera()!);
      const canvas = screen.getByTestId(mode === 'reopen-studio' ? 'workspace-3d' : 'part-3d').querySelector('canvas')!;
      const box = canvas.getBoundingClientRect(),
        width = (before.height * box.width) / box.height;
      const projection = new OrthographicCamera(-width / 2, width / 2, before.height / 2, -before.height / 2, 1, 40000);
      projection.position.set(...before.center).addScaledVector(new Vector3(...before.back), 20000);
      projection.up.set(...before.up);
      projection.lookAt(...before.center);
      projection.updateMatrixWorld();
      const projected = (x: number, y: number) => {
        // The authored Front-plane panel is 18 mm toward -Y, with its sketch Y along world Z.
        const point = (mode === 'reopen-studio' ? new Vector3(x, -18, y) : new Vector3(x, y, 18)).project(projection);
        return { x: box.left + ((point.x + 1) * box.width) / 2, y: box.top + ((1 - point.y) * box.height) / 2 };
      };
      if (mode === 'create') {
        const at = projected(60, 40);
        await userEvent.click(canvas, { position: { x: at.x - box.left, y: at.y - box.top } });
        await userEvent.click(screen.getByRole('button', { name: 'Sketch on top' }));
      } else if (mode === 'reopen') await userEvent.click(screen.getByRole('button', { name: 'Edit' }));
      else await userEvent.dblClick(screen.getByRole('button', { name: /^Sketch on the top/ }));
      const drawing = await screen.findByTestId('cad-drawing');
      await waitFor(() => {
        for (const [x, y] of [
          [0, 0],
          [60, 40],
        ]) {
          const point = new DOMPoint(x, -y).matrixTransform((drawing as unknown as SVGGraphicsElement).getScreenCTM()!);
          expect(point.x).toBeCloseTo(projected(x!, y!).x, 0);
          expect(point.y).toBeCloseTo(projected(x!, y!).y, 0);
        }
      });
      await waitFor(() => expect(document.querySelector('.cad-sketch-backdrop canvas')).not.toBeNull(), { timeout: 10000 });
      await userEvent.click(screen.getByRole('button', { name: '✓ Finish sketch' }));
      await screen.findByTestId('part-3d');
      await waitFor(() => {
        expect(camera.current!.height).toBeCloseTo(carried!.height, 6);
        camera.current!.back.forEach((value, axis) => expect(value).toBeCloseTo(carried!.back[axis]!, 6));
      });
    } finally {
      cleanup();
      endCadSession(source.id);
      if (editedId) endCadSession(editedId);
    }
  },
  30000
);

it('selects a side face in the per-part view and starts its studio sketch without changing the picture', async () => {
  const source = createPlateDocument({ width: 120, height: 80, thickness: 18 });
  source.parts[0]!.drawnOn = { on: { plane: 'front' }, offset: 0 };
  const id = source.parts[0]!.id;
  const camera: StudioCameraRef = { current: null };
  let latest = source;
  render(
    <div style={{ height: 700, display: 'flex' }}>
      <CadEditor
        document={source}
        startIn3D="part"
        partCameraState={camera}
        onDraftChange={doc => {
          latest = doc;
        }}
        onFinish={() => {}}
        onCancel={() => {}}
        onEditFaceSketch={() => {}}
      />
    </div>
  );
  try {
    await waitFor(() => expect(camera.current?.height).toBeGreaterThan(0), { timeout: 20000 });
    const before = structuredClone(camera.current!);
    const canvas = screen.getByTestId('part-3d').querySelector('canvas')!,
      box = canvas.getBoundingClientRect();
    const width = (before.height * box.width) / box.height;
    const projection = new OrthographicCamera(-width / 2, width / 2, before.height / 2, -before.height / 2, 1, 40000);
    projection.position.set(...before.center).addScaledVector(new Vector3(...before.back), 20000);
    projection.up.set(...before.up);
    projection.lookAt(...before.center);
    projection.updateMatrixWorld();
    const at = new Vector3(120, 40, 9).project(projection);
    await userEvent.click(canvas, { position: { x: ((at.x + 1) * box.width) / 2, y: ((1 - at.y) * box.height) / 2 } });
    await userEvent.click(screen.getByRole('button', { name: 'Sketch on side face' }));
    const drawing = await screen.findByTestId('cad-drawing');
    await waitFor(() => expect(latest.parts).toHaveLength(2));
    const on = latest.parts[1]!.drawnOn!.on;
    expect(on).toMatchObject({ partId: id, face: { edge: expect.any(String) } });
    const local = cadFaceFrame({ ...source, parts: [{ ...source.parts[0]!, drawnOn: undefined, placement: undefined }] }, on);
    if ('error' in local) throw new Error(local.error);
    await waitFor(() => {
      for (const [x, y] of [
        [0, 0],
        [30, 9],
      ]) {
        const expected = new Vector3(...local.origin)
          .addScaledVector(new Vector3(...local.x), x!)
          .addScaledVector(new Vector3(...local.y), y!)
          .project(projection);
        const point = new DOMPoint(x, -y!).matrixTransform((drawing as unknown as SVGGraphicsElement).getScreenCTM()!);
        expect(point.x).toBeCloseTo(box.left + ((expected.x + 1) * box.width) / 2, 0);
        expect(point.y).toBeCloseTo(box.top + ((1 - expected.y) * box.height) / 2, 0);
      }
    });
  } finally {
    cleanup();
    endCadSession(source.id);
  }
}, 30000);
