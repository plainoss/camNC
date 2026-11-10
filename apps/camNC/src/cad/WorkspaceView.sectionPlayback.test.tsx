import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { createPlateDocument } from '@wbcnc/cad';
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
  vi.clearAllMocks();
});

const advance = (time: number) =>
  act(() => {
    const pending = [...frames.values()];
    frames.clear();
    pending.forEach(callback => callback(time));
  });

it.each(['playing', 'scrubbed', 'returning'] as const)(
  'assembles the first section frame from a %s explosion and cancels playback',
  mode => {
    const document = createPlateDocument({ width: 100, height: 60, thickness: 18 });
    document.parts[0]!.placement = { position: [0, 0, 0], rotation: [0, 0, 0, 1] };
    const second = createPlateDocument({ width: 100, height: 60, thickness: 18 }).parts[0]!;
    second.placement = { position: [160, 0, 0], rotation: [0, 0, 0, 1] };
    document.parts.push(second);
    const before = JSON.stringify(document);
    render(
      <div className="cad-editor">
        <WorkspaceView document={document} selectedId={null} selectedPlane="top" onSelect={() => {}} onOpen={() => {}} />
      </div>
    );
    const props = () => vi.mocked(ModelViewport).mock.lastCall![0];
    const original = props().meshes;
    const positions = original.map(mesh => Array.from(mesh.positions));
    fireEvent.click(screen.getByRole('button', { name: 'Exploded' }));
    advance(400);
    expect(props().view).toBe('exploded');
    expect(props().explosionProgress).toBeCloseTo(0.5);
    if (mode === 'scrubbed') {
      fireEvent.change(screen.getByRole('slider', { name: 'Explosion amount' }), { target: { value: '35' } });
      expect(props().explosionProgress).toBeCloseTo(0.35);
    } else if (mode === 'returning') fireEvent.click(screen.getByRole('button', { name: 'Assembled' }));

    const nextCall = vi.mocked(ModelViewport).mock.calls.length;
    fireEvent.click(screen.getByRole('button', { name: 'Section view' }));
    // The inspector's plane and the rendered solids must agree before any state-synchronizing effect runs.
    const first = vi.mocked(ModelViewport).mock.calls[nextCall]![0];
    expect(first.view).toBe('assembled');
    expect(first.explosionProgress).toBe(0);
    expect(first.sourceMeshes).toBe(original);
    expect(first.sectionControl).not.toBeNull();
    expect(first.onMeasurePick).toBeUndefined();
    expect(screen.queryByRole('slider', { name: 'Explosion amount' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Assembled' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'Exploded' })).toBeDisabled();
    expect(frames.size).toBe(0);
    advance(700);
    expect(props().view).toBe('assembled');
    expect(props().explosionProgress).toBe(0);

    fireEvent.change(screen.getByRole('textbox', { name: 'Offset' }), { target: { value: '9mm' } });
    fireEvent.click(screen.getByRole('button', { name: 'Confirm section view' }));
    expect(props().sectionCaps!.every(cap => cap && cap.count > 0)).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Turn off section view' }));
    expect(props().view).toBe('assembled');
    expect(props().explosionProgress).toBe(0);
    expect(props().meshes).toBe(original);
    expect(original.map(mesh => Array.from(mesh.positions))).toEqual(positions);
    expect(JSON.stringify(document)).toBe(before);
  }
);
