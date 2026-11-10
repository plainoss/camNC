import { act, cleanup, fireEvent, render, renderHook } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { ModelView } from './ModelViewport';
import { ExplosionSlider } from './ExplosionSlider';
import { useExplodedView } from './useExplodedView';

let frames: Map<number, FrameRequestCallback>;
let nextFrame: number;
let reduced = false;
let mediaChanged: (() => void) | undefined;
beforeEach(() => {
  frames = new Map();
  nextFrame = 0;
  reduced = false;
  vi.spyOn(performance, 'now').mockReturnValue(100);
  vi.spyOn(window, 'requestAnimationFrame').mockImplementation(callback => {
    frames.set(++nextFrame, callback);
    return nextFrame;
  });
  vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(id => {
    frames.delete(id);
  });
  vi.spyOn(window, 'matchMedia').mockImplementation(
    () =>
      ({
        get matches() {
          return reduced;
        },
        addEventListener: (_event: string, callback: () => void) => {
          mediaChanged = callback;
        },
        removeEventListener: () => {},
      }) as unknown as MediaQueryList
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
const useView = () => {
  const [view, setView] = useState<ModelView>('assembled');
  return { ...useExplodedView(view, setView), view };
};

it('animates assembled to exploded through an intermediate position and assembles again', () => {
  const { result } = renderHook(useView);
  act(() => result.current.chooseView('exploded'));
  expect(result.current.progress).toBe(0);
  expect(result.current.modelView).toBe('exploded');
  advance(400);
  expect(result.current.progress).toBeCloseTo(0.5);
  advance(700);
  expect(result.current.progress).toBe(1);
  expect(frames.size).toBe(0);
  act(() => result.current.chooseView('assembled'));
  expect(result.current.modelView).toBe('exploded');
  advance(400);
  expect(result.current.progress).toBeCloseTo(0.5);
  advance(700);
  expect(result.current.progress).toBe(0);
  expect(result.current.modelView).toBe('assembled');
});

it('lets manual scrubbing take over playback and starts the next animation at that position', () => {
  const { result } = renderHook(useView);
  act(() => result.current.chooseView('exploded'));
  advance(400);
  act(() => result.current.scrub(0.27));
  expect(result.current.progress).toBe(0.27);
  expect(frames.size).toBe(0);
  advance(700);
  expect(result.current.progress).toBe(0.27);
  act(() => result.current.chooseView('exploded'));
  advance(400);
  expect(result.current.progress).toBeCloseTo(0.635);
  advance(700);
  expect(result.current.progress).toBe(1);
});

it('cancels playback on flat and unmount, and explodes from assembled after flat', () => {
  const { result, unmount } = renderHook(useView);
  act(() => result.current.chooseView('exploded'));
  advance(400);
  act(() => result.current.chooseView('flat'));
  expect(result.current.progress).toBe(0);
  expect(result.current.modelView).toBe('flat');
  expect(frames.size).toBe(0);
  act(() => result.current.chooseView('exploded'));
  expect(result.current.progress).toBe(0);
  advance(400);
  expect(result.current.progress).toBeCloseTo(0.5);
  unmount();
  expect(frames.size).toBe(0);
});

it('respects reduced motion both when selected and when the preference changes during playback', () => {
  const { result } = renderHook(useView);
  act(() => result.current.chooseView('exploded'));
  advance(400);
  act(() => {
    reduced = true;
    mediaChanged?.();
  });
  expect(result.current.progress).toBe(1);
  expect(frames.size).toBe(0);
  act(() => result.current.chooseView('assembled'));
  expect(result.current.progress).toBe(0);
  expect(frames.size).toBe(0);
  act(() => result.current.chooseView('exploded'));
  expect(result.current.progress).toBe(1);
  act(() => result.current.scrub(0.42));
  expect(result.current.progress).toBe(0.42);
});

it('provides a labeled native range with percentage feedback and exact manual endpoints', () => {
  const onChange = vi.fn();
  const screen = render(<ExplosionSlider progress={0.46} onChange={onChange} />);
  const slider = screen.getByRole('slider', { name: 'Explosion amount' });
  expect(slider.getAttribute('aria-valuetext')).toBe('46% exploded');
  expect(slider.getAttribute('min')).toBe('0');
  expect(slider.getAttribute('max')).toBe('100');
  fireEvent.change(slider, { target: { value: '0' } });
  expect(onChange).toHaveBeenLastCalledWith(0);
  fireEvent.change(slider, { target: { value: '100' } });
  expect(onChange).toHaveBeenLastCalledWith(1);
});
