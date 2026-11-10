import { act, cleanup, fireEvent, renderHook } from '@testing-library/react';
import { createPlateDocument, type CadDocument, type CadDrawnOn } from '@wbcnc/cad';
import { afterEach, expect, it, vi } from 'vitest';
import type { AssemblyModel } from './assemblyModel';
import { useStudioSection } from './useStudioSection';

const hosts: HTMLElement[] = [];
afterEach(() => {
  cleanup();
  for (const host of hosts.splice(0)) host.remove();
});
function source(): CadDocument {
  const document = createPlateDocument({ width: 100, height: 50, thickness: 18 });
  document.parts[0]!.name = 'Panel';
  document.variables = [{ id: 'stock', name: 'stock', expression: '18mm' }];
  document.planes = [{ id: 'inspection', name: 'Inspection', on: { plane: 'top' }, offset: 35 }];
  return document;
}
interface Props {
  document: CadDocument;
  enabled: boolean;
  selectedPlane: string | null;
  selectedFace: Extract<CadDrawnOn['on'], { partId: string }> | null;
}
function setup(document = source(), options: Partial<Omit<Props, 'document'>> = {}) {
  const host = window.document.createElement('div'),
    view = window.document.createElement('div');
  host.className = 'cad-editor';
  view.tabIndex = -1;
  host.append(view);
  window.document.body.append(host);
  hosts.push(host);
  const frame = { current: view },
    onViewRequest = vi.fn(),
    partId = document.parts[0]!.id;
  const model: AssemblyModel = {
    meshes: [],
    parts: [],
    problems: [],
    instances: [
      { partId, name: 'Panel' },
      { partId, copyId: 'copy', name: 'Panel 2' },
    ],
    placements: new Map([
      [partId, { position: [0, 0, 0], rotation: [0, 0, 0, 1] }],
      [`${partId}/copy`, { position: [200, 0, 0], rotation: [0, 0, 0, 1] }],
    ]),
  };
  const initialProps: Props = { document, enabled: true, selectedPlane: null, selectedFace: null, ...options };
  const hook = renderHook(
    ({ document, enabled, selectedPlane, selectedFace }: Props) =>
      useStudioSection(document, model, frame, enabled, onViewRequest, selectedPlane, selectedFace),
    { initialProps }
  );
  const press = (key: string, options: KeyboardEventInit = {}, target: Element = view) =>
    act(() => {
      fireEvent.keyDown(target, { key, ...options });
    });
  return { ...hook, frame, view, host, initialProps, onViewRequest, partId, press };
}

it('starts empty, picks a plane, keeps the confirmed section, and cancels editing without changing the source', () => {
  const document = source(),
    before = JSON.stringify(document);
  const { result, frame, press } = setup(document);
  expect(result.current.active).toBe(false);
  expect(result.current.plane).toBeNull();
  act(() => result.current.start());
  expect(result.current.active).toBe(true);
  expect(result.current.editing).toBe(true);
  expect(result.current.picking).toBe(true);
  expect(result.current.reason).toMatch(/Pick a plane/);
  act(() => result.current.confirm());
  expect(result.current.editing).toBe(true);
  act(() => {
    result.current.pickPlane('top');
  });
  expect(result.current.plane).toEqual({ origin: [0, 0, 0], normal: [0, 0, 1] });
  act(() => result.current.setOffset('1/2in'));
  expect(result.current.plane!.origin[2]).toBeCloseTo(12.7, 8);
  act(() => result.current.flip());
  expect(result.current.plane!.origin[2]).toBeCloseTo(12.7, 8);
  expect(result.current.plane!.normal[2]).toBe(-1);
  act(() => result.current.confirm());
  expect(result.current.active).toBe(true);
  expect(result.current.editing).toBe(false);
  expect(window.document.activeElement).toBe(frame.current);
  press('Escape');
  expect(result.current.active).toBe(true);
  act(() => result.current.edit());
  press('Escape');
  expect(result.current.active).toBe(false);
  expect(result.current.plane).toBeNull();
  expect(JSON.stringify(document)).toBe(before);
});

