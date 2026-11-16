import { useDesignUnits } from './designUnits';
import type { CadPoint } from '@wbcnc/cad';
import type { PointerEvent } from 'react';
import { CadValueInput } from './CadValueInput';
import type { LinearPatternParameters } from './linearPatternParameters';
const closeField = (input: HTMLInputElement) => {
  const box = input.closest('label');
  if (box instanceof HTMLElement) delete box.dataset.open;
};

/**
 * A sketch linear pattern is edited where it's drawn, as in the reference: its counts and spacings are chips and a
 * dimension on the guide, and double-clicking one opens its value here, in a small box under it. Enter takes the value
 * and closes the box; the pattern is made as the sketch is confirmed, by Enter in the drawing, or a click on empty space.
 */
export function SketchLinearPatternControls({
  parameters,
  onChange,
  onCancel,
  error,
  releasedCount,
  previewLimited,
  onField,
}: {
  parameters: LinearPatternParameters;
  onChange: (p: LinearPatternParameters) => void;
  onApply: () => void;
  onCancel: () => void;
  error?: string;
  releasedCount: number;
  previewLimited: boolean;
  onField: (key: Exclude<keyof LinearPatternParameters, 'secondDirection'>, element: HTMLInputElement | null) => void;
}) {
  const fields = [
    ['countX', 'Instances 1', 'scalar'],
    ['spacingX', 'Spacing 1', 'mm'],
    ['angleX', 'Direction angle 1', 'deg'],
    ['countY', 'Instances 2', 'scalar'],
    ['spacingY', 'Spacing 2', 'mm'],
    ['angleY', 'Direction angle 2', 'deg'],
  ] as const;
  return (
    <form
      aria-label="Linear pattern"
      className="cad-pattern-inline"
      onSubmit={e => {
        e.preventDefault();
        const input = document.activeElement;
        if (input instanceof HTMLInputElement) {
          closeField(input);
          input.blur();
        }
      }}
      onKeyDown={e => {
        if (e.key === 'Escape') {
          e.preventDefault();
          const input = e.target instanceof HTMLInputElement ? e.target : null;
          const box = input?.closest('label');
          if (input && box?.dataset.open !== undefined) {
            const key = fields.find(([, label]) => label === input.getAttribute('aria-label'))?.[0];
            if (key && box.dataset.before !== undefined) {
              const next = { ...parameters, [key]: box.dataset.before };
              if (key === 'countY') next.secondDirection = Number(box.dataset.before) !== 1;
              onChange(next);
            }
            closeField(input);
            input.blur();
          } else onCancel();
        }
      }}>
      {fields.map(([key, label, unit]) => (
        <label key={key} className="cad-pattern-field">
          <span className="sr-only">{label}</span>
          <CadValueInput
            inputRef={e => onField(key, e)}
            aria-label={label}
            unit={unit}
            inputMode={unit === 'scalar' ? 'numeric' : 'decimal'}
            value={parameters[key]}
            onBlur={e => closeField(e.currentTarget)}
            onKeyDown={e => {
              // Enter takes the value and closes its box; a choice in the field's own variable list is taken first.
              if (e.key !== 'Enter' || e.defaultPrevented) return;
              e.preventDefault();
              closeField(e.currentTarget);
              e.currentTarget.blur();
            }}
            onChange={e => {
              const next = { ...parameters, [key]: e.target.value };
              // The second direction is on once it repeats more than once.
              if (key === 'countY') next.secondDirection = Number(e.target.value) !== 1;
              onChange(next);
            }}
          />
        </label>
      ))}
      {error && (
        <span role="alert" className="cad-error">
          {error}
        </span>
      )}
      {releasedCount > 0 && <span role="status">{releasedCount} relations on removed instances will be released.</span>}
      {previewLimited && <span role="status">Showing up to 10 instances. The sketch gets the full pattern.</span>}
    </form>
  );
}

/**
 * The pattern as it's drawn: for each direction a dashed guide from the seed's start to its last instance, ending in
 * an arrow, the spacing as a dimension on its first step and the count as a chip at its end ("3x"; "ƒ 4x" when a
 * variable sets it). A direction at one instance shows only its chip on a short arrow, to turn it on.
 */
