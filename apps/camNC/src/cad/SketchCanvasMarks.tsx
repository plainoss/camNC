import type { CadPoint, CadSketch } from '@wbcnc/cad';
import type { CadSelectionBox } from './boxSelection';
import type { HandleDrag } from './editorGestures';
import { pointsOf } from './fitSketchView';
import { SKETCH_APPEARANCE } from './sketchAppearance';
import type { useSketchCommandPreviews } from './useSketchCommandPreviews';

type Previews = ReturnType<typeof useSketchCommandPreviews>;
type ChamferPreview = Extract<NonNullable<Previews['chamferPreview']>, { ok: true }>;

// The small marks the sketch tools draw over the drawing: where a split starts, the chamfer's handles, corners a fillet
// or chamfer can't round, the snap a cursor is about to take, the end an extend grows from and a box selection.

/** The first point picked for a split, before the second one is. */
export function SketchSplitMark({ point, pixelScale }: { point: CadPoint; pixelScale: number }) {
  return (
    <circle
      cx={point.x}
      cy={-point.y}
      r={5 / pixelScale}
      fill="#fff"
      stroke="#2467d1"
      vectorEffect="non-scaling-stroke"
      pointerEvents="none"
      data-split-first="true"
    />
  );
}

/** A handle at the far end of each of a chamfer's two distances, to drag them longer or shorter. */
export function SketchChamferHandles({
  preview,
  distances,
  pixelScale,
  onStart,
}: {
  preview: ChamferPreview;
  distances: string[];
  pixelScale: number;
  onStart: (event: { pointerId: number }, gesture: HandleDrag) => void;
}) {
  return (
    <>
      {preview.dimensionIds.map((id, side) => {
        const dimension = preview.sketch.constraints.find(c => c.id === id);
        if (dimension?.type !== 'distance') return null;
        const origin = preview.sketch.entities.find(e => e.id === dimension.pointAId);
        const point = preview.sketch.entities.find(e => e.id === dimension.pointBId);
        if (origin?.type !== 'point' || point?.type !== 'point') return null;
        const length = Math.hypot(point.x - origin.x, point.y - origin.y);
        return (
          <circle
            key={side}
            data-chamfer-handle={side}
            cx={point.x}
            cy={-point.y}
            r={6 / pixelScale}
            fill="#fff"
            stroke="#2467d1"
            vectorEffect="non-scaling-stroke"
            style={{ cursor: 'move' }}
            onPointerDown={event => {
              event.stopPropagation();
              event.preventDefault();
              onStart(event, {
                tool: 'chamfer',
                side,
                origin,
                direction: { x: (point.x - origin.x) / length, y: (point.y - origin.y) / length },
                previous: distances,
              });
            }}
          />
        );
      })}
    </>
  );
}

/** The corners a fillet or chamfer couldn't round, ringed in red. */
export function SketchCornerErrors({
  sketch,
  cornerPointIds,
  pixelScale,
}: {
  sketch: CadSketch | undefined;
  cornerPointIds: readonly string[];
  pixelScale: number;
}) {
  return (
    <>
      {cornerPointIds.map(id => {
        const point = sketch?.entities.find(entity => entity.type === 'point' && entity.id === id);
        return point?.type === 'point' ? (
          <circle
            key={id}
            data-fillet-error={id}
            cx={point.x}
            cy={-point.y}
            r={8 / pixelScale}
            fill="#c43b3522"
            stroke="#c43b35"
            vectorEffect="non-scaling-stroke"
            pointerEvents="none"
          />
        ) : null;
      })}
    </>
  );
}

/** The point the cursor will snap to, with what it is. */
export function SketchSnapCue({ cue, pixelScale }: { cue: { point: CadPoint; label: string }; pixelScale: number }) {
  return (
    <g pointerEvents="none">
      <circle
        cx={cue.point.x}
        cy={-cue.point.y}
        r={5 / pixelScale}
        fill="none"
        stroke="#bd7b18"
        strokeWidth="1.5"
        vectorEffect="non-scaling-stroke"
      />
      <text x={cue.point.x + 9 / pixelScale} y={-cue.point.y - 8 / pixelScale} fontSize={11 / pixelScale} fill="#9b6516">
        {cue.label}
      </text>
    </g>
  );
}

/** The end of the curve an extend grows from. */
export function SketchExtendEndpoint({
  sketch,
  entityId,
  end,
  pixelScale,
}: {
  sketch: CadSketch;
  entityId: string;
  end: 'start' | 'end' | undefined;
  pixelScale: number;
}) {
  const curve = sketch.entities.find(e => e.id === entityId);
  const point =
    curve && (curve.type === 'line' || curve.type === 'arc') && pointsOf(sketch).get(end === 'start' ? curve.startId : curve.endId);
  return point ? (
    <circle
      data-extend-endpoint={end}
      cx={point.x}
      cy={-point.y}
      r={5 / pixelScale}
      fill="none"
      stroke={SKETCH_APPEARANCE.selectedColor}
      strokeWidth={1.5}
      vectorEffect="non-scaling-stroke"
      pointerEvents="none"
    />
  ) : null;
}

/** Beside the cursor when an extend would remove the curve rather than grow it. */
export function SketchRemoveCurveLabel({ cursor, pixelScale }: { cursor: CadPoint; pixelScale: number }) {
  return (
    <text
      data-extend-removes-curve="true"
      x={cursor.x + 10 / pixelScale}
      y={-cursor.y - 10 / pixelScale}
      fontSize={13 / pixelScale}
      fill="#c73535"
      pointerEvents="none">
      Remove curve
    </text>
  );
}

/** A box selection: dragged right it's a window, left a crossing. */
export function SketchSelectionBox({ box }: { box: CadSelectionBox }) {
  const windowed = box.end.x >= box.start.x;
  return (
    <rect
      data-sketch-selection-box={windowed ? 'window' : 'crossing'}
      x={Math.min(box.start.x, box.end.x)}
      y={-Math.max(box.start.y, box.end.y)}
      width={Math.abs(box.end.x - box.start.x)}
      height={Math.abs(box.end.y - box.start.y)}
      fill={windowed ? '#438bd522' : '#32a76a22'}
      stroke={windowed ? '#438bd5' : '#32a76a'}
      strokeWidth="1"
      strokeDasharray={windowed ? undefined : '4 3'}
      vectorEffect="non-scaling-stroke"
      pointerEvents="none"
    />
  );
}