it('recalls only accepted section settings after turning off and leaves an unaccepted first command blank', () => {
  const document = source(),
    before = JSON.stringify(document);
  const { result, press } = setup(document);
  const toggle = () => press('X', { code: 'KeyX', shiftKey: true });
  const blank = () => {
    expect(result.current.active).toBe(true);
    expect(result.current.planeId).toBeNull();
    expect(result.current.plane).toBeNull();
    expect(result.current.offset).toBe('0');
    expect(result.current.flipped).toBe(false);
    expect(result.current.picking).toBe(true);
  };
  toggle();
  blank();
  act(() => result.current.selectPlane('right'));
  act(() => result.current.setOffset('12mm'));
  act(() => result.current.flip());
  press('Escape');
  toggle();
  blank();

  act(() => result.current.selectPlane('top'));
  act(() => result.current.setOffset('stock/2'));
  act(() => result.current.flip());
  act(() => result.current.confirm());
  act(() => result.current.turnOff());
  toggle();
  const acceptedTop = () => {
    expect(result.current.editing).toBe(true);
    expect(result.current.picking).toBe(false);
    expect(result.current.planeId).toBe('top');
    expect(result.current.offset).toBe('stock/2');
    expect(result.current.flipped).toBe(true);
    expect(result.current.plane!.origin).toEqual([0, 0, 9]);
    expect(result.current.plane!.normal[2]).toBe(-1);
  };
  acceptedTop();
  act(() => result.current.selectPlane('right'));
  act(() => result.current.setOffset('20mm'));
  press('Escape');
  toggle();
  acceptedTop();

  act(() => result.current.selectPlane('right'));
  act(() => result.current.setOffset('4mm'));
  act(() => result.current.confirm());
  toggle();
  expect(result.current.active).toBe(false);
  toggle();
  expect(result.current.planeId).toBe('right');
  expect(result.current.offset).toBe('4mm');
  expect(result.current.flipped).toBe(false);
  expect(result.current.plane).toEqual({ origin: [4, 0, 0], normal: [1, 0, 0] });
  expect(JSON.stringify(document)).toBe(before);
});

it('lets a fresh explicit base plane, datum or face preselection take precedence over accepted view settings', () => {
  const document = source(),
    before = JSON.stringify(document);
  const { result, rerender, initialProps, partId } = setup(document);
  act(() => result.current.start());
  act(() => result.current.selectPlane('top'));
  act(() => result.current.setOffset('13mm'));
  act(() => result.current.flip());
  act(() => result.current.confirm());
  act(() => result.current.turnOff());
  const cases = [
    { selectedPlane: 'right', selectedFace: null, id: 'right', origin: [0, 0, 0], normal: [1, 0, 0] },
    { selectedPlane: 'inspection', selectedFace: null, id: 'inspection', origin: [0, 0, 35], normal: [0, 0, 1] },
    { selectedPlane: null, selectedFace: { partId, face: 'top' as const }, id: 'picked-face', origin: [0, 0, 18], normal: [0, 0, 1] },
  ];
  for (const { selectedPlane, selectedFace, id, origin, normal } of cases) {
    rerender({ ...initialProps, selectedPlane, selectedFace });
    act(() => result.current.start());
    expect(result.current.planeId).toBe(id);
    expect(result.current.offset).toBe('0');
    expect(result.current.flipped).toBe(false);
    expect(result.current.picking).toBe(false);
    expect(result.current.plane).toEqual({ origin, normal });
    act(() => result.current.turnOff());
  }
  rerender(initialProps);
  act(() => result.current.start());
  expect(result.current.planeId).toBe('top');
  expect(result.current.offset).toBe('13mm');
  expect(result.current.flipped).toBe(true);
  expect(result.current.plane!.origin).toEqual([0, 0, 13]);
  expect(JSON.stringify(document)).toBe(before);
});

it('distinguishes an unchanged preselection from deselecting and selecting the same source again', () => {
  const document = source(),
    before = JSON.stringify(document);
  const { result, rerender, initialProps, press } = setup(document, { selectedPlane: 'top' });
  const toggle = () => press('X', { code: 'KeyX', shiftKey: true });
  toggle();
  act(() => result.current.setOffset('9mm'));
  act(() => result.current.flip());
  act(() => result.current.confirm());
  const remembered = () => {
    expect(result.current.planeId).toBe('top');
    expect(result.current.offset).toBe('9mm');
    expect(result.current.flipped).toBe(true);
    expect(result.current.plane!.origin).toEqual([0, 0, 9]);
  };
  for (let repetition = 0; repetition < 2; repetition++) {
    toggle();
    expect(result.current.active).toBe(false);
    toggle();
    remembered();
  }
  act(() => result.current.setOffset('33mm'));
  press('Escape');
  toggle();
  remembered();
  act(() => result.current.turnOff());

  rerender({ ...initialProps, selectedPlane: null });
  rerender(initialProps);
  toggle();
  expect(result.current.planeId).toBe('top');
  expect(result.current.offset).toBe('0');
  expect(result.current.flipped).toBe(false);
  act(() => result.current.setOffset('21mm'));
  press('Escape');
  rerender({ ...initialProps, selectedPlane: null });
  toggle();
  remembered();
  expect(JSON.stringify(document)).toBe(before);
});

