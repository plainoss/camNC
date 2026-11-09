import {
  CAD_IDENTITY_PLACEMENT,
  cadDrawnOnSupports,
  cadFaceFrame,
  designSteps,
  rolledBackTo,
  type CadDocument,
  type CadPart,
} from '@wbcnc/cad';
import type { CadViewport } from '@wbcnc/cad-editor/viewState';
import { straightOn, turnAxes, type SketchTurn } from './sketchOrbit';

/** The earlier parts, in world coordinates, and the camera shared with the drawing above them. */
export function sketchBackdropView(
  doc: CadDocument,
  part: CadPart,
  view: CadViewport,
  sketchTurn: SketchTurn,
  canvasBox: { width: number; height: number },
  shift?: [number, number]
) {
  const frame = cadFaceFrame(doc, part.drawnOn?.on ?? { plane: 'top' });
  if ('error' in frame) return null;
  const offset = part.drawnOn?.offset ?? 0;
  const origin = frame.origin.map((value, axis) => value + frame.normal[axis]! * offset) as [number, number, number];
  const scale = Math.min(canvasBox.width / view.w, canvasBox.height / view.h);
  const steps = designSteps(doc);
  const at = steps.findIndex(step => step.id === `${part.id}:sketch`);
  const before = at > 0 ? rolledBackTo(doc, steps[at - 1]!.id) : { ...doc, parts: [] };
  // A supporting part stays where the drawing is, even when nothing else has yet been placed.
  const supports = cadDrawnOnSupports(doc);
  return {
    document: {
      ...before,
      parts: before.parts
        .filter(candidate => candidate.id !== part.id)
        .map(candidate =>
          !candidate.placement && supports.has(candidate.id) ? { ...candidate, placement: CAD_IDENTITY_PLACEMENT } : candidate
        ),
    },
    view: {
      origin,
      x: frame.x,
      y: frame.y,
      normal: frame.normal,
      center: [view.x + view.w / 2, -(view.y + view.h / 2)] as [number, number],
      width: canvasBox.width / scale,
      height: canvasBox.height / scale,
      turned: sketchTurn === straightOn ? undefined : turnAxes(sketchTurn),
      shift,
    },
  };
}
