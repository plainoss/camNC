import { PageHeader } from '@/components/page-header';
import { CamPage } from '@/cam/CamPage';
import { CamJobBar } from '@/cam/CamJobBar';
import { CarvingArtFields } from '@/cam/CarvingArtFields';
import { CarvingCutoutBar, CarvingCutoutLine, kCutoutSelection } from '@/cam/CarvingCutout';
import {
  carvingProblem,
  cutoutOutline,
  itemName,
  kEmptyCarving,
  placeItem,
  withItems,
  type CarvingArt,
  type CarvingItemV1,
  type CarvingV1,
} from '@/cam/carving';
import { carvingBounds as bounds, carvingPath as pathOf, centred, freeSpot } from '@/cam/carvingView';
import { outlineArt } from '@/cam/carvingOutline';
import { CarvingAssistant } from '@/cam/carvingAssistant/CarvingAssistant';
import { CarvingAssistantBoardLayer } from '@/cam/carvingAssistant/BoardLayer';
import { useCarvingAssistant } from '@/cam/carvingAssistant/useCarvingAssistant';
import { applyCarvingProposal, generatedCarvingProblem, type CarvingProposal } from '@/cam/carvingAssistant/proposal';
import { CarvingInlineText as InlineText } from '@/cam/CarvingInlineText';
import { CarveEmptyStart, CarveToolbar, type CarvePanel } from '@/cam/carve/CarveTools';
import { CarveItemsPanel } from '@/cam/carve/CarveItemsPanel';
import { CarveSettingsPanel, kBoardLeast, kBoardMost } from '@/cam/carve/CarveSettingsPanel';
import { camKeys, useCamJob, useSaveCamJob } from '@/cam/camQueries';
import { useQueryClient } from '@tanstack/react-query';
import type { BoardV1 } from '@/cam/boards';
import type { CamJobV1 } from '@/cam/jobDb';
import { kDefaultPlan } from '@/cam/planSettings';
import { cutoutPastBoard } from '@wbcnc/cam';
import { createFileRoute, Link, useParams } from '@tanstack/react-router';
import { Button } from '@wbcnc/ui/components/button';
import { toast } from '@wbcnc/ui/components/sonner';
import { LoadingSpinner } from '@wbcnc/ui/components/loading-spinner';
import { SelectionBar } from '@/cam/boards/SelectionBar';
import { AlertTriangle, Crosshair, ListOrdered, Redo2, Undo2 } from 'lucide-react';
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';

export const Route = createFileRoute('/cam/$jobId/carve')({ component: CarveStep });

/** What Undo brings back: the carving and its board. */
type Snapshot = Pick<CamJobV1, 'carving' | 'boards'>;
const kUndoSteps = 50;
type BoardGrip = 'w' | 'h' | 'wh';

