import { cn } from '@wbcnc/ui/lib/utils';
import { MATERIALS } from '@wbcnc/cam/settings';
import { Popover, PopoverContent, PopoverTrigger } from '@wbcnc/ui/components/popover';
import { CircleHelp, LayoutGrid, Maximize, Minus, Plus } from 'lucide-react';
import type { Rect } from '@wbcnc/cam/nest';
import type { HoldHardware } from '@wbcnc/cam-settings';
import { boardLabel, boardSizeLabel, holdVerdict, isCut, type BoardNest, type NestOptions, type PartInstance } from '../boards';
import { kDefaultHardware } from '../holdHardware';
import type { JobBoard } from '../useJobBoards';
import { NumberInput } from '../NumberInput';
import { BoardHeadingFields } from './BoardHeadingFields';
import { CutBadge } from './CutBadge';
import { kMaxScale } from './table';
import type { HoldEditing, HoldTool } from './useHoldEditing';

const fmt = (v: number) => `${+v.toFixed(1)}`;

/** The list over the table: "All boards" and every board, to go to it or drop a dragged part on it. */
export function BoardRail({
  boards,
  instances,
  hardware,
  selectedId,
  allShown,
  dragging,
  overRail,
  onAll,
  onOpen,
  showAll,
  showBoard,
}: {
  boards: JobBoard[];
  instances: PartInstance[];
  hardware: HoldHardware;
  selectedId: string;
  allShown: boolean;
  /** A part is being dragged. */
  dragging: boolean;
  /** The board in the list (or "New board") a dragged part is over, and whether it fits there. */
  overRail: { board: string; ok: boolean } | 'new' | null;
  onAll: () => void;
  onOpen: (id: string) => void;
  showAll: () => void;
  showBoard: (id: string) => void;
}) {
  return (
    <nav aria-label="Boards" className="flex min-w-0 flex-wrap items-center gap-1">
      <button
        type="button"
        aria-current={allShown ? 'page' : undefined}
        onClick={() => {
          onAll();
          showAll();
        }}
        className={cn(
          'flex items-center gap-1.5 rounded-md border border-transparent px-2 py-1 text-xs whitespace-nowrap hover:bg-muted',
          allShown && 'border-primary/60 bg-muted'
        )}>
        <LayoutGrid className="size-3.5 shrink-0" /> All boards
      </button>
      {boards.map(({ board, nest }) => {
        const over = overRail && overRail !== 'new' && overRail.board === board.id ? overRail : null;
        const tone = holdVerdict(board, nest, hardware, instances).tone;
        return (
          <button
            key={board.id}
            type="button"
            data-rail-drop={board.id}
            aria-label={boardLabel(board)}
            aria-current={board.id === selectedId && !allShown ? 'true' : undefined}
            title={`${boardLabel(board)}: go to it, or drop a part on it`}
            onClick={() => {
              onOpen(board.id);
              showBoard(board.id);
            }}
            className={cn(
              'flex items-center gap-1.5 rounded-md border border-transparent px-2 py-1 text-xs whitespace-nowrap hover:bg-muted',
              board.id === selectedId && !allShown && 'border-primary/60 bg-muted',
              dragging && 'border-dashed border-primary/60',
              over?.ok && 'border-solid border-primary bg-primary/10 ring-1 ring-primary',
              over && !over.ok && 'border-solid border-red-500 ring-1 ring-red-500'
            )}>
            <span
              aria-hidden
              className={cn(
                'size-2 shrink-0 rounded-full',
                tone === 'ok' ? 'bg-emerald-500' : tone === 'warn' ? 'bg-amber-500' : 'bg-muted-foreground'
              )}
            />
            {board.name}
            {nest.unplaced.length > 0 && <span className="font-medium text-amber-600 dark:text-amber-400">{nest.unplaced.length} off</span>}
          </button>
        );
      })}
      {dragging && (
        <div
          data-new-board-drop
          aria-label="New board"
          className={cn(
            'flex items-center gap-1 rounded-md border border-dashed px-2 py-1 text-xs text-muted-foreground',
            overRail === 'new' && 'border-primary bg-primary/5 text-foreground'
          )}>
          <Plus className="size-3" /> New board
        </div>
      )}
    </nav>
  );
}

/** The selected board's heading: its name, material, thickness and size, and its offcut and yield. */
export function SelectedBoardHead({
  selJob,
  selNest,
  selHere,
  selOffcut,
  onBoardChange,
}: {
  selJob: JobBoard;
  selNest: BoardNest;
  /** Not cut: its fields can be edited. */
  selHere: boolean;
  selOffcut: Rect | null | undefined;
  onBoardChange: (board: JobBoard['board']) => void;
}) {
  return (
    <div data-board-head className="flex min-h-8 shrink-0 flex-wrap items-center gap-x-2 border-b bg-background px-3 py-0.5 text-sm">
      <span className="font-medium">{boardLabel(selJob.board)}</span>
      {isCut(selJob.board) && <CutBadge board={selJob.board} />}
      {selHere ? (
        <BoardHeadingFields board={selJob.board} nest={selNest} onChange={onBoardChange} />
      ) : (
        <span className="whitespace-nowrap text-muted-foreground">
          {MATERIALS[selJob.board.material].name[0].toUpperCase() + MATERIALS[selJob.board.material].name.slice(1)}{' '}
          {fmt(selJob.board.thickness)} mm · <span className="font-mono text-xs">{boardSizeLabel(selJob.board, selNest)}</span>
        </span>
      )}
      <span className="truncate font-mono text-xs leading-4 text-muted-foreground" data-offcut-row>
        <span data-offcut-label>
          {selOffcut ? `Offcut ${Math.round(selOffcut.w)} × ${Math.round(selOffcut.h)}` : 'No offcut over 60 mm'}
        </span>
        {selNest.placements.length > 0 && ` · Yield ${Math.round(selNest.yield * 100)} %`}
      </span>
    </div>
  );
}

