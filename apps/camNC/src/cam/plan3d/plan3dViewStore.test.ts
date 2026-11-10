import { afterEach, describe, expect, it } from 'vitest';
import { projectionOf, usePlan3dView } from './plan3dViewStore';

const kKey = 'camnc-plan-3d-view';
const initial = usePlan3dView.getInitialState();

afterEach(() => {
  usePlan3dView.setState(initial, true);
  localStorage.removeItem(kKey);
});

describe('3D Plan view settings', () => {
  it('starts in Result mode, 3D, perspective', () => {
    const s = usePlan3dView.getState();
    expect([s.mode, s.view, s.ortho3d, s.seeThrough, s.showRapids]).toEqual(['result', '3d', false, false, true]);
  });

  it('keeps the top view orthographic, and the 3D view in perspective unless switched', () => {
    expect(projectionOf('top', false)).toBe('orthographic');
    expect(projectionOf('top', true)).toBe('orthographic');
    expect(projectionOf('3d', false)).toBe('perspective');
    expect(projectionOf('3d', true)).toBe('orthographic');
  });

  it('remembers every toggle across reloads', async () => {
    const s = usePlan3dView.getState();
    s.setMode('compare');
    s.setSeeThrough(true);
    s.setView('top');
    s.setOrtho3d(true);
    s.setShowRapids(false);
    const saved = JSON.parse(localStorage.getItem(kKey)!);
    expect(saved).toEqual({
      state: { mode: 'compare', seeThrough: true, view: 'top', ortho3d: true, showRapids: false },
      version: 0,
    });

    // A fresh page: defaults first, then what was saved.
    usePlan3dView.setState(initial, true);
    expect(usePlan3dView.getState().mode).toBe('result');
    localStorage.setItem(kKey, JSON.stringify(saved));
    await usePlan3dView.persist.rehydrate();
    const r = usePlan3dView.getState();
    expect([r.mode, r.seeThrough, r.view, r.ortho3d, r.showRapids]).toEqual(['compare', true, 'top', true, false]);
  });
});
