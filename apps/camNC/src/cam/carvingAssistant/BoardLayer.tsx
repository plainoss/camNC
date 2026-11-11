import { useMemo, useRef, type PointerEvent as ReactPointerEvent } from 'react';
import { carvingPath } from '../carvingView';
import { sanitizeCarvingSvg } from './sanitize';
import { boundedCarvingRasterPreview } from './rasterSource';
import type { CarvingTarget } from './session';
import type { CarvingAssistantSession } from './useCarvingAssistant';

/**
 * The assistant on the board itself: the dashed box that sets where the artwork goes and how big it is, and the
 * picked or hovered artwork inside it. Drawn in the Carve step's board SVG (mm, Y down from the board's top edge).
 */
export function CarvingAssistantBoardLayer({ session, height }: { session: CarvingAssistantSession; height: number }) {
  const { target, setTarget, ghost, shown } = session;
  const drag = useRef<{ mode: 'move' | 'size'; from: { x: number; y: number }; start: CarvingTarget } | null>(null);
  const toMm = (e: ReactPointerEvent) => {
    const m = (e.currentTarget as SVGGraphicsElement).ownerSVGElement?.getScreenCTM();
    if (!m) return { x: 0, y: 0 };
    const p = new DOMPoint(e.clientX, e.clientY).matrixTransform(m.inverse());
    return { x: p.x, y: height - p.y };
  };
  const begin = (mode: 'move' | 'size') => (e: ReactPointerEvent) => {
    if (e.button !== 0) return;
    // The board's own handler would clear the selection and start an item drag.
    e.preventDefault();
    e.stopPropagation();
    (e.currentTarget as Element).setPointerCapture(e.pointerId);
    drag.current = { mode, from: toMm(e), start: target };
  };
  const move = (e: ReactPointerEvent) => {
    const d = drag.current;
    if (!d) return;
    e.stopPropagation();
    const at = toMm(e),
      dx = at.x - d.from.x,
      dy = at.y - d.from.y;
    const snap = (n: number) => (e.shiftKey ? n : Math.round(n));
    if (d.mode === 'move') setTarget({ ...d.start, x: snap(d.start.x + dx), y: snap(d.start.y + dy) });
    // The corner handle is the lower right one: the opposite corner stays put.
    else {
      const w = snap(d.start.w + dx),
        h = snap(d.start.h - dy);
      setTarget({ x: d.start.x - d.start.w / 2 + w / 2, y: d.start.y + d.start.h / 2 - h / 2, w, h });
    }
  };
  const end = (e: ReactPointerEvent) => {
    if (!drag.current) return;
    e.stopPropagation();
    drag.current = null;
  };
  const fallback = useMemo(() => {
    if (ghost || !shown?.asset) return null;
    const raster = boundedCarvingRasterPreview(shown.asset.rasterPreview);
    if (raster) return raster;
    try {
      return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(sanitizeCarvingSvg(shown.asset.svg))}`;
    } catch {
      return null;
    }
  }, [ghost, shown]);
  const x0 = target.x - target.w / 2,
    top = height - (target.y + target.h / 2);
  const placed = ghost?.outline.map(loop => loop.map(p => ({ x: p.x + target.x, y: p.y + target.y })));
  const grip = Math.max(2.5, Math.min(target.w, target.h) * 0.06);
  return (
    <g data-testid="carving-assistant-layer" onPointerMove={move} onPointerUp={end} onPointerCancel={end}>
      {placed && (
        <path
          d={carvingPath(placed, height)}
          aria-label="Proposed artwork on the board"
          role="img"
          className="pointer-events-none fill-violet-700/80 dark:fill-violet-400/80"
          fillRule="nonzero"
        />
      )}
      {fallback && (
        <image
          href={fallback}
          x={x0}
          y={top}
          width={target.w}
          height={target.h}
          preserveAspectRatio="xMidYMid meet"
          opacity={0.55}
          className="pointer-events-none"
        />
      )}
      {ghost?.problems.map((spot, i) => (
        <circle
          key={i}
          data-testid="carving-problem-area"
          cx={spot.x + target.x}
          cy={height - (spot.y + target.y)}
          r={spot.r}
          className="pointer-events-none fill-none stroke-red-500"
          strokeWidth={0.5}
        />
      ))}
      <rect
        aria-label="Artwork box: drag to move"
        x={x0}
        y={top}
        width={target.w}
        height={target.h}
        className="cursor-move fill-violet-500/5 stroke-violet-500"
        strokeWidth={0.5}
        strokeDasharray="3 2"
        onPointerDown={begin('move')}
      />
      <rect
        aria-label="Drag to size the artwork box"
        x={x0 + target.w - grip / 2}
        y={top + target.h - grip / 2}
        width={grip}
        height={grip}
        className="cursor-nwse-resize fill-background stroke-violet-500"
        strokeWidth={0.5}
        onPointerDown={begin('size')}
      />
      <text x={x0} y={top - 2} className="pointer-events-none fill-violet-600 text-[4px] dark:fill-violet-300">
        {Math.round(target.w)} × {Math.round(target.h)} mm
      </text>
    </g>
  );
}
