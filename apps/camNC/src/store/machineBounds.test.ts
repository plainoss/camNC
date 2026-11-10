import { afterEach, describe, expect, it } from 'vitest';
import { getMachineBounds, isCameraReady, useStore } from './store';

afterEach(() => {
  useStore.setState({ camSources: {}, activeCamId: null, machineBounds: null });
});

describe('machine bounds', () => {
  it('are set without a camera', () => {
    useStore.getState().setMachineBounds(0, 0, 600, 400);
    expect(getMachineBounds()?.max.toArray()).toEqual([600, 400]);
  });
});

describe('isCameraReady', () => {
  it('needs a calibrated camera with a pose', () => {
    expect(isCameraReady(null)).toBe(false);
    expect(isCameraReady({ name: 'Cam', url: 'x', maxResolution: [1, 1] })).toBe(false);
  });
});
