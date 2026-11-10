import { useEffect, useMemo } from 'react';
import type { CadViewport } from '@wbcnc/cad-editor/viewState';
import { cameraFromSketch } from './studioCamera';
import { straightOn, turnAxes, type SketchTurn } from './sketchOrbit';
import type { FaceSketchScene } from './faceSketchScene';

/** The routed face editor and the per-part view share one camera, including edits made while sketching. */
export function useFaceSketchCamera(
  scene: FaceSketchScene | undefined,
  view: CadViewport,
  turn: SketchTurn,
  shift: [number, number],
  box: { width: number; height: number } | null
) {
  const viewport = useMemo(() => {
    if (!box?.width || !box.height) return null;
    const scale = Math.min(box.width / view.w, box.height / view.h),
      w = box.width / scale,
      h = box.height / scale;
    return { x: view.x + view.w / 2 - w / 2, y: view.y + view.h / 2 - h / 2, w, h };
  }, [box, view]);
  useEffect(() => {
    if (scene && viewport) scene.cameraState.current = cameraFromSketch(scene.frame, viewport, turn, scene.cameraState.current, shift);
  }, [scene, viewport, turn, shift]);
  return scene && viewport
    ? {
        document: scene.document,
        view: {
          ...scene.frame,
          center: [view.x + view.w / 2, -(view.y + view.h / 2)] as [number, number],
          width: viewport.w,
          height: viewport.h,
          turned: turn === straightOn ? undefined : turnAxes(turn),
          shift,
        },
      }
    : null;
}
