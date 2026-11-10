import { useDesignUnits } from './designUnits';
import type { CadPoint } from '@wbcnc/cad';
import type { PointerEvent } from 'react';
import { CadValueInput } from './CadValueInput';
import type { LinearPatternParameters } from './linearPatternParameters';
export function SketchLinearPatternControls({
  parameters,
  onChange,
  onApply,
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
  const direction = (index: 0 | 1) => {
    const fields = index === 0 ? (['countX', 'spacingX', 'angleX'] as const) : (['countY', 'spacingY', 'angleY'] as const);
    return (
      <fieldset>
        <legend>Direction {index + 1}</legend>
        {fields.map((key, i) => (
          <label key={key}>
            {['Instances', 'Spacing', 'Angle'][i]}{' '}
            {i === 0 ? (
              <input
                ref={e => onField(key, e)}
                aria-label={`Instances ${index + 1}`}
                inputMode="numeric"
                value={parameters[key]}
                onChange={e => onChange({ ...parameters, [key]: e.target.value })}
              />
            ) : (
              <CadValueInput
                inputRef={e => onField(key, e)}
                aria-label={`${i === 1 ? 'Spacing' : 'Direction angle'} ${index + 1}`}
                unit={i === 1 ? 'mm' : 'deg'}
                inputMode="decimal"
                value={parameters[key]}
                onChange={e => onChange({ ...parameters, [key]: e.target.value })}
              />
            )}
          </label>
        ))}
      </fieldset>
    );
  };
  return (
    <form
      aria-label="Linear pattern"
      className="cad-create-size cad-pattern-editor"
      onSubmit={e => {
        e.preventDefault();
        onApply();
      }}
      onKeyDown={e => {
        if (e.key === 'Escape') {
          e.preventDefault();
          onCancel();
        }
      }}>
      {direction(0)}
      <label>
        <input
          type="checkbox"
          aria-label="Second direction"
          checked={parameters.secondDirection}
          onChange={e => onChange({ ...parameters, secondDirection: e.target.checked })}
        />
        Second direction
      </label>
      {parameters.secondDirection && direction(1)}
      <button type="submit" disabled={!!error}>
        Apply pattern
      </button>
      <button type="button" onClick={onCancel}>
        Cancel pattern
      </button>
      {error && (
        <span role="alert" className="cad-error">
          {error}
        </span>
      )}
      {releasedCount > 0 && <span role="status">{releasedCount} relations on removed instances will be released.</span>}
      {previewLimited && <span>Showing up to 10 instances. Apply creates the full pattern.</span>}
    </form>
  );
}
export function SketchLinearPatternManipulator({
  anchor,
  steps,
  counts,
  pixelScale,
  onStart,
  onEdit,
}: {
  anchor: CadPoint;
  steps: CadPoint[];
  counts: number[];
  pixelScale: number;
  onStart: (index: number, event: PointerEvent<SVGElement>) => void;
  onEdit: (field: 'countX' | 'countY' | 'spacingX' | 'spacingY' | 'angleX' | 'angleY') => void;
}) {
  const { formatLength, lengthUnit } = useDesignUnits();
  const k = 1 / pixelScale;
  return (
    <g>
      {steps.map((step, index) => {
        const end = { x: anchor.x + step.x, y: anchor.y + step.y },
          label = index === 0 ? '1' : '2';
        const edit =
          (field: 'countX' | 'countY' | 'spacingX' | 'spacingY' | 'angleX' | 'angleY') => (e: { stopPropagation: () => void }) => {
            e.stopPropagation();
            onEdit(field);
          };
        return (
          <g key={index} stroke={index === 0 ? '#2467d1' : '#247647'} fill="#fff" strokeWidth={1.5 * k}>
            <path d={`M${anchor.x} ${-anchor.y}L${end.x} ${-end.y}`} fill="none" pointerEvents="none" />
            <circle cx={anchor.x} cy={-anchor.y} r={3 * k} pointerEvents="none" />
            <circle
              data-pattern-direction={index}
              cx={end.x}
              cy={-end.y}
              r={6 * k}
              style={{ cursor: 'move' }}
              onPointerDown={e => {
                e.preventDefault();
                e.stopPropagation();
                onStart(index, e);
              }}>
              <title>Drag direction {label} spacing and angle</title>
            </circle>
            <text
              data-pattern-count={index}
              role="button"
              tabIndex={0}
              aria-label={`Edit instance count ${label}`}
              x={end.x + 10 * k}
              y={-end.y - 10 * k}
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
              ×{counts[index]}
            </text>
            <text
              role="button"
              tabIndex={0}
              aria-label={`Edit spacing ${label}`}
              x={anchor.x + step.x / 2 + 8 * k}
              y={-anchor.y - step.y / 2 - 8 * k}
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
              {formatLength(Math.hypot(step.x, step.y))} {lengthUnit}
            </text>
          </g>
        );
      })}
    </g>
  );
}
