import { createPlateDocument } from '@wbcnc/cad';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ModelViewport } from '@/cam/model/ModelViewport';
import WorkspaceView from './WorkspaceView';

vi.mock('@/cam/model/ModelViewport', () => ({ ModelViewport: vi.fn(() => null) }));

let frames: Map<number, FrameRequestCallback>;
let nextFrame = 0;
beforeEach(() => {
  frames = new Map();
  nextFrame = 0;
  vi.spyOn(performance, 'now').mockReturnValue(100);
  vi.spyOn(window, 'requestAnimationFrame').mockImplementation(callback => {
    frames.set(++nextFrame, callback);
    return nextFrame;
  });
  vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(id => frames.delete(id));
  vi.spyOn(window, 'matchMedia').mockImplementation(
    () => ({ matches: false, addEventListener: () => {}, removeEventListener: () => {} }) as unknown as MediaQueryList
  );
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const advance = (time: number) =>
  act(() => {
    const pending = [...frames.values()];
    frames.clear();
    pending.forEach(callback => callback(time));
  });

function setup() {
  const source = createPlateDocument({ width: 100, height: 60, thickness: 18 });
  source.parts[0]!.placement = { position: [0, 0, 0], rotation: [0, 0, 0, 1] };
  const second = createPlateDocument({ width: 100, height: 60, thickness: 18 }).parts[0]!;
  second.placement = { position: [160, 0, 0], rotation: [0, 0, 0, 1] };
  source.parts.push(second);
  const original = JSON.stringify(source);
  render(
    <div className="cad-editor">
      <WorkspaceView document={source} selectedId={null} onSelect={() => {}} onOpen={() => {}} />
    </div>
  );
  const props = () => vi.mocked(ModelViewport).mock.lastCall![0];
  const meshes = props().meshes;
  const positions = meshes.map(mesh => Array.from(mesh.positions));
  const pickEdge = () =>
    act(() =>
      props().onMeasurePick!({
        partId: source.parts[0]!.id,
        index: 0,
        entity: { kind: 'edge', a: [0, 0, 18], b: [100, 0, 18] },
        additive: false,
      })
    );
  const unchanged = () => {
    expect(props().meshes).toBe(meshes);
    expect(props().meshes.map(mesh => Array.from(mesh.positions))).toEqual(positions);
    expect(JSON.stringify(source)).toBe(original);
  };
  return { props, pickEdge, unchanged };
}

it('keeps measurement disabled throughout animated assembly and never restores old selections', () => {
  const { props, pickEdge, unchanged } = setup();
  pickEdge();
  expect(screen.getByRole('button', { name: 'Length: 100 mm' })).toBeVisible();
  fireEvent.click(screen.getByRole('button', { name: 'Exploded' }));
  advance(400);
  expect(props().explosionProgress).toBeCloseTo(0.5);
  expect(props().onMeasurePick).toBeUndefined();
  expect(props().measureSelection).toEqual([]);
  expect(screen.queryByRole('region', { name: 'Selection measurements' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Assembled' }));
  expect(screen.getByRole('button', { name: 'Assembled' })).toHaveAttribute('aria-pressed', 'true');
  expect(props().view).toBe('exploded');
  expect(props().onMeasurePick).toBeUndefined();
  fireEvent.keyDown(screen.getByTestId('workspace-3d'), { key: '[' });
  expect(screen.queryByRole('dialog', { name: 'Measure' })).toBeNull();
  advance(400);
  expect(props().explosionProgress).toBeGreaterThan(0);
  expect(props().onMeasurePick).toBeUndefined();
  advance(700);
  expect(props().view).toBe('assembled');
  expect(props().explosionProgress).toBe(0);
  expect(props().onMeasurePick).toBeTypeOf('function');
  expect(props().measureSelection).toEqual([]);
  expect(props().measureWitness).toBeUndefined();
  unchanged();
});

it('assembles immediately and cancels pending playback when Measure is opened from a partial explosion', () => {
  const { props, pickEdge, unchanged } = setup();
  fireEvent.click(screen.getByRole('button', { name: 'Exploded' }));
  advance(400);
  expect(props().explosionProgress).toBeCloseTo(0.5);
  expect(frames.size).toBe(1);
  fireEvent.click(screen.getByRole('button', { name: 'Measure' }));
  expect(props().view).toBe('assembled');
  expect(props().explosionProgress).toBe(0);
  expect(props().measuring).toBe(true);
  expect(frames.size).toBe(0);
  advance(700);
  expect(props().view).toBe('assembled');
  expect(props().explosionProgress).toBe(0);
  pickEdge();
  expect(screen.getByRole('button', { name: 'Length: 100 mm' })).toBeVisible();
  unchanged();
});
