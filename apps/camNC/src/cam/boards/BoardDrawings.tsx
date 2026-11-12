import { LoadingSpinner } from '@wbcnc/ui/components/loading-spinner';
import { cn } from '@wbcnc/ui/lib/utils';
import type { HoleChoice, HoleMiddle } from '@wbcnc/cam';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@wbcnc/ui/components/dropdown-menu';
import { MoreHorizontal, Plus, Ruler, Trash2, WandSparkles } from 'lucide-react';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { clampPlay, largestOffcut, reserved, screwPlay } from '@wbcnc/cam/settle';
import {
  boardLabel,
  boardSizeLabel,
  fixtureAt,
  isCut,
  layoutChange,
  nestBoard,
  placedRect,
  settleBoard,
  settleInputOf,
  tightestSide,
  type BoardNest,
  type BoardV1,
  type NestOptions,
  type PartDrop,
  type PartInstance,
  type PartPosition,
} from '../boards';
import type { CamPartInfo, PlanResult } from '../camTypes';
import { kDefaultHardware } from '../holdHardware';
import type { JobBoard } from '../useJobBoards';
import { ArmedToolBar, BoardRail, DrawingControls, SelectedBoardHead } from './DrawingChrome';
import { BoardOverlay } from './BoardOverlay';
import { SelectionBar } from './SelectionBar';
import { bestColumns, fitScale, kBoardPad, kMaxScale, kMinScale, kTableGap, layoutTable, type TableBoard, type TableRect } from './table';
import { PartBadges, PartMenuContent, type PartMenuProps } from './PartMenu';
import { NestView } from './NestView';
import { CutBadge } from './CutBadge';
import { OffBoardPart } from './OffBoardPart';
import { tabSpots, toPartFrame } from './outline';
import type { HoldEditing, HoldSizeKey } from './useHoldEditing';
import { DropStatus, Ghost } from './DragFeedback';
import { HoleMenu } from './HoleMenu';
import { kDragStart, kTableMargin, round, sameThickness, toBoard, usePartDrag } from './usePartDrag';

export type { DrawingTarget } from './usePartDrag';

const fmt = (v: number) => `${+v.toFixed(1)}`;
/** Lines and labels stay this size on screen at any zoom: the `unit` of a drawing is this many px. */
const kUnitPx = 600;
/** Narrower than this on screen, a board's drawing doesn't have its margin and gap labels. */
const kLabelsFrom = 240;

/**
 * The table: every board at one scale, with what edits a board on the selected one. Zoom and pan decide how much of it is in view,
 * and the list above it goes to a board or back to all of them.
 *
 * Drag a part's outline anywhere: onto a board of its thickness (or "New board"), on its drawing or in the list, or onto the table,
 * where it stays, off every board, and isn't cut. While dragging, the outline follows the pointer and the target board shows where
 * the part lands: exactly at the drop point when there is room, else where the board's nest puts it, in red when it doesn't fit. R
 * turns it. A focused part moves with the arrow keys (Shift: 10 mm).
 */