it('preselects a datum, evaluates linked offsets, flips at the same location, and follows datum-source edits', () => {
  const document = source(),
    { result, rerender, initialProps, onViewRequest } = setup(document, { selectedPlane: 'inspection' });
  act(() => result.current.start());
  expect(result.current.planeId).toBe('inspection');
  expect(result.current.picking).toBe(false);
  expect(result.current.planes).toContainEqual({ id: 'inspection', label: 'Inspection' });
  act(() => result.current.setOffset('stock/2'));
  expect(result.current.plane).toEqual({ origin: [0, 0, 44], normal: [0, 0, 1] });
  act(() => result.current.flip());
  expect(result.current.plane!.origin).toEqual([0, 0, 44]);
  expect(result.current.plane!.normal[2]).toBe(-1);
  act(() => result.current.normal());
  expect(onViewRequest).toHaveBeenCalledOnce();
  expect(onViewRequest.mock.calls[0]![0]).toMatchObject({ name: 'normal', up: [0, 1, 0] });
  expect(onViewRequest.mock.calls[0]![0].direction[2]).toBe(-1);
  const edited = structuredClone(document);
  edited.variables![0]!.expression = '21mm';
  edited.planes![0]!.offset = 40;
  edited.revision++;
  rerender({ ...initialProps, document: edited });
  expect(result.current.plane!.origin[2]).toBe(50.5);
  expect(document.variables![0]!.expression).toBe('18mm');
  expect(document.planes![0]!.offset).toBe(35);
  act(() => result.current.selectPlane('right'));
  expect(result.current.offset).toBe('0');
  expect(result.current.flipped).toBe(false);
  expect(result.current.plane).toEqual({ origin: [0, 0, 0], normal: [1, 0, 0] });
});

it('preselects a source face and invalidates picked copy-face topology when the shown document changes', () => {
  const document = source(),
    partId = document.parts[0]!.id;
  const { result, rerender, initialProps } = setup(document, { selectedFace: { partId, face: 'top' } });
  act(() => result.current.start());
  expect(result.current.planeId).toBe('picked-face');
  expect(result.current.plane!.origin[2]).toBe(18);
  act(() => result.current.pick());
  act(() => result.current.pickFace({ partId, index: 1, point: [200, 10, 18], normal: [0, 0, 1] }));
  expect(result.current.plane).toEqual({ origin: [200, 10, 18], normal: [0, 0, 1] });
  expect(result.current.planes).toContainEqual({ id: 'picked-face', label: 'Panel 2 face' });
  const preview = { ...document, parts: [...document.parts] };
  // A rollback preview can have the same persistent ID and revision while displaying different topology.
  rerender({ ...initialProps, document: preview });
  expect(result.current.active).toBe(true);
  expect(result.current.plane).toBeNull();
  expect(result.current.reason).toMatch(/changed.*again/);
  act(() => result.current.pick());
  act(() => result.current.pickFace({ partId, index: 1, point: [210, 10, 18], normal: [0, 0, 1] }));
  expect(result.current.plane!.origin).toEqual([210, 10, 18]);
  act(() => result.current.pick());
  act(() => result.current.pickFace({ partId, index: 1, point: [210, 10, 18], normal: [0, 0, 1], sectionCap: true }));
  expect(result.current.reason).toMatch(/temporary cut surface/);
  expect(result.current.plane!.origin).toEqual([210, 10, 18]);
});

