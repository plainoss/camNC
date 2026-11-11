import { _roots } from '@react-three/fiber';
import { trackProbe } from './settled';

/**
 * Spread on a react-three-fiber `<Canvas>` so the settled signal (`settled.ts`) counts it as pending `render` while it
 * is shown and not yet drawn, or has a frame requested and not yet drawn: what it draws (a fitted camera, uploaded
 * geometry, an overlay placed from the camera) is only there after that frame. A canvas without a size isn't counted,
 * since it draws nothing until it has one. Dev and test builds only, like the rest of the signal.
 */
export const settledCanvas = { 'data-settled-canvas': '' } as const;

trackProbe('render', () => {
  let count = 0;
  for (const view of document.querySelectorAll<HTMLElement>('[data-settled-canvas]')) {
    const canvas = view.querySelector('canvas');
    if (!canvas || !view.offsetWidth || !view.offsetHeight) continue;
    // No root yet: the canvas is waiting for its first measured size to start one.
    const state = _roots.get(canvas)?.store.getState();
    if (!state) count++;
    // An inactive root (unmounting) or one that never draws by itself has nothing coming.
    else if (state.internal.active && state.frameloop !== 'never')
      if (state.gl.info.render.frame === 0 || (state.frameloop === 'demand' && state.internal.frames > 0)) count++;
  }
  return count;
});
