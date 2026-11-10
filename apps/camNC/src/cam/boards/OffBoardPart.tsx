import { DropdownMenu, DropdownMenuTrigger } from '@wbcnc/ui/components/dropdown-menu';
import { cn } from '@wbcnc/ui/lib/utils';
import { MoreHorizontal } from 'lucide-react';
import { useState } from 'react';
import { placedRect, type PartInstance } from '../boards';
import type { CamPartInfo } from '../camTypes';
import { PartBadges, PartMenuContent, type PartMenuProps } from './PartMenu';
import { place, toD } from './outline';

/** A part off every board, on the table: drawn at the table's scale, dragged like any part. */
export function OffBoardPart({
  inst,
  part,
  rotated,
  left,
  top,
  pxPerMm,
  faint,
  menuOpen,
  onMenuOpen,
  menuProps,
  pinned,
  onPointerDown,
}: {
  inst: PartInstance;
  part: CamPartInfo;
  rotated: boolean;
  left: number;
  top: number;
  pxPerMm: number;
  faint: boolean;
  menuOpen: boolean;
  onMenuOpen: (open: boolean) => void;
  menuProps: PartMenuProps;
  pinned: boolean;
  onPointerDown: (e: React.PointerEvent) => void;
}) {
  const r = placedRect({ x: 0, y: 0, rotated }, inst);
  const f = place({ x: 0, y: 0, rotated }, inst.size);
  const [hover, setHover] = useState(false);
  return (
    <div
      data-off-board={inst.name}
      className={cn('absolute z-10', faint && 'opacity-30')}
      style={{ left, top, width: r.w * pxPerMm, height: r.h * pxPerMm }}
      onPointerEnter={() => setHover(true)}
      onPointerLeave={() => setHover(false)}>
      <svg
        role="button"
        tabIndex={0}
        aria-label={`${inst.name}: off the board, won’t be cut. Drag it onto a board; Enter opens its menu`}
        data-item={inst.id}
        data-unplaced={inst.name}
        viewBox={`0 ${-r.h} ${r.w} ${r.h}`}
        width={r.w * pxPerMm}
        height={r.h * pxPerMm}
        className="block cursor-grab touch-none overflow-visible outline-none focus-visible:drop-shadow-[0_0_2px_var(--primary)] active:cursor-grabbing"
        onPointerDown={onPointerDown}
        onContextMenu={e => {
          e.preventDefault();
          onMenuOpen(true);
        }}
        onKeyDown={e => {
          if (e.key !== 'Enter' && e.key !== 'ContextMenu') return;
          e.preventDefault();
          onMenuOpen(true);
        }}>
        <g transform="scale(1,-1)">
          <path
            d={toD(part.shape.outlines, f)}
            className="fill-amber-500/10 stroke-amber-500"
            strokeWidth={1.5 / pxPerMm}
            strokeDasharray={`${6 / pxPerMm} ${4 / pxPerMm}`}
          />
          <path d={toD(part.shape.holes, f)} className="fill-background/70" />
        </g>
        <text
          x={r.w / 2}
          y={-r.h / 2}
          textAnchor="middle"
          dominantBaseline="middle"
          fontSize={Math.min(13.3 / pxPerMm, (1.6 * r.w) / Math.max(1, inst.name.length))}
          className="pointer-events-none fill-foreground">
          {inst.name}
        </text>
      </svg>
      <div className="pointer-events-none absolute top-0 right-0 flex items-center gap-0.5 p-0.5 *:pointer-events-auto">
        <PartBadges pinned={pinned} />
        {(hover || menuOpen) && (
          <DropdownMenu modal={false} open={menuOpen} onOpenChange={onMenuOpen}>
            <DropdownMenuTrigger asChild>
              <button
                aria-label={`${inst.name} menu`}
                onPointerDown={e => e.stopPropagation()}
                className="rounded-full border bg-background px-1 text-muted-foreground shadow-sm hover:text-foreground">
                <MoreHorizontal className="size-3.5" />
              </button>
            </DropdownMenuTrigger>
            <PartMenuContent {...menuProps} />
          </DropdownMenu>
        )}
      </div>
    </div>
  );
}
