import { cn } from '@wbcnc/ui/lib/utils';
import { placedRect, type PartInstance } from '../boards';
import type { CamPartInfo } from '../camTypes';
import { place, toD } from './outline';
import type { DrawingTarget, ShapeDrag } from './usePartDrag';

export function DropStatus({
  dragging,
  fits,
  target,
  from,
}: {
  dragging: boolean;
  fits: boolean;
  target: Extract<DrawingTarget, { kind: 'drawing' }> | null;
  from: boolean;
}) {
  if (!dragging) return null;
  const text = !fits
    ? 'Different thickness'
    : !target
      ? from
        ? 'Moving from here'
        : 'Drop here'
      : !target.drop?.at
        ? 'Doesn’t fit on this board'
        : target.drop.exact
          ? 'Lands where you drop it'
          : 'Snaps into the nest';
  return (
    <span
      className={cn(
        'text-xs',
        target && !target.drop?.at
          ? 'font-medium text-red-600 dark:text-red-400'
          : target
            ? 'font-medium text-primary'
            : 'text-muted-foreground'
      )}>
      {text}
    </span>
  );
}

/** The dragged part's outline under the pointer, at the drawings' scale. */
export function Ghost({
  inst,
  part,
  drag,
  pxPerMm,
  bad,
  offBoard,
}: {
  inst: PartInstance;
  part: CamPartInfo | undefined;
  drag: ShapeDrag;
  pxPerMm: number;
  bad: boolean;
  /** It would lie on the table, off every board. */
  offBoard: boolean;
}) {
  if (!part) return null;
  const r = placedRect({ x: 0, y: 0, rotated: drag.rotated }, inst);
  const f = place({ x: 0, y: 0, rotated: drag.rotated }, inst.size);
  return (
    <svg
      aria-hidden
      data-drag-ghost
      viewBox={`0 ${-r.h} ${r.w} ${r.h}`}
      width={r.w * pxPerMm}
      height={r.h * pxPerMm}
      className="pointer-events-none fixed z-50 overflow-visible drop-shadow-lg"
      style={{ left: drag.pointer.x - drag.grab.x * pxPerMm, top: drag.pointer.y - (r.h - drag.grab.y) * pxPerMm }}>
      <g transform="scale(1,-1)">
        <path
          d={toD(part.shape.outlines, f)}
          className={
            bad
              ? 'fill-red-500/25 stroke-red-500'
              : offBoard
                ? 'fill-amber-500/20 stroke-amber-500'
                : 'fill-violet-500/35 stroke-violet-500'
          }
          strokeWidth={1.5 / pxPerMm}
        />
        <path d={toD(part.shape.holes, f)} className="fill-background/80" />
      </g>
      <text
        x={r.w / 2}
        y={-r.h / 2}
        textAnchor="middle"
        dominantBaseline="middle"
        fontSize={12 / pxPerMm}
        className="fill-foreground font-medium">
        {inst.name}
      </text>
      {offBoard && (
        <text
          x={r.w / 2}
          y={-r.h - 8 / pxPerMm}
          textAnchor="middle"
          fontSize={12 / pxPerMm}
          className="fill-amber-600 font-medium dark:fill-amber-400">
          Off the board: won’t be cut
        </text>
      )}
    </svg>
  );
}
