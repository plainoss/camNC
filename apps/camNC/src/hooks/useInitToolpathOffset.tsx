import { useEffect, useRef } from 'react';
import { Vector3 } from 'three';

import { useCamMachine } from '@/cam/machine/camMachine';
import { getCncApi } from '@/lib/fluidnc/machine';
import { initialToolpathOffset, placedExtent } from '@/lib/machine/initialPlacement';
import { getMachineBounds, useStore } from '@/store/store';

/**
 * One-shot initialisation of the toolpath offset.
 *
 * When a toolpath is present, the CNC connection reports a valid currentZero
 * and the current toolpathOffset is still at its default (0,0), we move the
 * toolpath so that it sits at the machine's current workspace zero, or as near
 * it as keeps the toolpath and its board on the bed when they fit there.
 *
 * The effect runs only once per page load and becomes a no-op after the user
 * manually moves the toolpath or after the offset has been auto-initialised.
 */
export function useInitToolpathOffset(): void {
  'use no memo';
  const cncApi = getCncApi();

  const currentZero = cncApi.currentZero.value;
  const toolpath = useStore(s => s.toolpath);
  const offset = useStore(s => s.toolpathOffset);
  const setOffset = useStore(s => s.setToolpathOffset);

  // Ensure the side-effect is executed at most once.
  const hasInitialised = useRef(false);

  useEffect(() => {
    // Bail if already done or if prerequisites are missing.
    if (hasInitialised.current) return;
    if (!toolpath || !currentZero) return;
    if (offset.x !== 0 || offset.y !== 0) return;

    // Align toolpath to machine zero, unless that would put a board that fits the bed partly off it.
    const extent = placedExtent(toolpath.getBounds(), useCamMachine.getState().overlay);
    const at = initialToolpathOffset(currentZero, extent, getMachineBounds());
    setOffset(new Vector3(at.x, at.y, 0));
    hasInitialised.current = true;
  }, [toolpath, currentZero, offset, setOffset]);
}
