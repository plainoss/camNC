import { Html } from '@react-three/drei';
import { Canvas, useThree } from '@react-three/fiber';
import { cleanup, render, screen } from '@testing-library/react';
import type { WebGLRenderer } from 'three';
import { afterEach, expect, it } from 'vitest';
import { holdPending, resetSettled, settledSnapshot, trackPending } from '@/lib/settled';
import { settledCanvas } from '@/lib/settledCanvas';
import { settled, settledState } from './settled';

afterEach(() => {
  cleanup();
  document.body.replaceChildren();
});

it('waits for tracked work to end, then for its result to be drawn', async () => {
  let finish!: () => void;
  void trackPending('solve', new Promise<void>(resolve => (finish = resolve)));
  setTimeout(finish, 50);
  const state = await settled();
  expect(Object.values(state.pending).every(count => count === 0)).toBe(true);
  expect(settledSnapshot().pending.solve).toBe(0);
});

it('fails after its timeout, naming what is still pending', async () => {
  const release = holdPending('worker');
  await expect(settled({ timeout: 100 })).rejects.toThrow('The app did not settle within 0.1 s: still pending: worker 1');
  release();
  await settled();
});

it('counts elements marked busy and finite CSS animations, but not endless ones', async () => {
  const busy = document.body.appendChild(document.createElement('div'));
  busy.setAttribute('aria-busy', 'true');
  await expect(settled({ timeout: 100 })).rejects.toThrow('still pending: busy 1');
  busy.remove();
  const spinner = document.body.appendChild(document.createElement('div'));
  spinner.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 100, iterations: Infinity });
  const closing = document.body.appendChild(document.createElement('div'));
  const exit = closing.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 300 });
  expect(settledState().pending.transition).toBe(1);
  await settled();
  expect(exit.playState).toBe('finished');
});

it('forgets work left running by an earlier test, also when it ends later', async () => {
  const release = holdPending('animation');
  resetSettled();
  await settled();
  release();
  expect(settledSnapshot().pending.animation).toBe(0);
});

it('counts a shown 3D view as pending until it has drawn, and a hidden one not at all', async () => {
  let renderer: WebGLRenderer | null = null;
  function Probe() {
    renderer = useThree(state => state.gl);
    return null;
  }
  render(
    <>
      <div style={{ width: 200, height: 100 }}>
        <Canvas {...settledCanvas} frameloop="demand">
          <Probe />
        </Canvas>
      </div>
      <div style={{ display: 'none' }}>
        <Canvas {...settledCanvas} frameloop="demand" />
      </div>
    </>
  );
  expect(settledState().pending.render).toBe(1);
  await settled();
  expect(renderer!.info.render.frame).toBeGreaterThan(0);
});

it('counts a 3D view’s Html overlay as pending until its separate root has filled it', async () => {
  render(
    <div style={{ width: 200, height: 100 }}>
      <Canvas {...settledCanvas}>
        <Html>
          <span data-testid="overlay" />
        </Html>
      </Canvas>
    </div>
  );
  await settled();
  expect(screen.getByTestId('overlay')).toBeInTheDocument();
  // The view between Html adding its element and its root committing, which a loaded browser can stretch past the
  // two animation frames that follow the canvas's first draw.
  const overlay = document.querySelector('[data-settled-canvas]')!.appendChild(document.createElement('div'));
  expect(settledState().pending.render).toBe(1);
  await expect(settled({ timeout: 100 })).rejects.toThrow('still pending: render 1');
  overlay.appendChild(document.createElement('div'));
  await settled();
});
