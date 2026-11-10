import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { createPlateDocument } from '@wbcnc/cad';
import { afterEach, expect, it, vi } from 'vitest';
import { ModelViewport, type ModelFacePick } from '@/cam/model/ModelViewport';
import WorkspaceView from './WorkspaceView';

vi.mock('@/cam/model/ModelViewport', () => ({ ModelViewport: vi.fn(() => null) }));
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const viewport = () => vi.mocked(ModelViewport).mock.lastCall![0];
function setup() {
  const document = createPlateDocument({ width: 100, height: 60, thickness: 18 });
  const partId = document.parts[0]!.id,
    onSelect = vi.fn(),
    onOpen = vi.fn(),
    onNewPart = vi.fn(),
    onPickPoint = vi.fn();
  const props = { document, selectedId: null, selectedPlane: 'top', choosing: false, onSelect, onOpen, onNewPart };
  const view = render(<WorkspaceView {...props} />);
  fireEvent.click(screen.getByRole('button', { name: 'Section view' }));
  fireEvent.change(screen.getByRole('textbox', { name: 'Offset' }), { target: { value: '9mm' } });
  expect(viewport().sectionCaps![0]!.count).toBeGreaterThan(0);
  fireEvent.click(screen.getByRole('button', { name: 'Confirm section view' }));
  return { document, partId, props, view, onSelect, onOpen, onNewPart, onPickPoint };
}

it('keeps section caps out of persistent point and edge inputs while retaining valid model picks', async () => {
  const { document, partId, props, view, onPickPoint, onSelect, onOpen } = setup();
  const before = JSON.stringify(document);
  await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Section view' })).toBeNull());
  view.rerender(<WorkspaceView {...props} measurementEnabled={false} onPickPoint={onPickPoint} />);
  expect(viewport().onMeasurePick).toBeUndefined();
  expect(viewport().sectionCaps![0]!.count).toBeGreaterThan(0);
  const cap: ModelFacePick = {
    partId,
    index: 0,
    point: [50, 30, 9],
    normal: [0, 0, 1],
    sectionCap: true,
    edge: { a: [0, 0, 9], b: [100, 0, 9] },
  };
  act(() => viewport().onSelect(partId, 0, cap));
  expect(onPickPoint).not.toHaveBeenCalled();
  expect(onSelect).not.toHaveBeenCalled();
  expect(onOpen).not.toHaveBeenCalled();
  expect(screen.getByRole('status').textContent).toMatch(/section surface is temporary/);
  const edge = { a: [0, 0, 0] as [number, number, number], b: [0, 0, 18] as [number, number, number] };
  act(() => viewport().onSelect(partId, 0, { partId, index: 0, point: [0, 0, 0], normal: [0, -1, 0], edge }));
  expect(onPickPoint).toHaveBeenCalledExactlyOnceWith({ partId, point: [0, 0, 0], normal: [0, -1, 0], copy: false, edge });
  expect(JSON.stringify(document)).toBe(before);
});

it('keeps cap faces out of new sketches and supplies the unclipped source mesh to persistent picks', async () => {
  const { document, partId, props, view, onNewPart } = setup();
  const before = JSON.stringify(document);
  await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Section view' })).toBeNull());
  view.rerender(<WorkspaceView {...props} choosing measurementEnabled={false} />);
  const shown = viewport().meshes[0]!,
    source = viewport().sourceMeshes![0]!;
  expect(Math.max(...Array.from(shown.indices, index => shown.positions[index * 3 + 2]!))).toBe(9);
  expect(Math.max(...Array.from(source.indices, index => source.positions[index * 3 + 2]!))).toBe(18);
  act(() => viewport().onPickFace!({ partId, index: 0, point: [50, 30, 9], normal: [0, 0, 1], sectionCap: true }));
  expect(onNewPart).not.toHaveBeenCalled();
  act(() => viewport().onPickFace!({ partId, index: 0, point: [50, 30, 0], normal: [0, 0, -1] }));
  expect(onNewPart).toHaveBeenCalledExactlyOnceWith({ partId, face: 'underside' });
  expect(JSON.stringify(document)).toBe(before);
});

