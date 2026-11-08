import { PageHeader } from '@/components/page-header';
import { CamPage } from '@/cam/CamPage';
import { CamJobBar } from '@/cam/CamJobBar';
import { NumberInput } from '@/cam/NumberInput';
import { LetteringFontPicker } from '@/cam/LetteringFontPicker';
import { carvingProblem, itemName, kVBits, placeItem, withItems, type CarvingArt, type CarvingItemV1, type CarvingV1 } from '@/cam/carving';
import { outlineArt } from '@/cam/carvingOutline';
import { useCamJob, useSaveCamJob } from '@/cam/camQueries';
import type { BoardV1 } from '@/cam/boards';
import type { CamJobV1 } from '@/cam/jobDb';
import { kDefaultPlan } from '@/cam/planSettings';
import { vConeDepth } from '@wbcnc/cam';
import { createFileRoute, Link, useParams } from '@tanstack/react-router';
import { Button } from '@wbcnc/ui/components/button';
import { Input } from '@wbcnc/ui/components/input';
import { LoadingSpinner } from '@wbcnc/ui/components/loading-spinner';
import { cn } from '@wbcnc/ui/lib/utils';
import { SelectionBar } from '@/cam/boards/SelectionBar';
import { AlertTriangle, Crosshair, FileUp, Image, ListOrdered, Trash2, Type } from 'lucide-react';
import { useEffect, useLayoutEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type RefObject } from 'react';

export const Route = createFileRoute('/cam/$jobId/carve')({ component: CarveStep });

type Loop = { x: number; y: number }[];
type BoardGrip = 'w' | 'h' | 'wh';

/** A dragged board edge moves in these steps (Shift: 1 mm), between the board size fields' limits. */
const kBoardSnap = 10;
const kBoardLeast = 20;
const kBoardMost = 2000;

/** The carving's outlines as an SVG path, board mm with Y up drawn Y down. */
const pathOf = (region: Loop[], h: number) =>
  region.map(loop => `M${loop.map(p => `${p.x.toFixed(2)},${(h - p.y).toFixed(2)}`).join('L')}Z`).join('');

function bounds(region: Loop[]) {
  const pts = region.flat();
  if (!pts.length) return null;
  const xs = pts.map(p => p.x),
    ys = pts.map(p => p.y);
  return { x0: Math.min(...xs), x1: Math.max(...xs), y0: Math.min(...ys), y1: Math.max(...ys) };
}

/**
 * The Carve step of a carving job: the artwork on its board, placed by eye. The artwork is outlined here and saved with
 * the job; Plan cuts those outlines. Board size and holding are set here too, since a carving has no Boards step.
 */
function CarveStep() {
  const { jobId } = useParams({ from: '/cam/$jobId/carve' });
  const { data: job, isPending } = useCamJob(jobId);
  if (isPending) return <Shell loading="Opening the carving…" />;
  if (!job) return <Shell message="This job doesn't exist (any more)." />;
  if (!job.carving) return <Shell message="This job is not a carving." />;
  return <CarveEditor key={job.id} job={job} carving={job.carving} board={job.boards?.[0]} />;
}