/** While a hold or tab tool is armed: what to click, and the size of the next clamp or screw. */
export function ArmedToolBar({
  tool,
  nestOptions,
  holds,
  onHoldSizes,
}: {
  tool: HoldTool;
  nestOptions: NestOptions;
  holds: HoldEditing;
  onHoldSizes: () => void;
}) {
  return (
    <div
      data-armed-bar
      className="absolute top-24 left-1/2 z-20 flex max-w-[calc(100%-1rem)] -translate-x-1/2 flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border bg-background px-3 py-1.5 text-xs shadow-lg">
      <span className="whitespace-nowrap">
        {tool === 'clamp' ? 'Click near an edge.' : tool === 'screw' ? 'Click in the waste.' : 'Click on a part’s outline.'} Esc to stop.
      </span>
      {tool !== 'tab' &&
        (tool === 'clamp'
          ? ([
              ['w', 'Width'],
              ['d', 'Reach'],
              ['height', 'Height'],
            ] as const)
          : ([
              ['d', 'Head ⌀'],
              ['height', 'Height'],
            ] as const)
        ).map(([key, label]) => {
          const hw = nestOptions.hardware ?? kDefaultHardware;
          const base = tool === 'clamp' ? hw.clamp[key] : hw.screw[key as 'd' | 'height'];
          return (
            <label key={key} className="flex items-center gap-1 whitespace-nowrap text-muted-foreground">
              {label}
              <NumberInput
                id={`new-${tool}-${key}`}
                value={holds.newSizes[tool][key] ?? base}
                digits={1}
                min={0.1}
                unit="mm"
                className="h-6 w-14 px-1 text-right font-mono text-xs"
                onCommit={value => holds.setNewSizes({ ...holds.newSizes, [tool]: { ...holds.newSizes[tool], [key]: value } })}
              />
              mm
            </label>
          );
        })}
      {tool !== 'tab' && (
        <button type="button" className="whitespace-nowrap text-primary hover:underline" onClick={onHoldSizes}>
          Clamp and screw sizes…
        </button>
      )}
    </div>
  );
}

/** Bottom right of the table: what the drawing shows, and zoom. */
export function DrawingControls({
  boards,
  anyHolds,
  pxPerMm,
  fitAll,
  zoomTo,
  showAll,
}: {
  boards: JobBoard[];
  anyHolds: boolean;
  pxPerMm: number;
  fitAll: number;
  zoomTo: (next: number) => void;
  showAll: () => void;
}) {
  return (
    <div className="absolute right-4 bottom-3 z-20 flex items-center gap-1.5">
      <Popover>
        <PopoverTrigger asChild>
          <button
            type="button"
            aria-label="What the drawing shows"
            title="What the drawing shows"
            className="rounded-md border bg-background/90 p-1.5 text-muted-foreground shadow-sm hover:bg-muted hover:text-foreground">
            <CircleHelp className="size-3.5" />
          </button>
        </PopoverTrigger>
        <PopoverContent align="end" className="flex w-60 flex-col gap-1.5 text-xs text-muted-foreground">
          <span>
            <span className="text-violet-500 dark:text-violet-400">■</span> part outline
          </span>
          <span>
            <span className="text-violet-600 dark:text-violet-500">■</span> pocket
          </span>
          {boards.some(b => b.board.retention === 'tabs') && (
            <span>
              <span className="text-amber-600 dark:text-amber-500">■</span> tab
            </span>
          )}
          {anyHolds && (
            <>
              <span>
                <span className="text-foreground">⊕</span> screw or clamp (drag to move, right-click for its menu)
              </span>
              <span>
                <span className="text-red-500">▨</span> blocked for the bit
              </span>
            </>
          )}
        </PopoverContent>
      </Popover>
      <div className="flex items-center gap-0.5 rounded-md border bg-background/90 p-0.5 shadow-sm">
        <button
          type="button"
          aria-label="Zoom out"
          title="Zoom out (Ctrl/⌘ + wheel)"
          onClick={() => zoomTo(pxPerMm / 1.25)}
          className="rounded p-1 hover:bg-muted disabled:opacity-40">
          <Minus className="size-3.5" />
        </button>
        <span className="w-10 text-center font-mono text-[11px] text-muted-foreground" aria-live="polite">
          {Math.round((pxPerMm / fitAll) * 100)} %
        </span>
        <button
          type="button"
          aria-label="Zoom in"
          title="Zoom in (Ctrl/⌘ + wheel)"
          onClick={() => zoomTo(pxPerMm * 1.25)}
          disabled={pxPerMm >= kMaxScale}
          className="rounded p-1 hover:bg-muted disabled:opacity-40">
          <Plus className="size-3.5" />
        </button>
        <button type="button" aria-label="Fit boards to view" title="Fit to view" onClick={showAll} className="rounded p-1 hover:bg-muted">
          <Maximize className="size-3.5" />
        </button>
      </div>
    </div>
  );
}
