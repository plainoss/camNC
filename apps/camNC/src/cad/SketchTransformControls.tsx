import type { CadPoint } from '@wbcnc/cad';
import type { PointerEvent } from 'react';
import { CadValueInput } from './CadValueInput';
import type { TransformParameters, TransformDragKind } from './transformParameters';
export function SketchTransformControls({
  parameters,
  onChange,
  onApply,
  onCancel,
  error,
  releasedCount,
}: {
  parameters: TransformParameters;
  onChange: (value: TransformParameters) => void;
  onApply: () => void;
  onCancel: () => void;
  error?: string;
  releasedCount: number;
}) {
  const fields = [
    ['dx', 'Translate X'],
    ['dy', 'Translate Y'],
    ['angle', 'Rotate angle'],
    ['scale', 'Scale factor'],
    ['pivotX', 'Pivot X'],
    ['pivotY', 'Pivot Y'],
  ] as const;
  return (
    <form
      className="cad-create-size cad-transform-editor"
      aria-label="Transform selection"
      onSubmit={event => {
        event.preventDefault();
        onApply();
      }}>
      {fields.map(([key, label]) => (
        <label key={key}>
          {label}{' '}
          {key === 'scale' ? (
            <input
              aria-label={label}
              inputMode="decimal"
              value={parameters[key]}
              onChange={event => onChange({ ...parameters, [key]: event.target.value })}
              onKeyDown={event => {
                if (event.key === 'Escape') {
                  event.preventDefault();
                  onCancel();
                }
              }}
            />
          ) : (
            <CadValueInput
              unit={key === 'angle' ? 'deg' : 'mm'}
              aria-label={label}
              inputMode="decimal"
              value={parameters[key]}
              onChange={event => onChange({ ...parameters, [key]: event.target.value })}
              onKeyDown={event => {
                if (event.key === 'Escape') {
                  event.preventDefault();
                  onCancel();
                }
              }}
            />
          )}
        </label>
      ))}
      <label>
        <input
          type="checkbox"
          aria-label="Copy selection"
          checked={parameters.copy}
          onChange={event => onChange({ ...parameters, copy: event.target.checked })}
        />
        Copy
      </label>
      <button type="submit" disabled={!!error}>
        Apply transform
      </button>
      <button type="button" onClick={onCancel}>
        Cancel transform
      </button>
      {error && (
        <span role="alert" className="cad-error">
          {error}
        </span>
      )}
      {releasedCount > 0 && <span role="status">{releasedCount} external or directed relations will be released.</span>}
    </form>
  );
}
export function SketchTransformManipulator({
  pivot,
  pixelScale,
  onStart,
}: {
  pivot: CadPoint;
  pixelScale: number;
  onStart: (kind: TransformDragKind, event: PointerEvent<SVGElement>) => void;
}) {
  const k = 1 / pixelScale;
  const start = (kind: TransformDragKind) => (event: PointerEvent<SVGElement>) => {
    event.preventDefault();
    event.stopPropagation();
    onStart(kind, event);
  };
  return (
    <g transform={`translate(${pivot.x} ${-pivot.y})`} stroke="#2467d1" fill="#fff" strokeWidth={1.5 * k}>
      <path
        d={`M0 0h${55 * k}m${-7 * k} ${-4 * k} ${7 * k} ${4 * k} ${-7 * k} ${4 * k}M0 0v${-55 * k}m${-4 * k} ${7 * k} ${4 * k} ${-7 * k} ${4 * k} ${7 * k}`}
        fill="none"
        pointerEvents="none"
      />
      <rect
        data-transform-handle="translate"
        x={8 * k}
        y={-28 * k}
        width={20 * k}
        height={20 * k}
        fill="#2467d133"
        style={{ cursor: 'move' }}
        onPointerDown={start('translate')}>
        <title>Translate selection</title>
      </rect>
      <path
        data-transform-handle="rotate"
        d={`M${-30 * k} ${-60 * k}A${67 * k} ${67 * k} 0 0 1 ${30 * k} ${-60 * k}`}
        fill="none"
        strokeWidth={8 * k}
        style={{ cursor: 'grab' }}
        onPointerDown={start('rotate')}>
        <title>Rotate selection</title>
      </path>
      <path
        data-transform-handle="scale"
        d={`M${43 * k} ${31 * k}l${14 * k} ${14 * k}h${-14 * k}z`}
        style={{ cursor: 'nwse-resize' }}
        onPointerDown={start('scale')}>
        <title>Scale selection</title>
      </path>
      <circle data-transform-handle="pivot" r={5 * k} style={{ cursor: 'move' }} onPointerDown={start('pivot')}>
        <title>Move transform pivot</title>
      </circle>
    </g>
  );
}