function CarveEditor({ job, carving, board }: { job: CamJobV1; carving: CarvingV1; board?: BoardV1 }) {
  const save = useSaveCamJob(job);
  const saved = board?.size.fit === false ? board.size : { w: 300, h: 140 };
  // While an edge of the board is dragged, its new size is shown (and in the fields) before it's saved.
  const [resized, setResized] = useState<{ w: number; h: number; from: { w: number; h: number } } | null>(null);
  const size = resized ? { w: resized.w, h: resized.h } : saved;
  const thickness = board?.thickness ?? 18;
  const [selectedId, setSelectedId] = useState<string | null>(carving.items[0]?.id ?? null);
  // While dragging, the item is shown before it's saved.
  const [dragged, setDragged] = useState<CarvingItemV1 | null>(null);
  const [pending, setPending] = useState<Record<string, Pick<CarvingItemV1, 'art' | 'height'>>>({});
  const [errors, setErrors] = useState<Record<string, string | undefined>>({});
  const [adding, setAdding] = useState(0);
  const [artResets, setArtResets] = useState<Record<string, number>>({});
  const selected = carving.items.find(item => item.id === selectedId);
  const editing = selected && { ...selected, ...pending[selected.id] };
  const shown = dragged ?? selected;
  const outlining = Object.keys(pending).length > 0 || adding > 0;
  const lastFont = useRef(carving.items.findLast(item => item.art.kind === 'text')?.art);
  const svgInput = useRef<HTMLInputElement>(null);
  const replaceId = useRef<string | null>(null);
  // The browser's file chooser can take a moment to appear, so the SVG button shows it is opening until the chooser closes.
  const [choosing, setChoosing] = useState(false);
  useEffect(() => {
    if (!choosing) return;
    const input = svgInput.current;
    const done = () => setChoosing(false);
    // Cancelling fires `cancel`; browsers without it return focus to the window when the chooser closes.
    input?.addEventListener('cancel', done);
    window.addEventListener('focus', done);
    return () => {
      input?.removeEventListener('cancel', done);
      window.removeEventListener('focus', done);
    };
  }, [choosing]);
  const chooseSvg = (replace: string | null) => {
    replaceId.current = replace;
    setChoosing(true);
    svgInput.current?.click();
  };
  const outlineRuns = useRef(new Map<string, number>());
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const saveCarving = (next: CarvingV1, boards = job.boards) => save.mutate({ ...job, carving: next, boards });
  const updateItem = (id: string, change: Partial<CarvingItemV1>) =>
    save.mutateCurrent(current => {
      if (!current.carving) return null;
      return {
        ...current,
        carving: withItems(
          current.carving,
          current.carving.items.map(item => (item.id === id ? { ...item, ...change } : item))
        ),
      };
    });
  // Only artwork and height need new outlines. Each item's latest request wins, keeping later moves and other items.
  const redraw = async (next: CarvingItemV1) => {
    const run = (outlineRuns.current.get(next.id) ?? 0) + 1;
    outlineRuns.current.set(next.id, run);
    setPending(pending => ({ ...pending, [next.id]: { art: next.art, height: next.height } }));
    try {
      const { region } = await outlineArt(next.art, next.height);
      if (!mounted.current || run !== outlineRuns.current.get(next.id)) return;
      setErrors(errors => ({ ...errors, [next.id]: undefined }));
      updateItem(next.id, { art: next.art, height: next.height, outline: region });
      if (next.art.kind === 'text') lastFont.current = next.art;
    } catch (e) {
      if (!mounted.current || run !== outlineRuns.current.get(next.id)) return;
      setErrors(errors => ({ ...errors, [next.id]: e instanceof Error ? e.message : String(e) }));
      // Discard draft text too, without replaying its debounce against the saved font.
      setArtResets(resets => ({ ...resets, [next.id]: (resets[next.id] ?? 0) + 1 }));
    } finally {
      if (mounted.current && run === outlineRuns.current.get(next.id))
        setPending(pending => {
          const rest = { ...pending };
          delete rest[next.id];
          return rest;
        });
    }
  };
  // Text typed within the debounce is committed before its editor unmounts: another selection, or a drag that hides the bar.
  const flushDraft = useRef<(() => void) | null>(null);
  const select = (id: string | null) => {
    if (id !== selectedId) flushDraft.current?.();
    setSelectedId(id);
  };
  // New items are outlined before they're added, so a file that can't be read adds nothing.
  const addItem = async (art: CarvingArt) => {
    const height = art.kind === 'text' ? 20 : Math.min(40, size.h);
    setAdding(n => n + 1);
    try {
      const { region } = await outlineArt(art, height);
      if (!mounted.current) return;
      setErrors(errors => ({ ...errors, adding: undefined }));
      const id = crypto.randomUUID();
      save.mutateCurrent(current => {
        if (!current.carving) return null;
        const item: CarvingItemV1 = { id, art, height, ...freeSpot(current.carving.items, region, size), rotation: 0, outline: region };
        return { ...current, carving: withItems(current.carving, [...current.carving.items, item]) };
      });
      select(id);
      if (art.kind === 'text') lastFont.current = art;
    } catch (e) {
      if (mounted.current) setErrors(errors => ({ ...errors, adding: e instanceof Error ? e.message : String(e) }));
    } finally {
      if (mounted.current) setAdding(n => n - 1);
    }
  };
  const deleteItem = (id: string) => {
    outlineRuns.current.set(id, (outlineRuns.current.get(id) ?? 0) + 1);
    setPending(pending => {
      const rest = { ...pending };
      delete rest[id];
      return rest;
    });
    setErrors(errors => {
      const rest = { ...errors };
      delete rest[id];
      return rest;
    });
    if (selectedId === id) setSelectedId(null);
    drag.current = null;
    setDragged(null);
    save.mutateCurrent(current =>
      !current.carving
        ? null
        : {
            ...current,
            carving: withItems(
              current.carving,
              current.carving.items.filter(item => item.id !== id)
            ),
          }
    );
  };
  useEffect(() => {
    const keydown = (e: KeyboardEvent) => {
      // Keys in the font picker's popup are its own: Escape there closes it, not the selection.
      if (e.target instanceof Element && e.target.closest('[role="dialog"], [data-radix-popper-content-wrapper]')) return;
      if (e.key === 'Escape') {
        select(null);
        drag.current = null;
        setDragged(null);
      }
      const target = e.target;
      if (target instanceof Element && target.closest('input, textarea, select, [contenteditable], [role="textbox"], [role="combobox"]'))
        return;
      if ((e.key === 'Delete' || e.key === 'Backspace') && selectedId) {
        e.preventDefault();
        deleteItem(selectedId);
      }
    };
    window.addEventListener('keydown', keydown);
    return () => window.removeEventListener('keydown', keydown);
  });
  const setBoard = (change: Partial<{ w: number; h: number; thickness: number }>) => {
    if (!board) return;
    const w = change.w ?? size.w,
      h = change.h ?? size.h;
    const next: BoardV1 = {
      ...board,
      size: { fit: false, w, h },
      thickness: change.thickness ?? board.thickness,
    };
    saveCarving(
      withItems(
        carving,
        carving.items.map(item => ({ ...item, x: Math.min(item.x, w), y: Math.min(item.y, h) }))
      ),
      [next, ...(job.boards ?? []).slice(1)]
    );
  };

  // Drag an item to move it, its corner to size it, or the handle above it to rotate it.
  const svg = useRef<SVGSVGElement>(null);
  // The selected item's bar floats over the drawing, placed in its pixels: drawn again when the drawing changes size.
  const view = useRef<HTMLDivElement>(null);
  const [, setViewSize] = useState(0);
  useLayoutEffect(() => {
    const el = view.current;
    if (!el) return;
    setViewSize(n => n + 1);
    const observer = new ResizeObserver(() => setViewSize(n => n + 1));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  /** A board point, mm with Y up, in the drawing's pixels. */
  const toView = (p: { x: number; y: number }) => {
    const m = svg.current?.getScreenCTM(),
      r = view.current?.getBoundingClientRect();
    if (!m || !r) return null;
    const q = new DOMPoint(p.x, size.h - p.y).matrixTransform(m);
    return { x: q.x - r.left, y: q.y - r.top };
  };
  const toMm = (e: { clientX: number; clientY: number }) => {
    const m = svg.current?.getScreenCTM();
    if (!m) return { x: 0, y: 0 };
    const p = new DOMPoint(e.clientX, e.clientY).matrixTransform(m.inverse());
    return { x: p.x, y: size.h - p.y };
  };
  const drag = useRef<{
    mode: 'move' | 'size' | 'rotate';
    from: { x: number; y: number };
    item: CarvingItemV1;
    preview: CarvingItemV1;
    pointerId: number;
  } | null>(null);
  const box = shown && bounds(shown.outline);
  const start = (mode: 'move' | 'size' | 'rotate', item: CarvingItemV1) => (e: ReactPointerEvent) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    svg.current?.focus();
    svg.current?.setPointerCapture(e.pointerId);
    flushDraft.current?.();
    select(item.id);
    drag.current = { mode, from: toMm(e), item, preview: item, pointerId: e.pointerId };
    setDragged(item);
  };
  const move = (e: ReactPointerEvent) => {
    if (moveResize(e)) return;
    const d = drag.current;
    if (!d || e.pointerId !== d.pointerId) return;
    const at = toMm(e),
      item = d.item;
    let preview = item;
    if (d.mode === 'move')
      preview = {
        ...item,
        x: Math.max(0, Math.min(size.w, item.x + at.x - d.from.x)),
        y: Math.max(0, Math.min(size.h, item.y + at.y - d.from.y)),
      };
    else if (d.mode === 'size') {
      const was = Math.max(Math.hypot(d.from.x - item.x, d.from.y - item.y), 1);
      const now = Math.hypot(at.x - item.x, at.y - item.y);
      const height = Math.max(5, Math.min(size.h, Math.round((item.height * now) / was)));
      preview = {
        ...item,
        height,
        outline: item.outline.map(loop => loop.map(p => ({ x: (p.x * height) / item.height, y: (p.y * height) / item.height }))),
      };
    } else {
      const angle =
        item.rotation + ((Math.atan2(at.y - item.y, at.x - item.x) - Math.atan2(d.from.y - item.y, d.from.x - item.x)) * 180) / Math.PI;
      preview = { ...item, rotation: rotationOf(e.shiftKey ? angle : Math.round(angle / 15) * 15) };
    }
    d.preview = preview;
    setDragged(preview);
  };
  // Drag the board's right or top edge, or the corner between them, to size it: XY zero, lower left, stays.
  const resize = useRef<{ grip: BoardGrip; x: number; y: number; pxPerMm: number; from: { w: number; h: number } } | null>(null);
  const startResize = (grip: BoardGrip) => (e: ReactPointerEvent) => {
    if (e.button !== 0 || !board) return;
    e.preventDefault();
    e.stopPropagation();
    (e.target as Element).setPointerCapture(e.pointerId);
    flushDraft.current?.();
    resize.current = { grip, x: e.clientX, y: e.clientY, pxPerMm: svg.current?.getScreenCTM()?.a || 1, from: saved };
    setResized({ ...saved, from: saved });
  };
  const moveResize = (e: ReactPointerEvent) => {
    const r = resize.current;
    if (!r) return false;
    // In steps like the Boards step's edges, Shift for single millimetres.
    const step = e.shiftKey ? 1 : kBoardSnap;
    const to = (from: number, by: number) => Math.max(kBoardLeast, Math.min(kBoardMost, Math.round((from + by / r.pxPerMm) / step) * step));
    setResized({
      from: r.from,
      w: r.grip === 'h' ? r.from.w : to(r.from.w, e.clientX - r.x),
      h: r.grip === 'w' ? r.from.h : to(r.from.h, r.y - e.clientY),
    });
    return true;
  };
  const endResize = () => {
    const r = resize.current;
    if (!r) return false;
    resize.current = null;
    if (resized && (resized.w !== r.from.w || resized.h !== r.from.h)) setBoard({ w: resized.w, h: resized.h });
    setResized(null);
    return true;
  };
  const end = () => {
    if (endResize()) return;
    const d = drag.current;
    drag.current = null;
    setDragged(null);
    if (!d) return;
    if (d.mode === 'size') {
      // The artwork as saved now: text committed as the drag began may have been outlined since.
      const now = carving.items.find(item => item.id === d.item.id) ?? d.item;
      if (d.preview.height !== d.item.height) void redraw({ ...now, ...pending[d.item.id], height: d.preview.height });
    } else if (d.preview !== d.item) updateItem(d.item.id, { x: d.preview.x, y: d.preview.y, rotation: d.preview.rotation });
  };
  const cancel = () => {
    resize.current = null;
    setResized(null);
    drag.current = null;
    setDragged(null);
  };
  const region = carving.items.flatMap(item => placeItem(dragged?.id === item.id ? dragged : item));
  const allBox = bounds(region);
  // A file that couldn't be added is reported, but doesn't stop the items already there from being planned.
  const { adding: addError, ...itemErrors } = errors;
  const error = Object.values(itemErrors).find(Boolean);
  const problem = error ?? (board ? carvingProblem(carving, board) : 'This carving has no board.');
  const cone = vConeDepth(carving.vBit);
  const flatBit = (job.plan ?? kDefaultPlan).bit;
  const off = allBox && (allBox.x0 < 0 || allBox.y0 < 0 || allBox.x1 > size.w || allBox.y1 > size.h);
  // While resizing, the view holds still around the lower left corner; it fits the board again once dropped.
  const frame = resized?.from ?? size;
  const pad = Math.max(frame.w, frame.h) * 0.06;
  const grip = Math.max(frame.w, frame.h) * 0.025;

  return (
    <CamPage className="min-h-dvh md:h-dvh">
      <CamJobBar
        job={job}
        actions={
          <Button asChild size="sm" disabled={!!problem || outlining}>
            <Link to="/cam/$jobId/plan" params={{ jobId: job.id }}>
              <ListOrdered /> Next: Plan
            </Link>
          </Button>
        }
      />
      <div className="flex min-h-0 flex-1 flex-col md:flex-row">
        <div ref={view} className="relative min-h-[320px] flex-1 bg-muted/40">
          <svg
            ref={svg}
            role="img"
            tabIndex={0}
            aria-label={`Board ${size.w} × ${size.h} mm with the carving`}
            className="absolute inset-0 h-full w-full touch-none overflow-visible select-none"
            viewBox={`${-pad} ${-pad + size.h - frame.h} ${frame.w + 2 * pad} ${frame.h + 2 * pad}`}
            onPointerDown={() => select(null)}
            onPointerMove={move}
            onPointerUp={end}
            onPointerCancel={cancel}
            onLostPointerCapture={cancel}>
            <rect
              x={0}
              y={0}
              width={size.w}
              height={size.h}
              rx={1}
              className="fill-amber-200 stroke-amber-700 dark:fill-amber-900/60"
              strokeWidth={0.6}
            />
            {/* The edges' grips, under the artwork, so a narrow board's edge never takes the artwork's drag. */}
            {board && (
              <g className="fill-transparent">
                <rect
                  role="presentation"
                  data-resize="w"
                  x={size.w - Math.min(grip, size.w / 4)}
                  y={0}
                  width={grip + Math.min(grip, size.w / 4)}
                  height={size.h}
                  className="cursor-ew-resize"
                  onPointerDown={startResize('w')}
                />
                <rect
                  role="presentation"
                  data-resize="h"
                  x={0}
                  y={-grip}
                  width={size.w}
                  height={grip + Math.min(grip, size.h / 4)}
                  className="cursor-ns-resize"
                  onPointerDown={startResize('h')}
                />
              </g>
            )}
            {/* Each item's box takes a click anywhere inside it, not only on its ink; under all the ink, so ink still picks its own item. */}
            {carving.items.map(item => {
              const shownItem = dragged?.id === item.id ? dragged : item;
              const b = bounds(shownItem.outline);
              return (
                b && (
                  <rect
                    key={item.id}
                    data-testid="carving-item-box"
                    transform={`translate(${shownItem.x} ${size.h - shownItem.y}) rotate(${-shownItem.rotation})`}
                    x={b.x0}
                    y={-b.y1}
                    width={b.x1 - b.x0}
                    height={b.y1 - b.y0}
                    className="cursor-move fill-transparent"
                    onPointerDown={start('move', item)}
                  />
                )
              );
            })}
            {carving.items.map(item => (
              <path
                key={item.id}
                d={pathOf(placeItem(dragged?.id === item.id ? dragged : item), size.h)}
                data-testid="carving-item"
                aria-label={itemName(item)}
                className="cursor-move fill-amber-800 stroke-amber-950 dark:fill-amber-500"
                strokeWidth={0.15}
                fillRule="nonzero"
                onPointerDown={start('move', item)}
              />
            ))}
            {box && shown && (
              <g transform={`translate(${shown.x} ${size.h - shown.y}) rotate(${-shown.rotation})`}>
                <rect
                  x={box.x0}
                  y={-box.y1}
                  width={box.x1 - box.x0}
                  height={box.y1 - box.y0}
                  // The frame drags the selected item too, even where another item lies over it.
                  className="cursor-move fill-transparent stroke-primary"
                  strokeWidth={0.4}
                  strokeDasharray="2 1.5"
                  onPointerDown={start('move', shown)}
                />
                <rect
                  aria-label="Drag to resize"
                  x={box.x1 - 2.5}
                  y={-box.y0 - 2.5}
                  width={5}
                  height={5}
                  className="cursor-nwse-resize fill-background stroke-primary"
                  strokeWidth={0.5}
                  onPointerDown={start('size', shown)}
                />
                <line x1={0} y1={-box.y1} x2={0} y2={-box.y1 - 8} className="pointer-events-none stroke-primary" strokeWidth={0.5} />
                <circle
                  aria-label="Drag to rotate"
                  cx={0}
                  cy={-box.y1 - 8}
                  r={2.5}
                  className="cursor-grab fill-background stroke-primary"
                  strokeWidth={0.5}
                  onPointerDown={start('rotate', shown)}
                />
                <text x={box.x0} y={-box.y1 - 2} className="pointer-events-none fill-primary text-[4px]">
                  {(box.x1 - box.x0).toFixed(0)} × {(box.y1 - box.y0).toFixed(0)} mm
                </text>
              </g>
            )}
            {board && (
              <g data-testid="board-resize" className="fill-background stroke-amber-700">
                <rect
                  className="pointer-events-none"
                  x={size.w - grip / 3}
                  y={size.h / 2 - grip * 1.5}
                  width={(grip * 2) / 3}
                  height={grip * 3}
                  rx={grip / 3}
                  strokeWidth={0.5}
                />
                <rect
                  className="pointer-events-none"
                  x={size.w / 2 - grip * 1.5}
                  y={-grip / 3}
                  width={grip * 3}
                  height={(grip * 2) / 3}
                  rx={grip / 3}
                  strokeWidth={0.5}
                />
                <rect
                  role="presentation"
                  data-resize="wh"
                  x={size.w - grip / 2}
                  y={-grip / 2}
                  width={grip}
                  height={grip}
                  className="cursor-nesw-resize"
                  strokeWidth={0.5}
                  onPointerDown={startResize('wh')}
                />
                {resized && (
                  <text x={size.w} y={-grip - 1} textAnchor="end" className="fill-amber-800 stroke-none text-[4px] dark:fill-amber-300">
                    {size.w} × {size.h} mm
                  </text>
                )}
              </g>
            )}
            <circle cx={0} cy={size.h} r={1.5} className="fill-emerald-500" />
            <text x={0} y={size.h + 6} className="fill-emerald-600 text-[4px]">
              XY zero · lower left
            </text>
          </svg>
          {editing &&
            !dragged &&
            !resized &&
            (() => {
              // Above the item and its rotate handle.
              const top = placeItem({
                ...editing,
                outline: [[...editing.outline.flat(), { x: 0, y: (bounds(editing.outline)?.y1 ?? 0) + 11 }]],
              });
              const pts = top.flat();
              const at = pts.length
                ? toView({ x: (Math.min(...pts.map(p => p.x)) + Math.max(...pts.map(p => p.x))) / 2, y: Math.max(...pts.map(p => p.y)) })
                : null;
              if (!at) return null;
              return (
                <SelectionBar<'height' | 'rotation'>
                  key={editing.id}
                  id="carve"
                  title={editing.art.kind === 'text' ? 'Lettering' : editing.art.fileName}
                  at={at}
                  fields={[
                    { key: 'height', label: 'Height', name: 'Height (mm)', value: editing.height, min: 5, max: size.h },
                    { key: 'rotation', label: 'Angle', name: 'Rotation (°)', value: editing.rotation, unit: '°', min: -360, max: 720 },
                  ]}
                  onField={(key, value) => {
                    if (key === 'height') void redraw({ ...editing, height: value });
                    else updateItem(editing.id, { rotation: rotationOf(value) });
                  }}
                  scopes={[]}
                  onApply={() => {}}
                  onDelete={() => deleteItem(editing.id)}
                  deleteLabel={`Delete ${itemName(editing)}`}
                  menu={[
                    {
                      label: 'Centre on the board',
                      icon: <Crosshair className="size-4" />,
                      onSelect: () => updateItem(editing.id, centred(editing, size)),
                    },
                  ]}>
                  <ArtFields
                    key={artResets[editing.id] ?? 0}
                    art={editing.art}
                    onArt={art => {
                      if (art.kind === 'text') lastFont.current = art;
                      void redraw({ ...editing, art });
                    }}
                    onReplace={() => chooseSvg(editing.id)}
                    flush={flushDraft}
                  />
                </SelectionBar>
              );
            })()}
          {outlining && (
            <div className="absolute top-3 left-3 flex items-center gap-2 rounded bg-background/80 px-2 py-1 text-xs text-muted-foreground">
              <LoadingSpinner className="size-3" /> Outlining…
            </div>
          )}
        </div>
        <aside className="flex w-full shrink-0 flex-col gap-4 overflow-auto border-l p-4 text-sm md:w-80">
          <div className="grid gap-2">
            <h3 className="font-medium">Add</h3>
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() =>
                  void addItem({ kind: 'text', text: 'Text', font: lastFont.current?.kind === 'text' ? lastFont.current.font : 'serif' })
                }>
                <Type /> Text
              </Button>
              <Button variant="outline" size="sm" aria-busy={choosing} onClick={() => chooseSvg(null)}>
                {choosing ? <LoadingSpinner className="size-4" aria-label="Opening file chooser" /> : <Image />} SVG
              </Button>
            </div>
            <div className="sr-only">
              <label htmlFor="carve-svg">SVG file</label>
              <input
                id="carve-svg"
                ref={svgInput}
                tabIndex={-1}
                type="file"
                accept=".svg,image/svg+xml"
                onChange={e => {
                  const file = e.target.files?.[0],
                    id = replaceId.current;
                  const replacing = carving.items.find(item => item.id === id);
                  if (!file) setChoosing(false);
                  else
                    void file
                      .text()
                      .then(svg => {
                        const art: CarvingArt = { kind: 'svg', svg, fileName: file.name };
                        if (replacing) void redraw({ ...replacing, ...pending[replacing.id], art });
                        else void addItem(art);
                      })
                      .finally(() => setChoosing(false));
                  // Choosing the same file again still counts.
                  e.target.value = '';
                }}
              />
            </div>
          </div>
          <ul aria-label="Items" className="grid gap-1">
            {carving.items.map(item => (
              <li key={item.id} className={cn('flex items-center rounded-md', selectedId === item.id && 'bg-muted')}>
                <button
                  className="flex min-w-0 flex-1 items-center gap-2 px-2 py-2 text-left"
                  aria-pressed={selectedId === item.id}
                  onClick={() => select(item.id)}>
                  {item.art.kind === 'text' ? <Type className="size-4 shrink-0" /> : <Image className="size-4 shrink-0" />}
                  <span className="truncate">{itemName(item)}</span>
                </button>
                <Button variant="ghost" size="icon" aria-label={`Delete ${itemName(item)}`} onClick={() => deleteItem(item.id)}>
                  <Trash2 />
                </Button>
              </li>
            ))}
          </ul>
          {!editing && carving.items.length > 0 && <p className="text-xs text-muted-foreground">Select an item to edit it on the board.</p>}
          <hr />
          <Field label="Deepest (mm)" id="carve-depth">
            <NumberInput
              id="carve-depth"
              value={carving.maxDepth}
              min={0.2}
              max={thickness - 1}
              minExclusive
              unit="mm"
              onCommit={maxDepth => saveCarving({ ...carving, maxDepth })}
            />
          </Field>
          <Field label="V-bit" id="carve-bit">
            <select
              id="carve-bit"
              className="h-9 rounded-md border bg-background px-2"
              value={carving.vBit.number}
              onChange={e => saveCarving({ ...carving, vBit: kVBits.find(b => b.number === Number(e.target.value)) ?? carving.vBit })}>
              {kVBits.map(b => (
                <option key={b.number} value={b.number}>
                  {b.name}
                </option>
              ))}
            </select>
          </Field>
          <p className="text-xs text-muted-foreground">
            Strokes wider than{' '}
            {(2 * (Math.min(carving.maxDepth, cone) / Math.tan(((carving.vBit.angle ?? 90) * Math.PI) / 360))).toFixed(1)} mm get a flat
            bottom{carving.maxDepth > cone ? `: the bit's cone is only ${cone.toFixed(1)} mm deep` : ''}.
          </p>
          <label className="flex items-start gap-2">
            <input
              type="checkbox"
              className="mt-0.5"
              checked={carving.clearWithFlat}
              onChange={e => saveCarving({ ...carving, clearWithFlat: e.target.checked })}
            />
            <span>
              Clear flat bottoms with the {flatBit.name ?? `⌀${flatBit.diameter} flat bit`} first
              <span className="block text-xs text-muted-foreground">Otherwise the V-bit clears them: one bit, slower.</span>
            </span>
          </label>
          <hr />
          <h3 className="font-medium">Board</h3>
          <div className="grid grid-cols-3 gap-2">
            <Field label="Width" id="carve-board-w">
              <NumberInput id="carve-board-w" value={size.w} min={kBoardLeast} max={kBoardMost} unit="mm" onCommit={w => setBoard({ w })} />
            </Field>
            <Field label="Height" id="carve-board-h">
              <NumberInput id="carve-board-h" value={size.h} min={kBoardLeast} max={kBoardMost} unit="mm" onCommit={h => setBoard({ h })} />
            </Field>
            <Field label="Thick" id="carve-board-t">
              <NumberInput id="carve-board-t" value={thickness} min={3} max={100} unit="mm" onCommit={t => setBoard({ thickness: t })} />
            </Field>
          </div>
          <p className="text-xs text-muted-foreground">
            Measure the board&rsquo;s thickness: Z0 is its underside, so a thicker board carves deeper and wider.
          </p>
          {(problem || off || addError) && (
            <p role="alert" className="flex gap-2 text-amber-600">
              <AlertTriangle className="mt-0.5 size-4 shrink-0" />
              {problem ?? addError ?? 'The artwork reaches past the board: move it or make it smaller.'}
            </p>
          )}
        </aside>
      </div>
    </CamPage>
  );
}