/** A dragged board edge moves in these steps (Shift: 1 mm), between the board size fields' limits. */
const kBoardSnap = 10;

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
  // The text item being typed into on the board itself.
  const [inlineId, setInlineId] = useState<string | null>(null);
  // The item last pressed on the board, so a double-click edits it.
  const pressed = useRef<string | null>(null);
  // While dragging, the item is shown before it's saved.
  const [dragged, setDragged] = useState<CarvingItemV1 | null>(null);
  const [pending, setPending] = useState<Record<string, Pick<CarvingItemV1, 'art' | 'height'>>>({});
  const [errors, setErrors] = useState<Record<string, string | undefined>>({});
  const [adding, setAdding] = useState(0);
  const [artResets, setArtResets] = useState<Record<string, number>>({});
  const [panel, setPanel] = useState<CarvePanel | null>(null);
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
      // Its Undo belongs to this editor's history, which leaving the step discards.
      dismissAdded();
    };
    // dismissAdded only reads a ref.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Undo and Redo step through the carving and its board as they were before each edit, as on the Boards step.
  const queryClient = useQueryClient();
  const latest = () => queryClient.getQueryData<CamJobV1>(camKeys.job(job.id)) ?? job;
  const history = useRef<Snapshot[]>([]);
  const future = useRef<Snapshot[]>([]);
  const [, setHistorySize] = useState(0);
  // The "Artwork added" toast offers Undo for that one edit, so any later edit or undo takes the toast away.
  const addedToast = useRef<string | number | null>(null);
  const dismissAdded = () => {
    if (addedToast.current !== null) toast.dismiss(addedToast.current);
    addedToast.current = null;
  };
  /** Called right before an edit is saved: the job as it is then is what Undo brings back. */
  const record = () => {
    dismissAdded();
    const { carving, boards } = latest();
    history.current = [...history.current.slice(-(kUndoSteps - 1)), { carving, boards }];
    future.current = [];
    setHistorySize(n => n + 1);
  };
  const travel = (from: { current: Snapshot[] }, to: { current: Snapshot[] }) => {
    const back = from.current.at(-1);
    if (!back) return;
    dismissAdded();
    from.current = from.current.slice(0, -1);
    const { carving: was, boards } = latest();
    to.current = [...to.current, { carving: was, boards }];
    // Outlines still being drawn, and text still being typed, belong to the edit being left.
    for (const [id, run] of outlineRuns.current) outlineRuns.current.set(id, run + 1);
    setPending({});
    setErrors({});
    setArtResets(resets =>
      Object.fromEntries([...(was?.items ?? []), ...(back.carving?.items ?? [])].map(i => [i.id, (resets[i.id] ?? 0) + 1]))
    );
    // So do drags under way, of an item or of the board's edges: their release would save over what's restored.
    drag.current = null;
    setDragged(null);
    resize.current = null;
    setResized(null);
    setHistorySize(n => n + 1);
    save.mutateCurrent(current => ({ ...current, carving: back.carving, boards: back.boards }));
  };
  const undo = history.current.length ? () => travel(history, future) : undefined;
  const redo = future.current.length ? () => travel(future, history) : undefined;
  // A toast's Undo runs after later renders, so it reaches the current Undo rather than the one it was made with.
  const undoLatest = useRef(undo);
  undoLatest.current = undo;

  const saveCarving = (next: CarvingV1, boards = job.boards) => {
    record();
    save.mutate({ ...job, carving: next, boards });
  };
  const applyAssistant = (proposal: CarvingProposal) => {
    // Check the latest cache inside the mutation: a same-tick edit must not be overwritten or enter Undo history.
    save.mutateCurrent(current => {
      const next = applyCarvingProposal(current, proposal);
      record();
      return next;
    });
    setSelectedId(proposal.item.id);
    // Done: the board gets its room back, with the new artwork selected and one step to take it back.
    assistant.setOpen(false);
    const entry = history.current.at(-1);
    addedToast.current = toast(proposal.mode === 'replace' ? 'Artwork replaced' : 'Artwork added', {
      action: {
        label: 'Undo',
        // Only while this edit is still the latest: never another edit's, nor after leaving the step.
        onClick: () => {
          if (mounted.current && history.current.at(-1) === entry) undoLatest.current?.();
        },
      },
    });
  };
  const assistant = useCarvingAssistant({
    job,
    selectedId,
    disabled: outlining || !!dragged || !!resized || !!inlineId,
    onApply: applyAssistant,
  });
  const updateItem = (id: string, change: Partial<CarvingItemV1>) => {
    record();
    commitItem(id, change);
  };
  const commitItem = (id: string, change: Partial<CarvingItemV1>) =>
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
      const original = latest().carving?.items.find(item => item.id === next.id);
      // Replacing artwork by hand ends its generated-source link; size-only edits keep it for a local recheck.
      const generated = JSON.stringify(original?.art) === JSON.stringify(next.art) ? original?.generated : undefined;
      updateItem(next.id, { art: next.art, height: next.height, outline: region, generated });
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
    if (id !== inlineId) setInlineId(null);
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
      record();
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
    record();
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
      // ⌘Z / Ctrl+Z, and ⇧⌘Z or Ctrl+Y; in a text field they stay the field's own.
      if ((e.metaKey || e.ctrlKey) && !e.altKey) {
        const k = e.key.toLowerCase();
        if (k !== 'z' && k !== 'y') return;
        e.preventDefault();
        (k === 'y' || e.shiftKey ? redo : undo)?.();
        return;
      }
      if (e.key === 'Enter' && (target === svg.current || target === document.body) && editing?.art.kind === 'text') {
        e.preventDefault();
        setInlineId(editing.id);
        return;
      }
      if ((e.key === 'Delete' || e.key === 'Backspace') && selectedId) {
        e.preventDefault();
        if (selectedId === kCutoutSelection) {
          saveCarving({ ...carving, cutout: undefined });
          select(null);
        } else deleteItem(selectedId);
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
    // The board's top edge stays where it is, as on the Boards step: a taller board grows downwards, so the items keep
    // their place below the top while XY zero, the lower left corner, moves with the bottom edge.
    const dy = h - saved.h;
    saveCarving(
      withItems(
        carving,
        carving.items.map(item => ({ ...item, x: Math.min(item.x, w), y: Math.max(0, Math.min(item.y + dy, h)) }))
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
    pressed.current = item.id;
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
      h: r.grip === 'w' ? r.from.h : to(r.from.h, e.clientY - r.y),
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
  const problem = error ?? generatedCarvingProblem(job) ?? (board ? carvingProblem(carving, board) : 'This carving has no board.');
  const flatBit = (job.plan ?? kDefaultPlan).bit;
  const flatBitName = flatBit.name ?? `⌀${flatBit.diameter} flat bit`;
  // One side panel at a time, opened from the board's toolbar; the assistant keeps its own open state for its session.
  const shownPanel: CarvePanel | null = assistant.open ? 'assistant' : panel;
  const panelRef = useRef<HTMLElement>(null);
  // On a phone the panel opens below the board, out of sight: bring it into view when it appears.
  useEffect(() => {
    if (shownPanel && window.matchMedia('(max-width: 767px)').matches) panelRef.current?.scrollIntoView({ block: 'start' });
  }, [shownPanel]);
  const togglePanel = (next: CarvePanel) => {
    const closing = next === shownPanel;
    if (next === 'assistant' && !closing) {
      // The lettering's bar would cover the box; generated artwork stays selected to be reworked.
      if (!selected?.generated) select(null);
      setPanel(null);
    } else setPanel(closing ? null : next);
    assistant.setOpen(next === 'assistant' && !closing);
  };
  const addText = () =>
    void addItem({ kind: 'text', text: 'Text', font: lastFont.current?.kind === 'text' ? lastFont.current.font : 'serif' });
  const off = allBox && (allBox.x0 < 0 || allBox.y0 < 0 || allBox.x1 > size.w || allBox.y1 > size.h);
  // The cut line as drawn (it follows the artwork once dropped): Plan can't cut the piece out whole while it runs off the board.
  const cutOff = useMemo(() => cutoutPastBoard(cutoutOutline(carving), { w: size.w, h: size.h }), [carving, size.w, size.h]);
  // While resizing, the view holds still around the top left corner; it fits the board again once dropped.
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
            className="absolute inset-y-0 right-0 left-14 h-full w-[calc(100%-3.5rem)] touch-none overflow-visible select-none"
            viewBox={`${-pad} ${-pad} ${frame.w + 2 * pad} ${frame.h + 2 * pad}`}
            onPointerDown={() => {
              pressed.current = null;
              select(null);
            }}
            onDoubleClick={() => {
              const item = editing?.id === pressed.current ? editing : undefined;
              if (item?.art.kind === 'text') setInlineId(item.id);
              else if (item) chooseSvg(item.id);
            }}
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
                  y={size.h - Math.min(grip, size.h / 4)}
                  width={size.w}
                  height={grip + Math.min(grip, size.h / 4)}
                  className="cursor-ns-resize"
                  onPointerDown={startResize('h')}
                />
              </g>
            )}
            {/* While the board's bottom edge is dragged, the items stay with its top edge (`setBoard`). */}
            <g transform={`translate(0 ${saved.h - size.h})`}>
              <CarvingCutoutLine
                carving={carving}
                size={size}
                selected={selectedId === kCutoutSelection}
                onSelect={() => select(kCutoutSelection)}
                onChange={cutout => saveCarving({ ...carving, cutout })}
                toMm={toMm}
              />
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
              {carving.items.map(item =>
                item.id === inlineId ? null : (
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
                )
              )}
              {/* While AI artwork replaces the selected item, its box stands for the item: one frame and one size label. */}
              {box && shown && shown.id !== inlineId && !(assistant.open && assistant.replace.on) && (
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
              {assistant.open && <CarvingAssistantBoardLayer session={assistant} height={size.h} />}
            </g>
            {editing && editing.id === inlineId && editing.art.kind === 'text' && !dragged && (
              <InlineText
                key={editing.id}
                item={editing}
                text={editing.art}
                at={`translate(${editing.x} ${saved.h - editing.y}) rotate(${-editing.rotation})`}
                flush={flushDraft}
                onText={text => void redraw({ ...editing, art: { ...editing.art, text } as CarvingArt })}
                onDone={() => {
                  setInlineId(null);
                  svg.current?.focus();
                }}
              />
            )}
            {/* As on the Boards step: grips just outside the right and bottom edges, and the corner between them. */}
            {board && (
              <g data-testid="board-resize" className="fill-primary stroke-background">
                <rect
                  className="pointer-events-none"
                  x={size.w + grip * 0.35}
                  y={size.h / 2 - grip * 1.5}
                  width={grip * 0.5}
                  height={grip * 3}
                  rx={grip * 0.25}
                  strokeWidth={0.3}
                />
                <rect
                  className="pointer-events-none"
                  x={size.w / 2 - grip * 1.5}
                  y={size.h + grip * 0.35}
                  width={grip * 3}
                  height={grip * 0.5}
                  rx={grip * 0.25}
                  strokeWidth={0.3}
                />
                <circle
                  role="presentation"
                  data-resize="wh"
                  cx={size.w + grip * 0.6}
                  cy={size.h + grip * 0.6}
                  r={grip * 0.5}
                  className="cursor-nwse-resize"
                  strokeWidth={0.3}
                  onPointerDown={startResize('wh')}
                />
                {resized && (
                  <text
                    x={size.w}
                    y={size.h + grip * 1.6 + 4}
                    textAnchor="end"
                    className="fill-amber-800 stroke-none text-[4px] dark:fill-amber-300">
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
            editing.id !== inlineId &&
            !resized &&
            !(assistant.open && assistant.replace.on) &&
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
              // Keep the AI artwork box visible and reachable while something else is selected.
              const t = assistant.target;
              const [a, b] = [toView({ x: t.x - t.w / 2, y: t.y + t.h / 2 }), toView({ x: t.x + t.w / 2, y: t.y - t.h / 2 })];
              const assistantBox = assistant.open && a && b ? { left: a.x, top: a.y, right: b.x, bottom: b.y } : null;
              return (
                <SelectionBar<'height' | 'rotation'>
                  key={editing.id}
                  id="carve"
                  title={editing.art.kind === 'text' ? 'Lettering' : editing.art.fileName}
                  at={at}
                  avoid={assistantBox}
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
                  <CarvingArtFields
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
          {selectedId === kCutoutSelection &&
            carving.cutout &&
            !resized &&
            (() => {
              // Above the cut line.
              const at = allBox && toView({ x: (allBox.x0 + allBox.x1) / 2, y: allBox.y1 + carving.cutout.margin + 4 });
              return (
                at && (
                  <CarvingCutoutBar
                    carving={{ ...carving, cutout: carving.cutout }}
                    at={at}
                    onChange={cutout => {
                      saveCarving({ ...carving, cutout });
                      if (!cutout) select(null);
                    }}
                  />
                )
              );
            })()}
          <div className="absolute top-3 right-3 flex gap-1 rounded-md border bg-background/90 p-0.5 shadow-sm">
            <button type="button" aria-label="Undo" title="Undo (⌘Z)" disabled={!undo} onClick={undo} className={kToolButton}>
              <Undo2 className="size-[18px]" />
            </button>
            <button type="button" aria-label="Redo" title="Redo (⇧⌘Z)" disabled={!redo} onClick={redo} className={kToolButton}>
              <Redo2 className="size-[18px]" />
            </button>
          </div>
          {outlining && (
            <div className="absolute top-3 left-3 flex items-center gap-2 rounded bg-background/80 px-2 py-1 text-xs text-muted-foreground">
              <LoadingSpinner className="size-3" /> Outlining…
            </div>
          )}
          <CarveToolbar panel={shownPanel} choosing={choosing} onText={addText} onFile={() => chooseSvg(null)} onPanel={togglePanel} />
          {!carving.items.length && !assistant.open && (
            <CarveEmptyStart onText={addText} onFile={() => chooseSvg(null)} onAssistant={() => togglePanel('assistant')} />
          )}
          {((problem && problem !== kEmptyCarving) || off || cutOff || addError) && (
            <p
              role="alert"
              className="absolute bottom-3 left-16 z-10 flex max-w-md gap-2 rounded-md border bg-background/95 px-3 py-2 text-sm text-amber-600 shadow-sm">
              <AlertTriangle className="mt-0.5 size-4 shrink-0" />
              {(problem !== kEmptyCarving && problem) ||
                addError ||
                (off
                  ? 'The artwork reaches past the board: move it or make it smaller.'
                  : 'The cut line runs past the board: move the artwork further onto it, or make the cutout margin smaller.')}
            </p>
          )}
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
        {shownPanel && (
          <aside
            ref={panelRef}
            aria-label={kPanelNames[shownPanel]}
            className="flex w-full shrink-0 flex-col gap-4 overflow-auto border-t p-4 text-sm md:w-80 md:border-t-0 md:border-l">
            {shownPanel === 'assistant' && <CarvingAssistant job={job} session={assistant} onClose={() => togglePanel('assistant')} />}
            {shownPanel === 'items' && (
              <CarveItemsPanel
                items={carving.items}
                selectedId={selectedId}
                onSelect={select}
                onDelete={deleteItem}
                onClose={() => setPanel(null)}
              />
            )}
            {shownPanel === 'settings' && (
              <CarveSettingsPanel
                carving={carving}
                size={size}
                thickness={thickness}
                flatBitName={flatBitName}
                taped={board?.taped !== false}
                onCarving={saveCarving}
                onBoard={setBoard}
                onSelect={select}
                onClose={() => setPanel(null)}
              />
            )}
          </aside>
        )}
      </div>
    </CamPage>
  );
}

/** As the Boards step's tool buttons (`HoldTools`). */
const kToolButton =
  'flex size-8 items-center justify-center rounded-md text-foreground hover:bg-muted disabled:pointer-events-none disabled:opacity-35';

const kPanelNames: Record<CarvePanel, string> = { items: 'Items', settings: 'Board and bit', assistant: 'AI artwork' };

const rotationOf = (degrees: number) => ((degrees % 360) + 360) % 360;

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