it('places an oblique section through the actual surface hit rather than the legacy bounds snap', () => {
  const document = source(),
    before = JSON.stringify(document);
  const { result, partId } = setup(document);
  const component = 1 / Math.sqrt(3),
    hit = [1 / 3, 1 / 3, 1 / 3] as [number, number, number];
  act(() => result.current.start());
  // This triangle's vertices are (1,0,0), (0,1,0), (0,0,1). Its bounds midpoint is off the face x+y+z=1.
  act(() =>
    result.current.pickFace({
      partId,
      index: 0,
      point: [0.5, 0.5, 0.5],
      surfacePoint: hit,
      normal: [component, component, component],
    })
  );
  expect(result.current.sourceFrame!.origin).toEqual(hit);
  expect(result.current.plane!.origin.reduce((sum, value) => sum + value, 0)).toBeCloseTo(1, 12);
  for (const value of result.current.plane!.normal) expect(value).toBeCloseTo(component, 12);
  act(() => result.current.setOffset('3mm'));
  const shifted = result.current.plane!;
  shifted.origin.forEach((value, axis) => expect(value - hit[axis]!).toBeCloseTo(3 * component, 12));
  expect(shifted.origin.reduce((sum, value) => sum + value, 0)).toBeCloseTo(1 + 3 * Math.sqrt(3), 12);
  expect(shifted.origin.reduce((sum, value, axis) => sum + (value - hit[axis]!) * shifted.normal[axis]!, 0)).toBeCloseTo(3, 12);
  act(() => result.current.flip());
  expect(result.current.plane!.origin).toEqual(shifted.origin);
  for (const value of result.current.plane!.normal) expect(value).toBeCloseTo(-component, 12);
  expect(JSON.stringify(document)).toBe(before);
});

it('keeps the active plane while a feature disables interaction, and blocks acceptance for invalid offsets', () => {
  const { result, rerender, initialProps } = setup(source(), { selectedPlane: 'top' });
  act(() => result.current.start());
  act(() => result.current.setOffset('20mm'));
  expect(result.current.plane!.origin).toEqual([0, 0, 20]);
  rerender({ ...initialProps, enabled: false });
  expect(result.current.active).toBe(true);
  expect(result.current.editing).toBe(false);
  expect(result.current.picking).toBe(false);
  expect(result.current.plane!.origin).toEqual([0, 0, 20]);
  act(() => result.current.edit());
  expect(result.current.editing).toBe(false);
  rerender(initialProps);
  act(() => result.current.edit());
  act(() => result.current.setOffset('stock +'));
  expect(result.current.offsetProblem).not.toBeNull();
  expect(result.current.plane).toBeNull();
  act(() => result.current.confirm());
  expect(result.current.editing).toBe(true);
  act(() => result.current.moveOffset(25));
  expect(result.current.offset).toBe('25');
  expect(result.current.plane!.origin).toEqual([0, 0, 25]);
});

it('previews and finishes handle offsets, and Escape cancels a drag before closing the section editor', () => {
  const document = source(),
    before = JSON.stringify(document);
  const { result, press, host } = setup(document, { selectedPlane: 'top' });
  const input = window.document.createElement('input');
  host.append(input);
  act(() => result.current.start());
  act(() => result.current.setOffset('stock/2'));
  expect(result.current.control).toMatchObject({ origin: [0, 0, 9], normal: [0, 0, 1], offset: 9, factor: 1, dragging: false });
  act(() => result.current.control!.onStart());
  act(() => result.current.control!.onPreview(25));
  expect(result.current.dragging).toBe(true);
  expect(result.current.plane!.origin).toEqual([0, 0, 25]);
  // Drag cancellation takes precedence even when a field owns keyboard focus.
  press('Escape', {}, input);
  expect(result.current.dragging).toBe(false);
  expect(result.current.editing).toBe(true);
  expect(result.current.active).toBe(true);
  expect(result.current.offset).toBe('stock/2');
  expect(result.current.plane!.origin).toEqual([0, 0, 9]);

  act(() => result.current.control!.onStart());
  act(() => result.current.control!.onPreview(32));
  act(() => result.current.control!.onFinish());
  expect(result.current.dragging).toBe(false);
  expect(result.current.offset).toBe('32');
  act(() => result.current.flip());
  expect(result.current.control).toMatchObject({ origin: [0, 0, 32], offset: 32, factor: -1 });
  expect(result.current.control!.normal[2]).toBe(-1);
  act(() => result.current.control!.onStart());
  act(() => result.current.control!.onPreview(-8));
  act(() => result.current.control!.onCancel());
  expect(result.current.offset).toBe('32');
  expect(result.current.plane!.origin).toEqual([0, 0, 32]);
  act(() => result.current.confirm());
  expect(result.current.control).toBeNull();
  expect(result.current.active).toBe(true);
  expect(JSON.stringify(document)).toBe(before);
});