const rotationOf = (degrees: number) => ((degrees % 360) + 360) % 360;

/**
 * Where a new item goes: the board's centre, or the nearest place straight above or below it, in 5 mm steps, where it
 * stays on the board and clear of the items already there. The centre when there's no such place.
 */
function freeSpot(items: CarvingItemV1[], outline: Loop[], size: { w: number; h: number }) {
  const x = size.w / 2;
  const own = bounds(outline);
  if (!own) return { x, y: size.h / 2 };
  const taken = items.map(item => bounds(placeItem(item))).filter(box => !!box);
  const gap = 2;
  const fits = (y: number) => {
    const box = { x0: x + own.x0, x1: x + own.x1, y0: y + own.y0, y1: y + own.y1 };
    if (box.y0 < 0 || box.y1 > size.h) return false;
    return taken.every(t => box.x1 + gap <= t.x0 || t.x1 + gap <= box.x0 || box.y1 + gap <= t.y0 || t.y1 + gap <= box.y0);
  };
  for (let d = 0; d <= size.h / 2; d += 5) for (const y of [size.h / 2 - d, size.h / 2 + d]) if (fits(y)) return { x, y };
  return { x, y: size.h / 2 };
}

const centred = (item: CarvingItemV1, size: { w: number; h: number }) => {
  const box = bounds(placeItem(item));
  if (!box) return { x: size.w / 2, y: size.h / 2 };
  return { x: item.x + size.w / 2 - (box.x0 + box.x1) / 2, y: item.y + size.h / 2 - (box.y0 + box.y1) / 2 };
};

