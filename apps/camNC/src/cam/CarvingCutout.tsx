import { useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { SelectionBar } from './boards/SelectionBar';
import { closestOnLoop, cutoutOutline, newCutout, type CarvingCutoutV1, type CarvingV1 } from './carving';
import { carvingBounds, carvingPath } from './carvingView';

type Pt = { x: number; y: number };

/** The Carve step's selection while the cutout line is selected (item IDs are UUIDs). */
export const kCutoutSelection = 'cutout';

const kShapes: { value: CarvingCutoutV1['shape']; label: string }[] = [
  { value: 'outline', label: 'Artwork outline' },
  { value: 'plaque', label: 'Rounded plaque' },
];
const kMaxMargin = 50;

/** The sidebar's switch: whether the carving is cut out of the board. The rest is set on the drawing. */
export function CarvingCutoutToggle({
  carving,
  taped,
  bitName,
  onChange,
}: {
  carving: CarvingV1;
  taped: boolean;
  bitName: string;
  onChange: (cutout: CarvingCutoutV1 | undefined) => void;
}) {
  return (
    <label className="flex items-start gap-2">
      <input
        type="checkbox"
        className="mt-0.5"
        checked={!!carving.cutout}
        onChange={e => onChange(e.target.checked ? newCutout(taped) : undefined)}
      />
      <span>
        Cut it out
        <span className="block text-xs text-muted-foreground">
          {carving.cutout
            ? `With the ${bitName}, after carving. Click the cut line on the board to change its shape, margin and holding.`
            : `With the ${bitName}, after carving, along the artwork's outline.`}
        </span>
      </span>
    </label>
  );
}

const closest = (q: Pt, loops: Pt[][]) =>
  loops.map(loop => closestOnLoop(q, loop)).reduce((a, b) => (b.d < a.d ? b : a), { x: q.x, y: q.y, d: Infinity });

/**
 * The cut line on the Carve step's board (SVG units = mm, Y down from the board's top): click it to select it. Selected,
 * a grip on its right sets the margin; with tabs, its tabs drag along it, a double-click on the line adds one and a
 * double-click on a tab removes it.
 */
export function CarvingCutoutLine({
  carving,
  size,
  selected,
  onSelect,
  onChange,
  toMm,
}: {
  carving: CarvingV1;
  size: { w: number; h: number };
  selected: boolean;
  onSelect: () => void;
  onChange: (cutout: CarvingCutoutV1) => void;
  toMm: (e: { clientX: number; clientY: number }) => Pt;
}) {
  // While the margin grip or a tab is dragged, its new place is shown before it's saved.
  const [preview, setPreview] = useState<CarvingCutoutV1 | null>(null);
  const drag = useRef<{ kind: 'margin' } | { kind: 'tab'; index: number } | null>(null);
  const cutout = preview ?? carving.cutout;
  if (!cutout) return null;
  const outline = cutoutOutline({ region: carving.region, cutout });
  const art = carvingBounds(carving.region);
  if (!outline.length || !art) return null;
  const y = (p: Pt) => size.h - p.y;
  const right = outline.flat().reduce((a, b) => (b.x > a.x ? b : a));
  const tabs = cutout.hold === 'tabs' ? (cutout.tabsAt ?? []).map(q => closest(q, outline)) : [];
  const stop = (e: ReactPointerEvent | React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
  };
  const grab = (next: NonNullable<typeof drag.current>) => (e: ReactPointerEvent) => {
    if (e.button !== 0) return;
    stop(e);
    (e.target as Element).setPointerCapture(e.pointerId);
    drag.current = next;
    setPreview(cutout);
  };
  const move = (e: ReactPointerEvent) => {
    const d = drag.current;
    if (!d || !preview) return;
    const at = toMm(e);
    if (d.kind === 'margin') setPreview({ ...preview, margin: Math.max(0, Math.min(kMaxMargin, Math.round(at.x - art.x1))) });
    else {
      const { x, y } = closest(at, outline);
      setPreview({ ...preview, tabsAt: (preview.tabsAt ?? []).map((q, i) => (i === d.index ? { x, y } : q)) });
    }
  };
  const drop = () => {
    if (drag.current && preview && preview !== carving.cutout) onChange(preview);
    drag.current = null;
    setPreview(null);
  };
  const handlers = { onPointerMove: move, onPointerUp: drop, onLostPointerCapture: drop };
  return (
    <g data-testid="carving-cutout">
      <path
        d={carvingPath(outline, size.h)}
        className={`pointer-events-none fill-amber-100/60 dark:fill-amber-800/40 ${selected ? 'stroke-primary' : 'stroke-sky-600'}`}
        strokeWidth={selected ? 1 : 0.8}
        strokeDasharray={selected ? undefined : '3 2'}
      />
      {/* A wide invisible stroke takes clicks on the line, so the artwork inside keeps its own. */}
      <path
        role="button"
        aria-label="Cut line"
        d={carvingPath(outline, size.h)}
        className="cursor-pointer fill-none stroke-transparent"
        strokeWidth={5}
        style={{ pointerEvents: 'stroke' }}
        onPointerDown={e => {
          if (e.button !== 0) return;
          stop(e);
          onSelect();
        }}
        onDoubleClick={e => {
          stop(e);
          if (cutout.hold !== 'tabs') return;
          const { x, y } = closest(toMm(e), outline);
          onChange({ ...cutout, tabsAt: [...(cutout.tabsAt ?? []), { x, y }] });
        }}
      />
      {tabs.map((t, i) => (
        <rect
          // biome-ignore lint/suspicious/noArrayIndexKey: tabs have no identity but their order
          key={i}
          role="button"
          aria-label={`Tab ${i + 1}`}
          x={t.x - 2}
          y={y(t) - 2}
          width={4}
          height={4}
          rx={0.8}
          className="cursor-grab fill-amber-500 stroke-background"
          strokeWidth={0.5}
          onPointerDown={grab({ kind: 'tab', index: i })}
          onDoubleClick={e => {
            stop(e);
            const tabsAt = cutout.tabsAt?.filter((_, j) => j !== i);
            onChange({ ...cutout, tabsAt: tabsAt?.length ? tabsAt : undefined });
          }}
          {...handlers}
        />
      ))}
      {selected && (
        <g>
          <rect
            role="slider"
            aria-label="Drag to change the margin"
            aria-valuenow={cutout.margin}
            x={right.x - 1.25}
            y={y(right) - 5}
            width={2.5}
            height={10}
            rx={1.25}
            className="cursor-ew-resize fill-primary stroke-background"
            strokeWidth={0.4}
            onPointerDown={grab({ kind: 'margin' })}
            {...handlers}
          />
          {preview && (
            <text x={right.x + 3} y={y(right) + 1.5} className="pointer-events-none fill-primary text-[4px]">
              {cutout.margin} mm
            </text>
          )}
        </g>
      )}
    </g>
  );
}

/** The selected cut line's bar, floating over the drawing: margin, shape, and what holds the piece. */
export function CarvingCutoutBar({
  carving,
  at,
  onChange,
}: {
  carving: CarvingV1 & { cutout: CarvingCutoutV1 };
  at: Pt;
  onChange: (cutout: CarvingCutoutV1 | undefined) => void;
}) {
  const cutout = carving.cutout;
  const pieces = cutoutOutline(carving).length;
  return (
    <SelectionBar<'margin'>
      id="carve-cutout"
      title="Cutout"
      note={pieces > 1 ? `${pieces} pieces` : undefined}
      at={at}
      fields={[{ key: 'margin', label: 'Margin', name: 'Cutout margin (mm)', value: cutout.margin, min: 0, max: kMaxMargin }]}
      onField={(_, margin) => onChange({ ...cutout, margin })}
      scopes={[]}
      onApply={() => {}}
      onDelete={() => onChange(undefined)}
      deleteLabel="Don't cut it out"
      menu={
        cutout.hold === 'tabs' && cutout.tabsAt?.length
          ? [{ label: 'Let Plan place the tabs', onSelect: () => onChange({ ...cutout, tabsAt: undefined }) }]
          : []
      }>
      <select
        aria-label="Cutout shape"
        className="h-8 rounded-md border bg-background px-2 text-sm"
        value={cutout.shape}
        onChange={e => onChange({ ...cutout, shape: e.target.value as CarvingCutoutV1['shape'] })}>
        {kShapes.map(s => (
          <option key={s.value} value={s.value}>
            {s.label}
          </option>
        ))}
      </select>
      <div role="radiogroup" aria-label="Hold it with" className="flex gap-0.5 rounded-md bg-muted p-0.5 text-sm">
        {(['skin', 'tabs'] as const).map(hold => (
          <button
            key={hold}
            type="button"
            role="radio"
            aria-checked={cutout.hold === hold}
            title={
              hold === 'skin'
                ? 'A thin layer stays on the bottom and is cut through at the end: no tab nubs on the edge'
                : `Tabs hold it; ${cutout.tabsAt?.length ? 'drag them along the line' : 'Plan places them, or double-click the line to place your own'}`
            }
            onClick={() => onChange({ ...cutout, hold })}
            className={`rounded px-2 py-0.5 ${cutout.hold === hold ? 'bg-background shadow-sm' : 'text-muted-foreground'}`}>
            {hold === 'skin' ? 'Onion skin' : 'Tabs'}
          </button>
        ))}
      </div>
    </SelectionBar>
  );
}