it('cancels an unfinished handle preview when another feature takes interaction or the section turns off', () => {
  const { result, rerender, initialProps } = setup(source(), { selectedPlane: 'top' });
  act(() => result.current.start());
  act(() => result.current.setOffset('1/2in'));
  act(() => result.current.control!.onStart());
  act(() => result.current.control!.onPreview(45));
  rerender({ ...initialProps, enabled: false });
  expect(result.current.dragging).toBe(false);
  expect(result.current.editing).toBe(false);
  expect(result.current.control).toBeNull();
  expect(result.current.offset).toBe('1/2in');
  expect(result.current.plane!.origin[2]).toBeCloseTo(12.7, 8);
  rerender(initialProps);
  act(() => result.current.edit());
  act(() => result.current.control!.onStart());
  act(() => result.current.control!.onPreview(60));
  act(() => result.current.turnOff());
  expect(result.current.active).toBe(false);
  expect(result.current.dragging).toBe(false);
  expect(result.current.control).toBeNull();
  expect(result.current.plane).toBeNull();
});

it('releases removed drag handles without letting late previews overwrite replacement planes or invalid input', () => {
  const document = source(),
    before = JSON.stringify(document),
    partId = document.parts[0]!.id;
  const { result, rerender, initialProps } = setup(document, { selectedFace: { partId, face: 'top' } });
  act(() => result.current.start());
  act(() => result.current.setOffset('stock/2'));
  const faceDrag = result.current.control!;
  act(() => faceDrag.onStart());
  act(() => faceDrag.onPreview(23));
  expect(result.current.dragging).toBe(true);
  const previewDocument = { ...document, parts: [...document.parts] };
  rerender({ ...initialProps, document: previewDocument });
  expect(result.current.dragging).toBe(false);
  expect(result.current.offset).toBe('stock/2');
  expect(result.current.plane).toBeNull();
  expect(result.current.control).toBeNull();
  act(() => {
    faceDrag.onPreview(99);
    faceDrag.onFinish();
  });
  expect(result.current.offset).toBe('stock/2');
  expect(result.current.plane).toBeNull();

  act(() => result.current.selectPlane('top'));
  act(() => result.current.setOffset('7mm'));
  const topDrag = result.current.control!;
  act(() => topDrag.onStart());
  act(() => topDrag.onPreview(28));
  act(() => result.current.selectPlane('right'));
  expect(result.current.dragging).toBe(false);
  expect(result.current.offset).toBe('0');
  expect(result.current.plane).toEqual({ origin: [0, 0, 0], normal: [1, 0, 0] });
  act(() => {
    topDrag.onPreview(99);
    topDrag.onCancel();
  });
  expect(result.current.offset).toBe('0');
  expect(result.current.plane).toEqual({ origin: [0, 0, 0], normal: [1, 0, 0] });

  const rightDrag = result.current.control!;
  act(() => rightDrag.onStart());
  act(() => rightDrag.onPreview(12));
  act(() => result.current.setOffset('stock +'));
  expect(result.current.dragging).toBe(false);
  expect(result.current.control).toBeNull();
  expect(result.current.offsetProblem).not.toBeNull();
  expect(result.current.offset).toBe('stock +');
  act(() => {
    rightDrag.onPreview(99);
    rightDrag.onCancel();
  });
  expect(result.current.offset).toBe('stock +');
  expect(result.current.plane).toBeNull();
  expect(JSON.stringify(document)).toBe(before);
  expect(JSON.stringify(previewDocument)).toBe(before);
});

it('handles Shift+X and N from the model while leaving typing, IME and modified browser shortcuts alone', () => {
  const { result, press, host, onViewRequest } = setup(source(), { selectedPlane: 'top' });
  const input = window.document.createElement('input');
  host.append(input);
  press('X', { code: 'KeyX', shiftKey: true }, input);
  press('X', { code: 'KeyX', shiftKey: true, isComposing: true });
  press('X', { code: 'KeyX', shiftKey: true, ctrlKey: true });
  press('X', { code: 'KeyX', shiftKey: true, metaKey: true });
  expect(result.current.active).toBe(false);
  press('X', { code: 'KeyX', shiftKey: true });
  expect(result.current.active).toBe(true);
  press('n', { code: 'KeyN' });
  expect(onViewRequest).toHaveBeenCalledWith({ name: 'normal', direction: [0, 0, 1], up: [0, 1, 0] });
  press('X', { code: 'KeyX', shiftKey: true });
  expect(result.current.active).toBe(false);
});