export function BoardDrawings({
  boards,
  instances,
  parts,
  plans,
  fetching,
  bit,
  selectedId,
  onSelect,
  onDrop,
  partMenu,
  onNewBoard,
  onNudge,
  onBoardEdit,
  onNote,
  nestOptions,
  machine,
  onTabsMove,
  onHoleChoice,
  holds,
  onOpen,
  onBoardChange,
  resizedTo,
  onResize,
  onHoldSizes,
  status,
  allShown,
  onAll,
  tools,
  onTabSize,
  onSetAside,
  startOnBoard,
  onApplyAll,
}: {
  boards: JobBoard[];
  instances: PartInstance[];
  parts: CamPartInfo[];
  plans: (PlanResult | undefined)[];
  fetching: boolean[];
  bit: number;
  /** A choice for the piece in a through hole's middle, for every copy of the part; none: its size and time decide again. */
  onHoleChoice?: (partId: string, hole: number, choice: HoleChoice | undefined) => void;
  selectedId: string;
  onSelect: (id: string) => void;
  /** Dropped on a board: `drop` is null when it doesn't fit there or has another thickness. `fromRail`: in the list, the board selected stays. */
  onDrop: (item: string, board: string, drop: PartDrop | null, fromRail?: boolean) => void;
  /** A body's menu (move it, unpin it, what holds it): opened from the ⋯ on the part, right-click, or Enter. */
  partMenu: (board: JobBoard, item: string) => PartMenuProps;
  onNewBoard: (item: string) => void;
  /** Arrow keys: move a part on its board to this spot. */
  onNudge: (item: string, board: string, at: PartPosition) => void;
  /** Fixtures placed, moved or removed, and the parts moved aside for them: the board as it is now. */
  onBoardEdit: (board: BoardV1, note: string) => void;
  /** What's happening to a fixture being placed, or why it can't be. */
  onNote: (note: string) => void;
  /** The bit's stick-out and the clamps' and screws' sizes. */
  nestOptions: NestOptions;
  /** The machine's work area, when it is set up: no board is dragged bigger. */
  machine?: { w: number; h: number };
  /** A tab dragged: all tabs of that body (instance id), part frame (mm). */
  onTabsMove?: (board: string, item: string, tabs: { x: number; y: number }[]) => void;
  holds: HoldEditing;
  /** Edit this board. */
  onOpen: (id: string) => void;
  /** Its material, thickness, size, margin or gap changed on the drawing. */
  onBoardChange: (board: BoardV1) => void;
  /** The selected board as it would be at this size: laid out for it. */
  resizedTo: (w: number, h: number) => BoardV1;
  /** Its size dragged, in the selected board's handles. */
  onResize: (w: number, h: number) => void;
  /** The clamps' and screws' sizes, from a fixture's menu. */
  onHoldSizes: () => void;
  /** What needs attention, in a strip of fixed height under the drawing: it covers none of it and never rescales it. */
  status?: React.ReactNode;
  /** "All boards" is what the sidebar is about. */
  allShown: boolean;
  /** Show every board. */
  onAll: () => void;
  /** The tools, in the row over the table. */
  tools?: React.ReactNode;
  /** A size of the tabs on the selected board. */
  onTabSize: (key: 'width' | 'height', value: number) => void;
  /** Dropped on the table, off every board: its upper left corner there. */
  onSetAside: (item: string, at: PartPosition) => void;
  /** In view at first: the selected board, not all of them. */
  startOnBoard?: boolean;
  /** Apply selected board's spacing and holds across all uncut boards. */
  onApplyAll?: (relayout: boolean) => void;
}) {
  const byId = new Map(instances.map(i => [i.id, i]));
  const byPart = new Map(parts.map(p => [p.id, p]));
  const scroller = useRef<HTMLDivElement>(null);
  const [view_, setViewSize] = useState({ w: 0, h: 0 });
  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const measure = () => setViewSize({ w: el.clientWidth, h: el.clientHeight });
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    measure();
    return () => ro.disconnect();
  }, []);
  const area = { w: view_.w || 600, h: view_.h || 800 };

  // The selected board at a size being dragged to, as it would be laid out, with what it stays until the drop.
  const [sizing, setSizing] = useState<{ board: BoardV1; nest: BoardNest } | null>(null);
  const nestOf = (b: JobBoard) => (sizing?.board.id === b.board.id ? sizing.nest : b.nest);
  const tableBoards: TableBoard[] = boards.map(b => {
    const nest = nestOf(b);
    return {
      id: b.board.id,
      w: nest.board.w,
      h: nest.board.h,
      off: nest.unplaced.flatMap(id => {
        const inst = byId.get(id);
        if (!inst) return [];
        const at = b.board.setAside?.[id];
        return [{ id, at, w: inst.size[at?.rotated ? 1 : 0], h: inst.size[at?.rotated ? 0 : 1] }];
      }),
    };
  });
  // Decided when boards come or go, or the area changes: a board resized doesn't send the others to another row.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const cols = useMemo(() => bestColumns(tableBoards, area), [boards.length, area.w, area.h]);
  const table = layoutTable(tableBoards, cols);
  const fitAll = fitScale(area, table.bounds);

  // How much is in view: scale, and scroll position. Left at "fitted", it stays so when the area changes; zoomed or panned, as it is.
  const fitted = useRef<'all' | 'board' | null>(startOnBoard ? 'board' : 'all');
  const [scale, setScale] = useState(0);
  const pxPerMm = scale || fitAll;
  /** A table point (mm) -> content px. The content has half a view around it, so any point can come to the middle. */
  const toPx = (p: { x: number; y: number }, s = pxPerMm) => ({
    x: (p.x + kTableMargin) * s + area.w / 2,
    y: (p.y + kTableMargin) * s + area.h / 2,
  });
  /** A view point (px) -> table point (mm). */
  const fromView = (vx: number, vy: number) => {
    const el = scroller.current;
    return {
      x: ((el?.scrollLeft ?? 0) + vx - area.w / 2) / pxPerMm - kTableMargin,
      y: ((el?.scrollTop ?? 0) + vy - area.h / 2) / pxPerMm - kTableMargin,
    };
  };
  // The table point to bring under a view point, once the new scale is laid out.
  const aim = useRef<{ x: number; y: number; vx: number; vy: number } | null>(null);
  const [, redraw] = useState(0);
  const show = (r: TableRect, what: 'all' | 'board') => {
    fitted.current = what;
    aim.current = { x: r.x + r.w / 2, y: r.y + r.h / 2, vx: area.w / 2, vy: area.h / 2 };
    setScale(fitScale(area, r));
    redraw(n => n + 1);
  };
  const boardRect = (id: string): TableRect | null => {
    const at = table.boards.get(id);
    const b = tableBoards.find(x => x.id === id);
    return at && b ? { ...at, w: b.w, h: b.h } : null;
  };
  const showAll = () => show(table.bounds, 'all');
  const showBoard = (id: string) => {
    const r = boardRect(id);
    if (r) show(r, 'board');
  };
  const zoomTo = (next: number, at?: { x: number; y: number }) => {
    const el = scroller.current;
    const s = Math.min(kMaxScale, Math.max(Math.max(kMinScale, fitAll * 0.5), next));
    if (!el || s === pxPerMm) return;
    const box = el.getBoundingClientRect();
    const vx = at ? at.x - box.left : el.clientWidth / 2,
      vy = at ? at.y - box.top : el.clientHeight / 2;
    aim.current = { ...fromView(vx, vy), vx, vy };
    fitted.current = null;
    setScale(s);
  };
  useLayoutEffect(() => {
    const a = aim.current,
      el = scroller.current;
    if (!a || !el) return;
    aim.current = null;
    const p = toPx(a);
    el.scrollLeft = p.x - a.vx;
    el.scrollTop = p.y - a.vy;
  });
  const boundsKey = `${table.bounds.x},${table.bounds.y},${table.bounds.w},${table.bounds.h}`;
  // Fitted and the area changed: still fitted. With all in view and something on the table now out of view, it comes into view; else
  // the scale stays. Not while something is being dragged.
  const busy = useRef(false);
  const fittedArea = useRef('');
  useEffect(() => {
    if (!view_.w || busy.current || !fitted.current) return;
    const areaKey = `${view_.w},${view_.h},${cols}`;
    const same = fittedArea.current === areaKey;
    fittedArea.current = areaKey;
    if (fitted.current === 'board') {
      if (!same) showBoard(selectedId);
      return;
    }
    const b = table.bounds;
    const [lo, hi] = [fromView(0, 0), fromView(view_.w, view_.h)];
    if (same && b.x >= lo.x && b.y >= lo.y && b.x + b.w <= hi.x && b.y + b.h <= hi.y) return;
    showAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view_.w, view_.h, cols, boundsKey]);
  const zoomRef = useRef({ zoom: pxPerMm, zoomTo });
  zoomRef.current = { zoom: pxPerMm, zoomTo };
  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    // Not passive: Ctrl + wheel (and a trackpad pinch, which the browser sends as one) zooms the drawing, not the page.
    const wheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      const { zoom, zoomTo } = zoomRef.current;
      zoomTo(zoom * Math.exp(-e.deltaY * (e.deltaMode === 1 ? 0.05 : 0.002)), { x: e.clientX, y: e.clientY });
    };
    // Safari (and the Mac app's web view) sends a trackpad pinch as gesture events, not as Ctrl + wheel.
    type Gesture = UIEvent & { scale: number; clientX: number; clientY: number };
    let start = 1;
    const gestureStart = (e: Event) => {
      e.preventDefault();
      start = zoomRef.current.zoom;
    };
    const gestureChange = (e: Event) => {
      e.preventDefault();
      const g = e as Gesture;
      zoomRef.current.zoomTo(start * g.scale, { x: g.clientX, y: g.clientY });
    };
    el.addEventListener('wheel', wheel, { passive: false });
    el.addEventListener('gesturestart', gestureStart, { passive: false });
    el.addEventListener('gesturechange', gestureChange, { passive: false });
    return () => {
      el.removeEventListener('wheel', wheel);
      el.removeEventListener('gesturestart', gestureStart);
      el.removeEventListener('gesturechange', gestureChange);
    };
  }, []);
  // Panning: one pointer dragged on the background; pinching: two touches.
  const pan = useRef<{ id: number; x: number; y: number; left: number; top: number; moved: boolean } | null>(null);
  const touches = useRef(new Map<number, { x: number; y: number }>());
  const pinch = useRef<{ dist: number; zoom: number } | null>(null);
  const panned = useRef(false);
  const onBackgroundDown = (e: React.PointerEvent<HTMLDivElement>) => {
    const t = e.target as Element;
    // A menu of what's on the drawing is elsewhere in the page: its events only pass through here.
    if (!e.currentTarget.contains(t)) return;
    if (t.closest('[data-item],[data-hold],[data-tab],[data-resize],[data-selection-bar],[data-armed-bar],button,input,[role="button"]'))
      return;
    setActive(null);
    setSelectedHold(null);
    if (e.pointerType === 'touch') {
      touches.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (touches.current.size === 2) {
        const [a, b] = [...touches.current.values()];
        pinch.current = { dist: Math.hypot(a.x - b.x, a.y - b.y), zoom: pxPerMm };
        pan.current = null;
        return;
      }
    }
    if (e.button !== 0 && e.button !== 1) return;
    const el = scroller.current!;
    pan.current = { id: e.pointerId, x: e.clientX, y: e.clientY, left: el.scrollLeft, top: el.scrollTop, moved: false };
    panned.current = false;
  };
  const onBackgroundMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.pointerType === 'touch' && touches.current.has(e.pointerId)) {
      touches.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pinch.current && touches.current.size === 2) {
        const [a, b] = [...touches.current.values()];
        zoomTo(pinch.current.zoom * (Math.hypot(a.x - b.x, a.y - b.y) / Math.max(1, pinch.current.dist)), {
          x: (a.x + b.x) / 2,
          y: (a.y + b.y) / 2,
        });
        return;
      }
    }
    const p = pan.current;
    if (!p || p.id !== e.pointerId) return;
    const dx = e.clientX - p.x,
      dy = e.clientY - p.y;
    if (!p.moved && Math.hypot(dx, dy) < kDragStart) return;
    if (!p.moved) (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    p.moved = true;
    panned.current = true;
    fitted.current = null;
    scroller.current!.scrollLeft = p.left - dx;
    scroller.current!.scrollTop = p.top - dy;
  };
  const onBackgroundUp = (e: React.PointerEvent<HTMLDivElement>) => {
    touches.current.delete(e.pointerId);
    if (touches.current.size < 2) pinch.current = null;
    if (pan.current?.id === e.pointerId) pan.current = null;
  };

  const { drag, update } = usePartDrag(
    { boards, instances, bit, pxPerMm, onDrop, onNewBoard, onSelect, onSetAside, nestOptions, fromView },
    { scroller, fitted, panned }
  );
  // The part last clicked or focused: its ⋯ menu button shows on it. `menu`: that menu is open.
  const [active, setActive] = useState<string | null>(null);
  const [menu, setMenu] = useState(false);

  const { tool, edit, setEdit, selectedHold, setSelectedHold, selectedTab, setSelectedTab, bands, preview, commit } = holds;
  // What's placed as a fixture; the tab tool works on the outlines.
  const holdTool = tool === 'tab' ? null : tool;
  // The selected thing's Delete, for the key when the focus is elsewhere.
  const deleteSelected = useRef<(() => void) | undefined>(undefined);
  deleteSelected.current = undefined;
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if ((e.key !== 'Delete' && e.key !== 'Backspace') || e.defaultPrevented) return;
      if ((e.target as HTMLElement | null)?.closest?.('input,textarea,select,[contenteditable="true"],[role="menu"],[role="dialog"]'))
        return;
      if (!deleteSelected.current) return;
      e.preventDefault();
      deleteSelected.current();
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, []);
  // The menu of a through hole's middle, from a click on it.
  const [holeMenu, setHoleMenu] = useState<{ middle: HoleMiddle; at: { x: number; y: number }; plan: PlanResult | undefined } | null>(null);
  // A fixture's menu, from a right-click on it.
  const [holdMenu, setHoldMenu] = useState<number | null>(null);

  const startDrag = (board: JobBoard, item: string, e: React.PointerEvent) => {
    if (e.button !== 0 || tool) return;
    e.preventDefault();
    (e.currentTarget as SVGGElement).focus({ preventScroll: true });
    onSelect(board.board.id);
    setActive(item);
    setSelectedHold(null);
    const placed = board.nest.placements.find(p => p.id === item);
    const inst = byId.get(item);
    const frame = (e.currentTarget as SVGGElement).closest('svg')?.querySelector<SVGGraphicsElement>('[data-board-frame]');
    const p = frame && toBoard(frame, e.clientX, e.clientY);
    const aside = board.board.setAside?.[item];
    // A part off the board has no spot on it: it's held at its middle, as it lies.
    const grab =
      placed && p
        ? { x: p.x - placed.x, y: p.y - placed.y }
        : !placed && inst
          ? { x: inst.size[aside?.rotated ? 1 : 0] / 2, y: inst.size[aside?.rotated ? 0 : 1] / 2 }
          : null;
    if (!grab) return;
    const pointer = { x: e.clientX, y: e.clientY };
    update({
      item,
      from: board.board.id,
      rotated: placed?.rotated ?? aside?.rotated ?? false,
      grab,
      start: pointer,
      pointer,
      moved: false,
      target: null,
    });
  };

  const nudge = (board: JobBoard, item: string, e: React.KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === 'ContextMenu' || (e.key === 'F10' && e.shiftKey)) {
      e.preventDefault();
      setActive(item);
      setMenu(true);
      return;
    }
    const step = e.shiftKey ? 10 : 1;
    const d = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, step], ArrowDown: [0, -step] }[e.key];
    const placed = board.nest.placements.find(p => p.id === item);
    if (!d || !placed) return;
    e.preventDefault();
    onNudge(item, board.board.id, { x: round(placed.x + d[0]), y: round(placed.y + d[1]), rotated: placed.rotated });
  };

  const dragging = drag?.moved ? drag : null;
  busy.current = !!dragging || !!sizing;
  const dragInst = dragging && byId.get(dragging.item);
  const overRail =
    dragging?.target?.kind === 'rail'
      ? { board: dragging.target.board, ok: !!dragging.target.drop?.at }
      : dragging?.target?.kind === 'new'
        ? ('new' as const)
        : null;
  const anyHolds = boards.some(b => b.nest.holds.length > 0);
  const hardware = nestOptions.hardware ?? kDefaultHardware;

  // What's measured on the selected board, for its heading and its drawing.
  const selJob = boards.find(b => b.board.id === selectedId);
  const selEditing = edit?.board === selectedId ? edit : null;
  const selNest = selJob && (selEditing?.nest ?? nestOf(selJob));
  const selHere = !!selJob && !isCut(selJob.board);
  const selInput = selJob && selNest ? settleInputOf(sizing?.board ?? selJob.board, selNest, instances, bit, nestOptions) : null;
  const selFixtures = selEditing?.fixtures ?? sizing?.board.fixtures ?? selJob?.board.fixtures ?? [];
  const selOffcut = selInput && largestOffcut(selInput.input, selInput.spots, selFixtures);
  const contentW = toPx({ x: table.bounds.x + table.bounds.w + kTableMargin, y: 0 }).x + area.w / 2;
  const contentH = toPx({ x: 0, y: table.bounds.y + table.bounds.h + kTableMargin }).y + area.h / 2;
  return (
    <div className="relative flex min-h-0 flex-1">
      <div className="relative flex min-w-0 flex-1 flex-col">
        <div className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1 border-b bg-background px-2 py-1">
          {tools}
          <BoardRail
            boards={boards}
            instances={instances}
            hardware={hardware}
            selectedId={selectedId}
            allShown={allShown}
            dragging={!!dragging}
            overRail={overRail}
            onAll={onAll}
            onOpen={onOpen}
            showAll={showAll}
            showBoard={showBoard}
          />
        </div>
        {selJob && selNest && (
          <SelectedBoardHead selJob={selJob} selNest={selNest} selHere={selHere} selOffcut={selOffcut} onBoardChange={onBoardChange} />
        )}
        {tool && <ArmedToolBar tool={tool} nestOptions={nestOptions} holds={holds} onHoldSizes={onHoldSizes} />}
        <div
          ref={scroller}
          data-board-scroller
          className="relative min-h-0 flex-1 overflow-auto"
          onPointerDown={onBackgroundDown}
          onPointerMove={onBackgroundMove}
          onPointerUp={onBackgroundUp}
          onPointerCancel={onBackgroundUp}
          onClickCapture={e => {
            // The end of a pan is not a click on the board under the pointer.
            if (panned.current) {
              panned.current = false;
              e.stopPropagation();
            }
          }}>
          <div className="relative" style={{ width: contentW, height: contentH }}>
            {boards.map((b, i) => {
              const { board } = b;
              const selected = board.id === selectedId;
              const editing = edit?.board === board.id ? edit : null;
              const nest = editing?.nest ?? nestOf(b);
              const here = selected && !isCut(board);
              const held = selectedHold?.board === board.id ? selectedHold.i : null;
              const shownFixtures = (selected && selFixtures) || (editing?.fixtures ?? board.fixtures ?? []);
              const pointed = editing ? (editing.i ?? shownFixtures.length - 1) : held;
              // Measured on what's shown, on the selected board only: these are a little work per pointer move.
              const input = selected ? selInput : null;
              const pointedAt = pointed === null ? undefined : shownFixtures[pointed];
              const offcut = selected ? selOffcut : null;
              const play =
                !input || !pointedAt || editing?.settled === null
                  ? null
                  : pointedAt.kind === 'clamp'
                    ? { kind: 'clamp' as const, side: pointedAt.side, ...clampPlay(input.input, input.spots, pointedAt) }
                    : { kind: 'screw' as const, x: pointedAt.x, y: pointedAt.y, r: screwPlay(input.input, input.spots, pointedAt) };
              const target = dragging?.target?.kind === 'drawing' && dragging.target.board === board.id ? dragging.target : null;
              const fits = dragInst && sameThickness(dragInst.thickness, board.thickness);
              const tabHeight = board.retention === 'tabs' ? board.tabs.height : undefined;
              // Only on tab boards: the badges are about parts whose tabs can't hold.
              const holdingOf = (id: string) =>
                board.retention === 'tabs' ? plans[i]?.holding?.find(h => h.name === byId.get(id)?.name)?.how : undefined;
              const unheld = new Set(nest.placements.filter(p => holdingOf(p.id) === 'unheld').map(p => p.id));
              const nutHits = nest.nutAbove < 0;
              const padPx = kBoardPad * pxPerMm;
              const spot = toPx(table.boards.get(board.id)!);
              return (
                <section
                  key={board.id}
                  aria-label={`${boardLabel(board)} drawing`}
                  data-board-drop={board.id}
                  data-board-drawing
                  title={selected ? undefined : `Edit ${boardLabel(board)}`}
                  style={{ left: spot.x - padPx, top: spot.y - padPx }}
                  onClick={e => {
                    // Not what's on it, nor a menu of it (React brings a portal's clicks here too).
                    const on = e.target as Element;
                    if (!e.currentTarget.contains(on) || on.closest('button,input,[data-part-marks],[data-unplaced]')) return;
                    onOpen(board.id);
                  }}
                  onDoubleClick={e => {
                    if (!(e.target as Element).closest('[data-item],[data-hold],button,input')) showBoard(board.id);
                  }}
                  className={cn(
                    'absolute rounded-lg border border-transparent transition-colors',
                    !selected && 'cursor-pointer hover:border-primary/40',
                    selected && 'z-10 border-primary/60',
                    dragging && fits && 'border-dashed border-primary/60',
                    dragging && !fits && 'opacity-50',
                    target && fits && 'border-solid border-primary bg-primary/5 ring-2 ring-primary',
                    target && !target.drop?.at && 'border-red-500 ring-red-500'
                  )}>
                  <div
                    className="pointer-events-none absolute flex items-center gap-x-2 overflow-hidden text-xs whitespace-nowrap *:shrink-0"
                    // Stops short of the next board's label.
                    style={{ left: padPx, bottom: `calc(100% - ${padPx}px + 12px)`, maxWidth: (nest.board.w + 0.7 * kTableGap) * pxPerMm }}>
                    <span className="font-medium">{boardLabel(board)}</span>
                    {isCut(board) && <CutBadge board={board} />}
                    <span className="!shrink truncate text-muted-foreground">
                      {fmt(board.thickness)} mm ·{' '}
                      <span className="font-mono text-[11px]">
                        {boardSizeLabel(sizing?.board.id === board.id ? sizing.board : board, nest)}
                      </span>
                    </span>
                    {nest.unplaced.length > 0 && (
                      <span className="font-medium text-amber-600 dark:text-amber-400">{nest.unplaced.length} off it</span>
                    )}
                    {unheld.size > 0 && <span className="font-medium text-destructive">{unheld.size} can’t hold</span>}
                    {nutHits && <span className="font-medium text-destructive">collet nut hits</span>}
                    {fetching[i] && <LoadingSpinner className="size-3" />}
                    <DropStatus dragging={!!dragging} fits={!!fits} target={target} from={dragging?.from === board.id} />
                  </div>
                  <div className="relative shrink-0">
                    <NestView
                      nest={nest}
                      instances={instances}
                      parts={parts}
                      // Its tabs are for the layout it had: not over the one being dragged to.
                      plan={sizing?.board.id === board.id ? undefined : plans[i]}
                      tabHeight={tabHeight}
                      unit={kUnitPx / pxPerMm}
                      pxPerMm={pxPerMm}
                      padMm={kBoardPad}
                      quiet={!here}
                      label={
                        boardSizeLabel(board, nest) === '–'
                          ? `${boardLabel(board)}, empty`
                          : `${boardLabel(board)}, ${fmt(nest.board.w)} by ${fmt(nest.board.h)} mm, with ${nest.placements.length} parts`
                      }
                      className={cn(
                        'block shrink-0 touch-none overflow-visible transition-opacity',
                        fetching[i] && plans[i] && 'opacity-70'
                      )}
                      dragging={dragging?.from === board.id ? dragging.item : null}
                      preview={
                        target && dragging
                          ? target.drop?.at
                            ? { item: dragging.item, at: target.drop.at, fits: true }
                            : { item: dragging.item, at: target.at, fits: false }
                          : null
                      }
                      onPartPointerDown={(item, e) => startDrag(b, item, e)}
                      onPartKeyDown={(item, e) => nudge(b, item, e)}
                      onPartFocus={item => {
                        onSelect(board.id);
                        setActive(item);
                      }}
                      onPartContextMenu={(item, e) => {
                        e.preventDefault();
                        onSelect(board.id);
                        setActive(item);
                        setMenu(true);
                      }}
                      unheld={unheld}
                      fixtures={
                        here
                          ? {
                              tool: holdTool,
                              preview: editing && editing.i === null ? pointed : null,
                              moving: editing?.i ?? null,
                              refused: editing?.settled === null,
                              selected: held,
                              bands,
                              offcut,
                              play,
                              onHover: p => {
                                if (p && holdTool) preview(b, holdTool, p, null);
                                else if (edit?.i === null) setEdit(null);
                              },
                              onPlace: p => {
                                if (!holdTool) return;
                                onSelect(board.id);
                                // A click without hovering first (a finger): where it landed.
                                const f = {
                                  ...fixtureAt(holdTool, p, board, b.nest, instances, bit, {
                                    ...nestOptions,
                                    clampWidth: holds.newSizes.clamp.w,
                                  }),
                                  ...holds.newSizes[holdTool],
                                };
                                const fixtures = [...(board.fixtures ?? []), f];
                                const settled = settleBoard(board, instances, bit, fixtures, nestOptions);
                                setEdit(null);
                                if (!settled) {
                                  onNote(
                                    reserved(f, settleInputOf(board, b.nest, instances, bit, nestOptions).input)
                                      ? 'That spot is kept clear: the XY zero corner is where you probe.'
                                      : `No room here on a ${b.nest.board.w} × ${b.nest.board.h} board. Slide along the edge, or use a bigger board.`
                                  );
                                  return;
                                }
                                setSelectedHold({ board: board.id, i: fixtures.length - 1 });
                                onBoardEdit(settled, layoutChange(b.nest, nestBoard(settled, instances, bit, nestOptions), instances));
                              },
                              onSelect: k => {
                                onSelect(board.id);
                                setSelectedHold(k === null ? null : { board: board.id, i: k });
                              },
                              onDrag: (k, p) => {
                                const f = board.fixtures?.[k];
                                if (f) preview(b, f.kind, p, k);
                              },
                              onDrop: () => commit(b),
                              onMenu: setHoldMenu,
                              onRemove: k => {
                                setSelectedHold(null);
                                onBoardEdit(
                                  { ...board, fixtures: (board.fixtures ?? []).filter((_, j) => j !== k) },
                                  'Removed. Parts stay where they are; Tighten layout closes the gaps.'
                                );
                              },
                            }
                          : undefined
                      }
                      tabTool={here && tool === 'tab'}
                      selectedTab={selectedTab?.board === board.id ? selectedTab : null}
                      onTabSelect={(part, k) => setSelectedTab({ board: board.id, part, i: k })}
                      onTabsChange={
                        onTabsMove && selected && board.retention === 'tabs' && !holdTool
                          ? (item, tabs) => onTabsMove(board.id, item, tabs)
                          : undefined
                      }
                      onHole={
                        here && onHoleChoice && !fetching[i] ? (middle, at) => setHoleMenu({ middle, at, plan: plans[i] }) : undefined
                      }
                    />
                    {here && !tool && !dragging && !editing && (
                      <BoardOverlay
                        nest={nest}
                        instances={instances}
                        pxPerMm={pxPerMm}
                        padPx={padPx}
                        bit={bit}
                        machine={machine}
                        compact={nest.board.w * pxPerMm < kLabelsFrom}
                        tight={grip => {
                          const most = (other: number) => {
                            if (!machine) return 3000;
                            return Math.max(machine.w, machine.h) === other
                              ? Math.min(machine.w, machine.h)
                              : Math.max(machine.w, machine.h);
                          };
                          const of = (side: 'w' | 'h') =>
                            tightestSide(board, b.nest, side, most(b.nest.board[side === 'w' ? 'h' : 'w']), instances, bit, nestOptions);
                          return { w: grip !== 'h' ? of('w') : undefined, h: grip !== 'w' ? of('h') : undefined };
                        }}
                        onDraft={size => {
                          if (!size) return setSizing(null);
                          const next = resizedTo(size.w, size.h);
                          const nested = nestBoard(next, instances, bit, nestOptions);
                          setSizing({ board: next, nest: nested });
                          const off = nested.unplaced.filter(id => !next.setAside?.[id]).map(id => byId.get(id)?.name ?? id);
                          onNote(
                            `${nested.board.w} × ${nested.board.h} mm · ${((nested.board.w * nested.board.h) / 1e6).toFixed(2)} m² · ${Math.round(nested.yield * 100)} % yield` +
                              (off.length
                                ? ` · ${off.join(', ')} ${off.length === 1 ? 'goes' : 'go'} off the board. Drag back to keep ${off.length === 1 ? 'it' : 'them'}.`
                                : '')
                          );
                        }}
                        onResize={onResize}
                        onMargin={margin => onBoardChange({ ...board, margin })}
                        onGap={gap => onBoardChange({ ...board, gap })}
                        onApplyAll={onApplyAll}
                      />
                    )}
                    {here &&
                      !tool &&
                      !dragging &&
                      !editing &&
                      held !== null &&
                      nest.holds[held] &&
                      (() => {
                        const hp = nest.holds[held];
                        const kind = hp.kind;
                        const name = kind === 'clamp' ? 'clamp' : 'screw';
                        const onBoard = holds.countOf(kind, false);
                        const onAllBoards = holds.countOf(kind, true);
                        const remove = () => {
                          setSelectedHold(null);
                          onBoardEdit(
                            { ...board, fixtures: (board.fixtures ?? []).filter((_, j) => j !== held) },
                            'Removed. Parts stay where they are; Tighten layout closes the gaps.'
                          );
                        };
                        deleteSelected.current = remove;
                        return (
                          <SelectionBar<HoldSizeKey>
                            key={`hold-${held}`}
                            id={`hold-${held}`}
                            title={
                              kind === 'clamp'
                                ? `Clamp · ${shownFixtures[held]?.kind === 'clamp' ? (shownFixtures[held] as { side: string }).side : ''} edge`
                                : 'Screw'
                            }
                            at={{ x: hp.x * pxPerMm + padPx, y: (nest.board.h - hp.y) * pxPerMm + padPx }}
                            fields={
                              kind === 'clamp'
                                ? [
                                    { key: 'w', label: 'Width', value: hp.w ?? 0 },
                                    { key: 'd', label: 'Reach', value: hp.d },
                                    { key: 'height', label: 'Height', value: hp.height ?? 0 },
                                  ]
                                : [
                                    { key: 'd', label: 'Head ⌀', value: hp.d },
                                    { key: 'height', label: 'Height', value: hp.height ?? 0 },
                                  ]
                            }
                            onField={(key, value) => holds.setHoldSize(held, key, value)}
                            scopes={[
                              ...(onBoard > 1 ? [{ id: 'board', label: `all ${onBoard} on this board` }] : []),
                              ...(onAllBoards > onBoard ? [{ id: 'all', label: `all ${onAllBoards} on all boards` }] : []),
                            ]}
                            onApply={(scope, key, value) => holds.applyHoldSize(kind, key, value, scope === 'all')}
                            onDelete={remove}
                            deleteLabel={`Delete this ${name}`}
                            menu={[
                              {
                                label: `Delete all ${name}s on this board`,
                                icon: <Trash2 className="size-4" />,
                                onSelect: () => holds.removeAllHolds(kind),
                              },
                              { label: 'Clamp and screw sizes…', icon: <Ruler className="size-4" />, onSelect: onHoldSizes },
                            ]}
                          />
                        );
                      })()}
                    {here &&
                      !tool &&
                      !dragging &&
                      !editing &&
                      selectedTab?.board === board.id &&
                      (() => {
                        const hold = plans[i]?.hold?.find(h => h.part === selectedTab.part);
                        const tab = hold?.tabs[selectedTab.i];
                        const p = nest.placements.find(q => byId.get(q.id)?.name === selectedTab.part);
                        const inst = p && byId.get(p.id);
                        if (!hold || !tab || !p || !inst) return null;
                        const spots = tabSpots(hold.tabs);
                        const remove =
                          spots.length > 1 && onTabsMove
                            ? () => {
                                const rest = spots.filter(q => Math.hypot(q.x - tab.at.x, q.y - tab.at.y) >= 1);
                                setSelectedTab(null);
                                onTabsMove(
                                  board.id,
                                  p.id,
                                  rest.map(q => toPartFrame(p, inst.size, q))
                                );
                              }
                            : undefined;
                        deleteSelected.current = remove;
                        const reset = partMenu(b, p.id).onTabsReset;
                        const others = boards.filter(x => x.board.retention === 'tabs' && !isCut(x.board)).length;
                        return (
                          <SelectionBar<'width' | 'height'>
                            key={`tab-${selectedTab.part}-${selectedTab.i}`}
                            id="tab"
                            title={`Tab · ${selectedTab.part}`}
                            note="Size: all tabs on this board"
                            at={{ x: tab.at.x * pxPerMm + padPx, y: (nest.board.h - tab.at.y) * pxPerMm + padPx }}
                            fields={[
                              { key: 'width', label: 'Length', value: board.tabs.width },
                              { key: 'height', label: 'Height', value: board.tabs.height },
                            ]}
                            onField={onTabSize}
                            scopes={others > 1 ? [{ id: 'all', label: `tabs on all ${others} boards` }] : []}
                            onApply={(_, key, value) => holds.setTabSize(key, value, true)}
                            onDelete={remove}
                            deleteLabel="Delete this tab"
                            menu={
                              reset
                                ? [
                                    {
                                      label: 'Place this part’s tabs automatically',
                                      icon: <WandSparkles className="size-4" />,
                                      onSelect: () => {
                                        setSelectedTab(null);
                                        reset();
                                      },
                                    },
                                  ]
                                : []
                            }
                          />
                        );
                      })()}
                    {here && holeMenu && onHoleChoice && !fetching[i] && holeMenu.plan === plans[i] && (
                      <HoleMenu
                        {...holeMenu}
                        left={holeMenu.at.x * pxPerMm + padPx}
                        top={(nest.board.h - holeMenu.at.y) * pxPerMm + padPx}
                        onClose={() => setHoleMenu(null)}
                        onChoose={choice => {
                          if (fetching[i] || holeMenu.plan !== plans[i]) return;
                          const partId = instances.find(i => i.id === holeMenu.middle.part)?.partId;
                          if (partId) onHoleChoice(partId, holeMenu.middle.hole, choice);
                        }}
                      />
                    )}
                    {here && holdMenu !== null && nest.holds[holdMenu] && (
                      <DropdownMenu modal={false} open onOpenChange={open => !open && setHoldMenu(null)}>
                        <DropdownMenuTrigger asChild>
                          <span
                            aria-hidden
                            className="absolute"
                            style={{
                              left: nest.holds[holdMenu].x * pxPerMm + padPx,
                              top: (nest.board.h - nest.holds[holdMenu].y) * pxPerMm + padPx,
                            }}
                          />
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="start">
                          <DropdownMenuItem onSelect={onHoldSizes}>Clamp and screw sizes…</DropdownMenuItem>
                          <DropdownMenuItem
                            onSelect={() => {
                              const fixtures = (board.fixtures ?? []).filter((_, j) => j !== holdMenu);
                              setSelectedHold(null);
                              onBoardEdit({ ...board, fixtures }, 'Removed. Parts stay where they are; Tighten layout closes the gaps.');
                            }}>
                            Remove this {nest.holds[holdMenu].kind}
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    )}
                    {/* On each part's upper right corner: its pin and holding badges, and the ⋯ menu of the part last touched. */}
                    {!dragging &&
                      !tool &&
                      nest.placements.map(p => {
                        const inst = byId.get(p.id);
                        if (!inst) return null;
                        const r = placedRect(p, inst);
                        const pinned = !!board.pinned?.includes(p.id);
                        const holding = holdingOf(p.id);
                        const mine = active === p.id;
                        if (!pinned && (!holding || holding === 'placed') && !mine) return null;
                        return (
                          <div
                            key={p.id}
                            data-part-marks={inst.name}
                            className="pointer-events-none absolute flex -translate-x-full items-center gap-0.5 p-0.5 *:pointer-events-auto"
                            style={{ left: (r.x + r.w) * pxPerMm + padPx, top: (nest.board.h - r.y - r.h) * pxPerMm + padPx }}>
                            <PartBadges pinned={pinned} holding={holding} />
                            {mine && (
                              <DropdownMenu modal={false} open={menu} onOpenChange={setMenu}>
                                <DropdownMenuTrigger asChild>
                                  <button
                                    aria-label={`${inst.name} menu`}
                                    title="Move it to another board, or unpin it"
                                    className="rounded-full border bg-background px-1 text-muted-foreground shadow-sm hover:text-foreground">
                                    <MoreHorizontal className="size-3.5" />
                                  </button>
                                </DropdownMenuTrigger>
                                <PartMenuContent {...partMenu(b, p.id)} />
                              </DropdownMenu>
                            )}
                          </div>
                        );
                      })}
                  </div>
                </section>
              );
            })}
            {boards.flatMap(b =>
              nestOf(b).unplaced.map(id => {
                const inst = byId.get(id);
                const part = inst && byPart.get(inst.partId);
                const at = table.off.get(id);
                if (!inst || !part || !at) return null;
                const spot = toPx(at);
                const rotated = !!b.board.setAside?.[id]?.rotated;
                return (
                  <OffBoardPart
                    key={id}
                    inst={inst}
                    part={part}
                    rotated={rotated}
                    left={spot.x}
                    top={spot.y}
                    pxPerMm={pxPerMm}
                    faint={dragging?.item === id}
                    menuOpen={active === id && menu}
                    onMenuOpen={open => {
                      setActive(id);
                      setMenu(open);
                    }}
                    menuProps={partMenu(b, id)}
                    pinned={!!b.board.pinned?.includes(id)}
                    onPointerDown={e => startDrag(b, id, e)}
                  />
                );
              })
            )}
            {dragging && (
              <div
                data-new-board-drop
                aria-label="New board"
                style={{
                  left: toPx(table.newBoard).x,
                  top: toPx(table.newBoard).y,
                  width: table.newBoard.w * pxPerMm,
                  height: table.newBoard.h * pxPerMm,
                }}
                className={cn(
                  'absolute flex items-center justify-center gap-2 rounded-lg border-2 border-dashed bg-background/60 text-center text-sm text-muted-foreground',
                  dragging.target?.kind === 'new' && 'border-primary bg-primary/5 text-foreground'
                )}>
                <Plus className="size-4 shrink-0" /> New board
              </div>
            )}
          </div>
          {dragging && dragInst && (
            <Ghost
              inst={dragInst}
              part={byPart.get(dragInst.partId)}
              drag={dragging}
              pxPerMm={pxPerMm}
              bad={(dragging.target?.kind === 'drawing' || dragging.target?.kind === 'rail') && !dragging.target.drop?.at}
              offBoard={dragging.target?.kind === 'table'}
            />
          )}
        </div>
        {status}
        <DrawingControls boards={boards} anyHolds={anyHolds} pxPerMm={pxPerMm} fitAll={fitAll} zoomTo={zoomTo} showAll={showAll} />
      </div>
    </div>
  );
}