function ArtFields({
  art,
  onArt,
  onReplace,
  flush,
}: {
  art: CarvingArt;
  onArt: (art: CarvingArt) => void;
  onReplace: () => void;
  /** Set while typed text waits for its debounce: commits it at once. */
  flush: RefObject<(() => void) | null>;
}) {
  const [text, setText] = useState(art.kind === 'text' ? art.text : '');
  // Typing outlines again once it pauses.
  useEffect(() => {
    if (art.kind !== 'text' || text === art.text) return;
    const commit = () => {
      clearTimeout(t);
      flush.current = null;
      onArt({ ...art, text });
    };
    const t = setTimeout(commit, 300);
    flush.current = commit;
    return () => {
      clearTimeout(t);
      if (flush.current === commit) flush.current = null;
    };
  }, [text, art, onArt, flush]);
  return art.kind === 'text' ? (
    <>
      <Input
        id="carve-text"
        aria-label="Text"
        value={text}
        maxLength={60}
        className="h-7 w-36 px-2 text-xs"
        onChange={e => setText(e.target.value)}
      />
      <div className="w-40">
        <LetteringFontPicker font={art.font} className="h-7 px-2 text-xs" onChange={font => onArt({ ...art, text, font })} />
      </div>
    </>
  ) : (
    <button
      type="button"
      aria-label="Replace SVG"
      title="Replace SVG"
      onClick={onReplace}
      className="flex size-7 items-center justify-center rounded-md hover:bg-muted">
      <FileUp className="size-4" />
    </button>
  );
}

function Field({ label, id, children }: { label: string; id: string; children: React.ReactNode }) {
  return (
    <div className="grid gap-1">
      <label htmlFor={id} className="text-xs text-muted-foreground">
        {label}
      </label>
      {children}
    </div>
  );
}

function Shell({ message, loading }: { message?: string; loading?: string }) {
  return (
    <CamPage className="min-h-dvh md:h-dvh">
      <PageHeader title="Projects" />
      {message && <p className="m-8 text-muted-foreground">{message}</p>}
      {loading && (
        <div className="flex flex-1 items-center justify-center gap-2 text-muted-foreground">
          <LoadingSpinner className="size-4" /> {loading}
        </div>
      )}
    </CamPage>
  );
}
