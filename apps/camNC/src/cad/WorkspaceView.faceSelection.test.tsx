import { cadFaceFrame, createPlateDocument, parseCadDocument, type CadDrawnOn } from '@wbcnc/cad';
import { act, cleanup, render } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { useState } from 'react';
import { ModelViewport } from '@/cam/model/ModelViewport';
import WorkspaceView from './WorkspaceView';
import studioText from '../../../../packages/cad-script/fixtures/designs/patterned-panel-face-selection.json?raw';

vi.mock('@/cam/model/ModelViewport', () => ({ ModelViewport: vi.fn(() => null) }));
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

it('changes faces on rapid clicks without opening a sketch, and highlights the selected face rather than the whole part', () => {
  const source = createPlateDocument({ width: 120, height: 80, thickness: 18 });
  source.parts[0]!.drawnOn = { on: { plane: 'top' }, offset: 0 };
  const id = source.parts[0]!.id,
    open = vi.fn();
  function Host() {
    const [face, setFace] = useState<Extract<CadDrawnOn['on'], { partId: string }> | null>(null);
    return (
      <WorkspaceView
        document={source}
        selectedId={id}
        selectedFace={face}
        onSelectFace={setFace}
        onSelect={() => {}}
        onOpen={open}
        choosing={false}
      />
    );
  }
  render(<Host />);
  const props = () => vi.mocked(ModelViewport).mock.lastCall![0];
  const index = props().instanceIds!.indexOf(id);
  const click = (face: 'top' | 'underside') => {
    const frame = cadFaceFrame(source, { partId: id, face });
    if ('error' in frame) throw new Error(frame.error);
    act(() => props().onSelect(id, index, { partId: id, index, point: frame.origin, normal: frame.normal }));
  };
  const now = vi.spyOn(Date, 'now').mockReturnValue(1000);
  click('top');
  now.mockReturnValue(1100);
  click('underside');
  expect(open).not.toHaveBeenCalled();
  expect(props().selectedIndexes).toEqual([]);
  expect(props().selectedFace).toMatchObject({ partId: id, index, normal: [0, 0, -1] });
  now.mockReturnValue(1200);
  click('underside');
  expect(open).toHaveBeenCalledOnce();
});

it('starts a sketch on the narrow edge face of the picked pattern instance', () => {
  const document = parseCadDocument(JSON.parse(studioText));
  const part = document.parts[0]!;
  const edge = part.sketch.entities.find(
    entity =>
      entity.type === 'line' &&
      !entity.construction &&
      part.sketch.entities.some(point => point.type === 'point' && point.id === entity.startId && point.x === 150 && point.y === 0)
  )!;
  const start = vi.fn();
  render(<WorkspaceView document={document} selectedId={part.id} onSelect={() => {}} onOpen={() => {}} onNewPart={start} choosing />);
  const props = vi.mocked(ModelViewport).mock.lastCall![0];
  const copy = part.copies![1]!;
  const index = props.instanceIds!.indexOf(`${part.id}/${copy.id}`);
  act(() => props.onPickFace!({ partId: part.id, index, point: [150, 300, 609.5], normal: [1, 0, 0] }));
  expect(start).toHaveBeenCalledWith({ partId: part.id, copyId: copy.id, face: { edge: edge.id } });
});
