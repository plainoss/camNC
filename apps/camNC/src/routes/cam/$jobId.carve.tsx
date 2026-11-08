import { PageHeader } from '@/components/page-header';
import { CamPage } from '@/cam/CamPage';
import { CamJobBar } from '@/cam/CamJobBar';
import { NumberInput } from '@/cam/NumberInput';
import { LetteringFontPicker } from '@/cam/LetteringFontPicker';
import { carvingProblem, kVBits, type CarvingArt, type CarvingV1 } from '@/cam/carving';
import { outlineArt, placeRegion } from '@/cam/carvingOutline';
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
import { AlertTriangle, ListOrdered } from 'lucide-react';
import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';

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
  return <CarveEditor job={job} carving={job.carving} board={job.boards?.[0]} />;
}

function CarveEditor({ job, carving, board }: { job: CamJobV1; carving: CarvingV1; board?: BoardV1 }) {
  const save = useSaveCamJob(job);
  const saved = board?.size.fit === false ? board.size : { w: 300, h: 140 };
  // While an edge of the board is dragged, its new size is shown (and in the fields) before it's saved.
  const [resized, setResized] = useState<{ w: number; h: number; from: { w: number; h: number } } | null>(null);
  const size = resized ? { w: resized.w, h: resized.h } : saved;
  const thickness = board?.thickness ?? 18;
  // While dragging, the moved artwork is shown before it's saved.
  const [dragged, setDragged] = useState<{ x: number; y: number; height: number } | null>(null);
  const [outlining, setOutlining] = useState(false);
  const [pendingArt, setPendingArt] = useState<CarvingArt | null>(null);
  const [artReset, setArtReset] = useState(0);
  const art = pendingArt ?? carving.art;
  const [error, setError] = useState<string | null>(null);
  const shown = dragged ?? carving;
  const region = dragged
    ? carving.region.map(loop =>
        loop.map(p => ({
          x: shown.x + ((p.x - carving.x) * shown.height) / carving.height,
          y: shown.y + ((p.y - carving.y) * shown.height) / carving.height,
        }))
      )
    : carving.region;

  const saveCarving = (next: CarvingV1, boards = job.boards) => save.mutate({ ...job, carving: next, boards });
  // Outlines are drawn again whenever the artwork or its size changes; the latest request wins.
  const outlineRun = useRef(0);
  const redraw = async (next: Omit<CarvingV1, 'region'>) => {
    const run = ++outlineRun.current;
    setPendingArt(next.art);
    setOutlining(true);
    try {
      const { region } = await outlineArt(next.art, next.height);
      if (run !== outlineRun.current) return;
      setError(null);
      saveCarving({ ...next, region: placeRegion(region, next.x, next.y) });
      setPendingArt(null);
    } catch (e) {
      if (run === outlineRun.current) {
        setError(e instanceof Error ? e.message : String(e));
        setPendingArt(null);
        // Discard draft text too, without replaying its debounce against the saved font.
        setArtReset(reset => reset + 1);
      }
    } finally {
      if (run === outlineRun.current) setOutlining(false);
    }
  };
  const setArt = (art: CarvingArt) => void redraw({ ...carving, art });
  const setBoard = (change: Partial<{ w: number; h: number; thickness: number; taped: boolean }>) => {
    if (!board) return;
    const w = change.w ?? size.w,
      h = change.h ?? size.h;
    const next: BoardV1 = {
      ...board,
      size: { fit: false, w, h },
      thickness: change.thickness ?? board.thickness,
      ...(change.taped !== undefined && { taped: change.taped }),
    };
    const moved = { ...carving, x: Math.min(carving.x, w), y: Math.min(carving.y, h) };
    saveCarving(
      { ...moved, region: carving.region.map(loop => loop.map(p => ({ x: p.x + moved.x - carving.x, y: p.y + moved.y - carving.y }))) },
      [next, ...(job.boards ?? []).slice(1)]
    );
  };

  // Drag the artwork to move it, its corner to size it.
  const svg = useRef<SVGSVGElement>(null);
  const toMm = (e: { clientX: number; clientY: number }) => {
    const m = svg.current?.getScreenCTM();
    if (!m) return { x: 0, y: 0 };
    const p = new DOMPoint(e.clientX, e.clientY).matrixTransform(m.inverse());
    return { x: p.x, y: size.h - p.y };
  };
  const drag = useRef<{ mode: 'move' | 'size'; from: { x: number; y: number } } | null>(null);
  const box = bounds(region);
  const start = (mode: 'move' | 'size') => (e: ReactPointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    (e.target as Element).setPointerCapture(e.pointerId);
    drag.current = { mode, from: toMm(e) };
    setDragged({ x: carving.x, y: carving.y, height: carving.height });
  };
  const move = (e: ReactPointerEvent) => {
    if (moveResize(e)) return;
    const d = drag.current;
    if (!d) return;
    const at = toMm(e);
    if (d.mode === 'move')
      setDragged({
        x: Math.max(0, Math.min(size.w, carving.x + at.x - d.from.x)),
        y: Math.max(0, Math.min(size.h, carving.y + at.y - d.from.y)),
        height: carving.height,
      });
    else {
      // The corner moves away from the centre: the artwork grows as much as the corner's farther axis.
      const was = Math.max(Math.abs(d.from.x - carving.x), 1),
        now = Math.max(Math.abs(at.x - carving.x), 1);
      setDragged({ x: carving.x, y: carving.y, height: Math.max(5, Math.min(size.h, Math.round(carving.height * (now / was)))) });
    }
  };
  // Drag the board's right or top edge, or the corner between them, to size it: XY zero, lower left, stays.
  const resize = useRef<{ grip: BoardGrip; x: number; y: number; pxPerMm: number; from: { w: number; h: number } } | null>(null);
  const startResize = (grip: BoardGrip) => (e: ReactPointerEvent) => {
    if (e.button !== 0 || !board) return;
    e.preventDefault();
    e.stopPropagation();
    (e.target as Element).setPointerCapture(e.pointerId);
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
    if (!d || !dragged) return setDragged(null);
    if (d.mode === 'move') {
      const dx = dragged.x - carving.x,
        dy = dragged.y - carving.y;
      saveCarving({
        ...carving,
        x: dragged.x,
        y: dragged.y,
        region: carving.region.map(loop => loop.map(p => ({ x: p.x + dx, y: p.y + dy }))),
      });
    } else if (dragged.height !== carving.height) void redraw({ ...carving, art, height: dragged.height });
    setDragged(null);
  };

  const problem = error ?? (board ? carvingProblem(carving, board) : 'This carving has no board.');
  const cone = vConeDepth(carving.vBit);
  const flatBit = (job.plan ?? kDefaultPlan).bit;
  const off = box && (box.x0 < 0 || box.y0 < 0 || box.x1 > size.w || box.y1 > size.h);
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
        <div className="relative min-h-[320px] flex-1 bg-muted/40">
          <svg
            ref={svg}
            role="img"
            aria-label={`Board ${size.w} × ${size.h} mm with the carving`}
            className="absolute inset-0 h-full w-full touch-none overflow-visible select-none"
            viewBox={`${-pad} ${-pad + size.h - frame.h} ${frame.w + 2 * pad} ${frame.h + 2 * pad}`}
            onPointerMove={move}
            onPointerUp={end}
            onPointerCancel={end}>
            <rect
              x={0}
              y={0}
              width={size.w}
              height={size.h}
              rx={1}
              className="fill-amber-200 stroke-amber-700 dark:fill-amber-900/60"
              strokeWidth={0.6}
            />
            <path
              d={pathOf(region, size.h)}
              data-testid="carving-outline"
              className="cursor-move fill-amber-800 stroke-amber-950 dark:fill-amber-500"
              strokeWidth={0.15}
              fillRule="nonzero"
              onPointerDown={start('move')}
            />
            {box && (
              <g>
                <rect
                  x={box.x0}
                  y={size.h - box.y1}
                  width={box.x1 - box.x0}
                  height={box.y1 - box.y0}
                  className="pointer-events-none fill-none stroke-primary"
                  strokeWidth={0.4}
                  strokeDasharray="2 1.5"
                />
                <rect
                  aria-label="Drag to resize"
                  x={box.x1 - 2.5}
                  y={size.h - box.y0 - 2.5}
                  width={5}
                  height={5}
                  className="cursor-nwse-resize fill-background stroke-primary"
                  strokeWidth={0.5}
                  onPointerDown={start('size')}
                />
                <text x={box.x0} y={size.h - box.y1 - 2} className="fill-primary text-[4px]">
                  {(box.x1 - box.x0).toFixed(0)} × {(box.y1 - box.y0).toFixed(0)} mm
                </text>
              </g>
            )}
            {board && (
              <g data-testid="board-resize" className="fill-background stroke-amber-700">
                <rect
                  role="presentation"
                  data-resize="w"
                  x={size.w - grip}
                  y={0}
                  width={2 * grip}
                  height={size.h}
                  className="cursor-ew-resize fill-transparent stroke-none"
                  onPointerDown={startResize('w')}
                />
                <rect
                  role="presentation"
                  data-resize="h"
                  x={0}
                  y={-grip}
                  width={size.w}
                  height={2 * grip}
                  className="cursor-ns-resize fill-transparent stroke-none"
                  onPointerDown={startResize('h')}
                />
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
          {outlining && (
            <div className="absolute top-3 left-3 flex items-center gap-2 rounded bg-background/80 px-2 py-1 text-xs text-muted-foreground">
              <LoadingSpinner className="size-3" /> Outlining…
            </div>
          )}
        </div>
        <aside className="flex w-full shrink-0 flex-col gap-4 overflow-auto border-l p-4 text-sm md:w-80">
          <ArtFields key={artReset} art={art} onArt={setArt} />
          <div className="grid grid-cols-2 gap-2">
            <Field label="Height (mm)" id="carve-height">
              <NumberInput
                id="carve-height"
                value={carving.height}
                min={5}
                max={size.h}
                unit="mm"
                onCommit={height => void redraw({ ...carving, art, height })}
              />
            </Field>
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
          </div>
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
          <Button variant="outline" size="sm" onClick={() => saveCarving({ ...carving, ...centred(carving, size) })}>
            Centre on the board
          </Button>
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
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={!!board?.taped} onChange={e => setBoard({ taped: e.target.checked })} /> Tape under the board
          </label>
          <p className="text-xs text-muted-foreground">
            Measure the board&rsquo;s thickness: Z0 is its underside, so a thicker board carves deeper and wider.
          </p>
          {(problem || off) && (
            <p role="alert" className="flex gap-2 text-amber-600">
              <AlertTriangle className="mt-0.5 size-4 shrink-0" />
              {problem ?? 'The artwork reaches past the board: move it or make it smaller.'}
            </p>
          )}
        </aside>
      </div>
    </CamPage>
  );
}

const centred = (carving: CarvingV1, size: { w: number; h: number }) => {
  const box = bounds(carving.region);
  if (!box) return {};
  const dx = size.w / 2 - (box.x0 + box.x1) / 2,
    dy = size.h / 2 - (box.y0 + box.y1) / 2;
  return { x: carving.x + dx, y: carving.y + dy, region: carving.region.map(loop => loop.map(p => ({ x: p.x + dx, y: p.y + dy }))) };
};

function ArtFields({ art, onArt }: { art: CarvingArt; onArt: (art: CarvingArt) => void }) {
  const svgInput = useRef<HTMLInputElement>(null);
  const [text, setText] = useState(art.kind === 'text' ? art.text : 'Welcome');
  // Typing outlines again once it pauses.
  useEffect(() => {
    if (art.kind !== 'text' || text === art.text) return;
    const t = setTimeout(() => onArt({ ...art, text }), 300);
    return () => clearTimeout(t);
  }, [text, art, onArt]);
  const font = art.kind === 'text' ? art.font : 'serif';
  return (
    <>
      <div role="tablist" className="inline-flex self-start rounded-md bg-muted p-0.5">
        {(['text', 'svg'] as const).map(kind => (
          <button
            key={kind}
            role="tab"
            aria-selected={art.kind === kind}
            className={cn('rounded px-3 py-1', art.kind === kind ? 'bg-background shadow-sm' : 'text-muted-foreground')}
            onClick={() => {
              if (kind === art.kind) return;
              if (kind === 'text') onArt({ kind: 'text', text, font });
              else svgInput.current?.click();
            }}>
            {kind === 'text' ? 'Lettering' : 'SVG'}
          </button>
        ))}
      </div>
      {art.kind === 'text' ? (
        <>
          <Field label="Text" id="carve-text">
            <Input id="carve-text" value={text} maxLength={60} onChange={e => setText(e.target.value)} />
          </Field>
          <Field label="Font" id="carve-font">
            <LetteringFontPicker font={font} onChange={font => onArt({ ...art, text, font })} />
          </Field>
        </>
      ) : (
        <p className="text-muted-foreground">{art.fileName}</p>
      )}
      <Field label={art.kind === 'svg' ? 'Another SVG' : 'Or an SVG file'} id="carve-svg">
        <Input
          id="carve-svg"
          ref={svgInput}
          type="file"
          accept=".svg,image/svg+xml"
          onChange={e => {
            const file = e.target.files?.[0];
            if (file) void file.text().then(svg => onArt({ kind: 'svg', svg, fileName: file.name }));
            // Choosing the same file again still counts.
            e.target.value = '';
          }}
        />
      </Field>
    </>
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
