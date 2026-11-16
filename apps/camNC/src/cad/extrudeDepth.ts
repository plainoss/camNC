import {
  CAD_MIN_THICKNESS,
  cadSketchFrame,
  evaluateCadPart,
  resolveDrawnPlacements,
  addedRegionStep,
  rotateVector,
  type CadDocument,
} from '@wbcnc/cad';
import { assemblyModel } from './assemblyModel';

type Vec = [number, number, number];
export interface ExtrudeDepthView {
  partId: string;
  origin: Vec;
  direction: Vec;
  depth: number;
  /** Symmetric depth measures both halves; the positive handle moves only one half. */
  factor: number;
  editable: boolean;
}
export interface ExtrudeDepthControl extends ExtrudeDepthView {
  dragging: boolean;
  onStart: () => void;
  onPreview: (depth: number) => void;
  onFinish: (depth: number) => void;
  onCancel: () => void;
}

/** The handle is attached to the sketch plane, independently of the camera and the depth being previewed. */
export function extrudeDepthView(document: CadDocument, partId: string): ExtrudeDepthView | null {
  const placed = resolveDrawnPlacements(document).document;
  const part = placed.parts.find(part => part.id === partId);
  if (!part || part.thin || part.remove) return null;
  const shape = evaluateCadPart(part).part;
  let frame = cadSketchFrame(placed, part);
  if (!shape || !frame) return null;
  if (!part.drawnOn) {
    const placement = assemblyModel(placed).placements.get(partId);
    if (placement)
      frame = {
        origin: placement.position,
        x: rotateVector(placement.rotation, [1, 0, 0]),
        y: rotateVector(placement.rotation, [0, 1, 0]),
        normal: rotateVector(placement.rotation, [0, 0, 1]),
      };
  }
  const xs = shape.outline.map(p => p.x),
    ys = shape.outline.map(p => p.y);
  const x = (Math.min(...xs) + Math.max(...xs)) / 2,
    y = (Math.min(...ys) + Math.max(...ys)) / 2;
  const inward = part.drawnOn?.inward ? -1 : 1;
  const target = part.addTo && placed.parts.find(candidate => candidate.id === part.addTo);
  // An Add level with its target has no end of its own; its target owns the extrusion depth.
  if (target && addedRegionStep(target, part) === 0) return null;
  return {
    partId,
    origin: frame.origin.map((value, axis) => value + frame.x[axis]! * x + frame.y[axis]! * y) as Vec,
    direction: frame.normal.map(value => value * inward || 0) as Vec,
    depth: part.thickness,
    factor: part.symmetric ? 2 : 1,
    editable: !part.upTo,
  };
}

export const clampExtrudeDepth = (depth: number) => Math.round(Math.max(CAD_MIN_THICKNESS, depth) * 10) / 10;

export function withExtrudeDepth(document: CadDocument, partId: string, depth: number): CadDocument {
  return {
    ...document,
    revision: document.revision + 1,
    parts: document.parts.map(part => {
      if (part.id !== partId) return part;
      const next = { ...part, thickness: clampExtrudeDepth(depth) };
      delete next.thicknessExpression;
      return next;
    }),
  };
}

/** Closest distance along an arbitrary extrusion axis; no unstable division when looking straight along it. */
export function distanceAlongAxis(rayOrigin: Vec, rayDirection: Vec, origin: Vec, direction: Vec): number | null {
  const dot = (a: Vec, b: Vec) => a.reduce((sum, value, axis) => sum + value * b[axis]!, 0);
  const parallel = dot(rayDirection, direction),
    denominator = 1 - parallel * parallel;
  if (denominator < 1e-4) return null;
  const relative = rayOrigin.map((value, axis) => value - origin[axis]!) as Vec;
  return (dot(relative, direction) - parallel * dot(relative, rayDirection)) / denominator;
}