it('gives mirror inputs priority on the first render while a section face pick is still being closed', () => {
  const { document, partId, props, view, onNewPart } = setup();
  const before = JSON.stringify(document),
    onSelectFace = vi.fn();
  fireEvent.click(screen.getByRole('button', { name: 'Edit section view' }));
  fireEvent.click(screen.getByRole('button', { name: 'Pick planar face' }));
  const nextCall = vi.mocked(ModelViewport).mock.calls.length;
  view.rerender(<WorkspaceView {...props} pickingMirrorPlane onSelectFace={onSelectFace} />);
  // The feature must own even the render before the section's disabling effect has cleared its old picker state.
  const first = vi.mocked(ModelViewport).mock.calls[nextCall]![0];
  expect(first.onMeasurePick).toBeUndefined();
  expect(screen.getByRole('button', { name: 'Measure' })).toBeDisabled();
  expect(first.sectionControl).toBeNull();
  expect(viewport().sectionCaps![0]!.count).toBeGreaterThan(0);
  act(() => first.onPickFace!({ partId, index: 0, point: [50, 30, 9], normal: [0, 0, 1], sectionCap: true }));
  expect(onSelectFace).not.toHaveBeenCalled();
  act(() => first.onPickFace!({ partId, index: 0, point: [50, 30, 0], normal: [0, 0, -1] }));
  expect(onSelectFace).toHaveBeenCalledExactlyOnceWith({ partId, face: 'underside' });
  expect(onNewPart).not.toHaveBeenCalled();
  expect(JSON.stringify(document)).toBe(before);
});

it.each(['face', 'plane'] as const)('gives new-sketch %s picks priority on the first render after a section picker', kind => {
  const { document, partId, props, view, onNewPart } = setup();
  const before = JSON.stringify(document);
  fireEvent.click(screen.getByRole('button', { name: 'Edit section view' }));
  fireEvent.click(screen.getByRole('button', { name: 'Pick planar face' }));
  const nextCall = vi.mocked(ModelViewport).mock.calls.length;
  view.rerender(<WorkspaceView {...props} choosing measurementEnabled={false} />);
  const first = vi.mocked(ModelViewport).mock.calls[nextCall]![0];
  expect(first.onMeasurePick).toBeUndefined();
  if (kind === 'face') {
    act(() => first.onPickFace!({ partId, index: 0, point: [50, 30, 9], normal: [0, 0, 1], sectionCap: true }));
    expect(onNewPart).not.toHaveBeenCalled();
    act(() => first.onPickFace!({ partId, index: 0, point: [50, 30, 0], normal: [0, 0, -1] }));
    expect(onNewPart).toHaveBeenCalledExactlyOnceWith({ partId, face: 'underside' });
  } else {
    act(() => first.onPickPlane!('front'));
    expect(onNewPart).toHaveBeenCalledExactlyOnceWith({ plane: 'front' }, undefined);
  }
  expect(first.sectionControl).toBeNull();
  expect(first.sectionCaps![0]!.count).toBeGreaterThan(0);
  expect(JSON.stringify(document)).toBe(before);
});

it('gives mate inputs priority on the first render after a section face picker', () => {
  const { document, partId, props, view, onPickPoint, onSelect, onOpen } = setup();
  const before = JSON.stringify(document);
  fireEvent.click(screen.getByRole('button', { name: 'Edit section view' }));
  fireEvent.click(screen.getByRole('button', { name: 'Pick planar face' }));
  const nextCall = vi.mocked(ModelViewport).mock.calls.length;
  view.rerender(<WorkspaceView {...props} onPickPoint={onPickPoint} />);
  const first = vi.mocked(ModelViewport).mock.calls[nextCall]![0];
  expect(first.pickingConnector).toBe(true);
  expect(first.onPickFace).toBeUndefined();
  expect(first.onMeasurePick).toBeUndefined();
  expect(first.sectionControl).toBeNull();
  expect(first.sectionCaps![0]!.count).toBeGreaterThan(0);
  expect(screen.getByRole('button', { name: 'Measure' })).toBeDisabled();
  act(() => first.onSelect(partId, 0, { partId, index: 0, point: [50, 30, 9], normal: [0, 0, 1], sectionCap: true }));
  expect(onPickPoint).not.toHaveBeenCalled();
  const edge = { a: [0, 0, 0] as [number, number, number], b: [0, 0, 18] as [number, number, number] };
  act(() => first.onSelect(partId, 0, { partId, index: 0, point: [0, 0, 0], normal: [0, -1, 0], edge }));
  expect(onPickPoint).toHaveBeenCalledExactlyOnceWith({ partId, point: [0, 0, 0], normal: [0, -1, 0], copy: false, edge });
  expect(onSelect).not.toHaveBeenCalled();
  expect(onOpen).not.toHaveBeenCalled();
  expect(JSON.stringify(document)).toBe(before);
});