export function SketchLinearPatternManipulator({
  anchor,
  steps,
  counts,
  bound = [false, false],
  pixelScale,
  onStart,
  onEdit,
}: {
  anchor: CadPoint;
  steps: CadPoint[];
  counts: number[];
  bound?: boolean[];
  pixelScale: number;
  onStart: (index: number, event: PointerEvent<SVGElement>) => void;
  onEdit: (field: 'countX' | 'countY' | 'spacingX' | 'spacingY' | 'angleX' | 'angleY', chip: Element) => void;
}) {
  const { formatLength } = useDesignUnits();
  const k = 1 / pixelScale;
  return (
    <g>
      {steps.map((step, index) => {
        const count = counts[index] ?? 1,
          length = Math.hypot(step.x, step.y) || 1,
          unit = { x: step.x / length, y: step.y / length };
        const label = index === 0 ? '1' : '2';
        // Off, a direction is a short arrow to its chip; on, its guide runs to the last instance.
        const reach = count > 1 ? (count - 1) * length : 24 * k;
        const end = { x: anchor.x + unit.x * reach, y: anchor.y + unit.y * reach },
          first = { x: anchor.x + step.x, y: anchor.y + step.y };
        const head = (side: 1 | -1) => ({
          x: end.x - unit.x * 7 * k + side * -unit.y * 4 * k,
          y: end.y - unit.y * 7 * k + side * unit.x * 4 * k,
        });
        const [left, right] = [head(1), head(-1)];
        const edit =
          (field: 'countX' | 'countY' | 'spacingX' | 'spacingY') => (e: { stopPropagation: () => void; currentTarget: Element }) => {
            e.stopPropagation();
            onEdit(field, e.currentTarget);
          };
        const chip = `${bound[index] ? 'ƒ ' : ''}${count}x`;
        return (
          <g key={index} stroke="#2467d1" fill="#fff" strokeWidth={1.5 * k}>
            <path
              data-pattern-guide={index}
              d={`M${anchor.x} ${-anchor.y}L${end.x} ${-end.y}`}
              fill="none"
              strokeDasharray={`${6 * k} ${4 * k}`}
              pointerEvents="none"
            />
            <path d={`M${left.x} ${-left.y}L${end.x} ${-end.y}L${right.x} ${-right.y}`} fill="none" pointerEvents="none" />
            {count > 1 && (
              <circle
                data-pattern-direction={index}
                cx={first.x}
                cy={-first.y}
                r={5 * k}
                style={{ cursor: 'move' }}
                onPointerDown={e => {
                  e.preventDefault();
                  e.stopPropagation();
                  onStart(index, e);
                }}>
                <title>Drag direction {label} spacing and angle</title>
              </circle>
            )}
            <text
              data-pattern-count={index}
              role="button"
              tabIndex={0}
              aria-label={`Edit instance count ${label}`}
              x={end.x + unit.x * 10 * k}
              y={-(end.y + unit.y * 10 * k) - 4 * k}
              fill="currentColor"
              stroke="none"
              fontSize={12 * k}
              style={{ cursor: 'text' }}
              onPointerDown={e => e.stopPropagation()}
              onDoubleClick={edit(index === 0 ? 'countX' : 'countY')}
              onKeyDown={e => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  edit(index === 0 ? 'countX' : 'countY')(e);
                }
              }}>
              {chip}
            </text>
            {count > 1 && (
              <text
                data-pattern-spacing={index}
                role="button"
                tabIndex={0}
                aria-label={`Edit spacing ${label}`}
                x={anchor.x + step.x / 2 - unit.y * 10 * k}
                y={-(anchor.y + step.y / 2 + unit.x * 10 * k)}
                textAnchor="middle"
                fill="currentColor"
                stroke="none"
                fontSize={11 * k}
                style={{ cursor: 'text' }}
                onPointerDown={e => e.stopPropagation()}
                onDoubleClick={edit(index === 0 ? 'spacingX' : 'spacingY')}
                onKeyDown={e => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    edit(index === 0 ? 'spacingX' : 'spacingY')(e);
                  }
                }}>
                {formatLength(length)}
              </text>
            )}
          </g>
        );
      })}
    </g>
  );
}
