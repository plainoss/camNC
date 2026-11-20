import { cadFaceFrame, designStepLabel, type CadDocument, type CadPart } from '@wbcnc/cad';

/** How near, in mm, a click must land to a sketch point for Hole to take it. */
const kNear = 2;

/** A sketch Hole can drill at: drawn on a board's top or underside, not yet a part of its own. */
const pointsSketch = (part: CadPart) => {
  const on = part.drawnOn?.on;
  return (
    part.extrude === false && !part.suppressed && !!on && 'partId' in on && !on.copyId && (on.face === 'top' || on.face === 'underside')
  );
};

/**
 * The sketch point a click in the view lands on, for Hole: a vertex of a sketch on a board's face, a circle's centre
 * among them, nearest the click. Null when the click isn't near one.
 */
export function holePointAt(
  document: CadDocument,
  at: readonly [number, number, number]
): { sketchId: string; pointId: string; boardId: string } | null {
  let best: { sketchId: string; pointId: string; boardId: string; distance: number } | null = null;
  for (const part of document.parts) {
    if (!pointsSketch(part)) continue;
    const on = part.drawnOn!.on as Extract<NonNullable<CadPart['drawnOn']>['on'], { partId: string }>;
    const frame = cadFaceFrame(document, on);
    if ('error' in frame) continue;
    const offset = part.drawnOn!.offset;
    for (const point of part.sketch.entities) {
      if (point.type !== 'point' || point.faceEdge || point.id.endsWith(':origin')) continue;
      const world = [0, 1, 2].map(i => frame.origin[i]! + frame.normal[i]! * offset + frame.x[i]! * point.x + frame.y[i]! * point.y);
      const distance = Math.hypot(world[0]! - at[0], world[1]! - at[1], world[2]! - at[2]);
      if (distance < kNear && (!best || distance < best.distance))
        best = { sketchId: part.id, pointId: point.id, boardId: on.partId, distance };
    }
  }
  return best && { sketchId: best.sketchId, pointId: best.pointId, boardId: best.boardId };
}

/** A picked point as the dialog lists it: Vertex of Sketch 2. */
export const holePointName = (document: CadDocument, sketchId: string) =>
  `Vertex of ${designStepLabel(document, `${sketchId}:sketch`) ?? 'a sketch'}`;
