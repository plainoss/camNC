import { Canvas, type ThreeEvent } from '@react-three/fiber';
import { act, cleanup, render } from '@testing-library/react';
import { createPlateDocument } from '@wbcnc/cad';
import { Children, isValidElement, type ReactNode } from 'react';
import { OrthographicCamera, Vector2, Vector3 } from 'three';
import { afterEach, expect, it, vi } from 'vitest';
import { assemblyModel } from '@/cad/assemblyModel';
import { sectionModel } from '@/cad/sectionModel';
import { ModelBody } from './ModelBody';
import { ModelConnector, type ViewConnector } from './ModelConnector';
import { ModelViewport } from './ModelViewport';

vi.mock('@react-three/fiber', async importOriginal => ({
  ...(await importOriginal<typeof import('@react-three/fiber')>()),
  Canvas: vi.fn(() => null),
}));
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function bodyProps() {
  let props: Parameters<typeof ModelBody>[0] | undefined;
  const visit = (children: ReactNode) =>
    Children.forEach(children, child => {
      if (!isValidElement<{ children?: ReactNode }>(child)) return;
      if (child.type === ModelBody) props = child.props as Parameters<typeof ModelBody>[0];
      else visit(child.props.children);
    });
  visit(vi.mocked(Canvas).mock.lastCall![0].children);
  expect(props).toBeDefined();
  return props!;
}
function hoveredConnector() {
  let connector: ViewConnector | undefined;
  const visit = (children: ReactNode) =>
    Children.forEach(children, child => {
      if (!isValidElement<{ children?: ReactNode; connector?: ViewConnector }>(child)) return;
      if (child.type === ModelConnector && child.props.connector?.label === 'Mate connector under pointer')
        connector = child.props.connector;
      else visit(child.props.children);
    });
  visit(vi.mocked(Canvas).mock.lastCall![0].children);
  return connector;
}
function setup() {
  const document = createPlateDocument({ width: 100, height: 60, thickness: 18 });
  const source = assemblyModel(document),
    section = sectionModel(source, { origin: [0, 0, 9], normal: [0, 0, 1] });
  expect(section.sectionProblems).toEqual([]);
  const mesh = section.meshes[0]!,
    cap = section.sectionCaps[0]!;
  const faceIndex = Array.from({ length: cap.start / 3 }, (_, i) => i).find(i =>
    [0, 1, 2].every(k => mesh.positions[mesh.indices[i * 3 + k]! * 3 + 1] === 0)
  )!;
  expect(faceIndex).toBeGreaterThanOrEqual(0);
  const camera = new OrthographicCamera(-60, 60, 30, -30, 0.1, 1000);
  camera.up.set(0, 0, 1);
  camera.position.set(50, -200, 9);
  camera.lookAt(50, 0, 9);
  camera.updateMatrixWorld();
  const canvas = documentElement();
  const event = (point: Vector3, normal: Vector3, index: number): ThreeEvent<MouseEvent> => {
    const screen = point.clone().project(camera);
    return {
      point,
      face: { normal },
      faceIndex: index,
      camera,
      pointer: new Vector2(screen.x, screen.y),
      nativeEvent: { target: canvas },
      shiftKey: false,
    } as unknown as ThreeEvent<MouseEvent>;
  };
  const props = {
    meshes: section.meshes,
    sourceMeshes: source.meshes,
    sectionCaps: section.sectionCaps,
    parts: source.parts,
    view: 'assembled' as const,
    palette: 'studio' as const,
    selectedId: null,
    milled: () => true,
    onSelect: vi.fn(),
  };
  return { props, event, faceIndex };
}
function documentElement() {
  const canvas = document.createElement('canvas');
  Object.defineProperties(canvas, { clientWidth: { value: 1000 }, clientHeight: { value: 500 } });
  return canvas;
}

it('snaps feature faces to original model corners and middles without inventing a cut edge', () => {
  const { props, event, faceIndex } = setup(),
    pick = vi.fn();
  render(<ModelViewport {...props} onPickFace={pick} />);
  act(() => bodyProps().onSelect(event(new Vector3(50, 0, 8.9), new Vector3(0, -1, 0), faceIndex)));
  expect(pick).toHaveBeenCalledOnce();
  const face = pick.mock.calls[0]![0];
  // The physical side spans Z0..18, even though inspection currently shows only Z0..9.
  expect(face.point).toEqual([50, 0, 9]);
  expect(face.surfacePoint).toEqual([50, 0, 8.9]);
  expect(face.edge).toBeUndefined();
  expect(face.sectionCap).toBeUndefined();
});

it('still measures the visible finite cut edge rather than the unclipped source edge', () => {
  const { props, event, faceIndex } = setup(),
    measure = vi.fn();
  render(<ModelViewport {...props} measuring onMeasurePick={measure} />);
  act(() => bodyProps().onSelect(event(new Vector3(50, 0, 8.9), new Vector3(0, -1, 0), faceIndex)));
  expect(measure).toHaveBeenCalledOnce();
  const entity = measure.mock.calls[0]![0].entity;
  expect(entity.kind).toBe('edge');
  expect([entity.a, entity.b].sort((a, b) => a[0] - b[0])).toEqual([
    [0, 0, 9],
    [100, 0, 9],
  ]);
  expect(props.onSelect).not.toHaveBeenCalled();
});

it('shows a mate marker at the same original face snap that a persistent pick receives', () => {
  const { props, event, faceIndex } = setup();
  render(<ModelViewport {...props} pickingConnector />);
  const hit = event(new Vector3(50, 0, 4.5), new Vector3(0, -1, 0), faceIndex);
  act(() => bodyProps().onHover(true, hit as unknown as ThreeEvent<PointerEvent>));
  expect(hoveredConnector()?.point).toEqual([50, 0, 9]);
  act(() => bodyProps().onSelect(hit));
  expect(props.onSelect.mock.calls[0]![2].point).toEqual(hoveredConnector()!.point);
});

it('removes the mate marker when the pointer reaches a temporary cap', () => {
  const { props, event, faceIndex } = setup();
  render(<ModelViewport {...props} pickingConnector />);
  act(() =>
    bodyProps().onHover(true, event(new Vector3(50, 0, 4.5), new Vector3(0, -1, 0), faceIndex) as unknown as ThreeEvent<PointerEvent>)
  );
  expect(hoveredConnector()).toBeDefined();
  const capIndex = props.sectionCaps[0]!.start / 3;
  act(() =>
    bodyProps().onHover(true, event(new Vector3(50, 30, 9), new Vector3(0, 0, 1), capIndex) as unknown as ThreeEvent<PointerEvent>)
  );
  expect(hoveredConnector()).toBeUndefined();
});
