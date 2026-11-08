import type { CadPoint } from '@wbcnc/cad';
import type { PointerEvent } from 'react';
import { CadValueInput } from './CadValueInput';
import type { CircularPatternParameters } from './circularPatternParameters';
export function SketchCircularPatternControls({
  parameters,
  onChange,
  onApply,
  onCancel,
  error,
  previewLimited,
  releasedCount,
  onField,
}: {
  parameters: CircularPatternParameters;
  onChange: (p: CircularPatternParameters) => void;
  onApply: () => void;
  onCancel: () => void;
  error?: string;
  previewLimited: boolean;
  releasedCount: number;
  onField: (key: 'count' | 'angle', element: HTMLInputElement | null) => void;
}) {
  return (
    <form
      aria-label="Circular pattern"
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
      <label>
        Instances{' '}
        <input
          aria-label="Circular instances"
          ref={e => onField('count', e)}
          inputMode="numeric"
          value={parameters.count}
          onChange={e => onChange({ ...parameters, count: e.target.value })}
        />
      </label>
      <label>
        <input
          aria-label="Closed circular pattern"
          type="checkbox"
          checked={parameters.closed}
          onChange={e =>
            onChange({
              ...parameters,
              closed: e.target.checked,
              angle: e.target.checked ? '360' : parameters.angle === '360' ? '180' : parameters.angle,
            })
          }
        />
        Closed
      </label>
      {!parameters.closed && (
        <label>
          Sweep{' '}
          <CadValueInput
            aria-label="Pattern sweep"
            inputRef={e => onField('angle', e)}
            unit="deg"
            value={parameters.angle}
            onChange={e => onChange({ ...parameters, angle: e.target.value })}
          />
        </label>
      )}
      <label>
        Center X{' '}
        <CadValueInput
          aria-label="Pattern center X"
          value={parameters.centerX}
          onChange={e => onChange({ ...parameters, centerX: e.target.value })}
        />
      </label>
      <label>
        Center Y{' '}
        <CadValueInput
          aria-label="Pattern center Y"
          value={parameters.centerY}
          onChange={e => onChange({ ...parameters, centerY: e.target.value })}
        />
      </label>
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
      {previewLimited && <span>Showing up to 10 instances. Apply creates the full pattern.</span>}
      {releasedCount > 0 && <span role="status">{releasedCount} relations on removed instances will be released.</span>}
    </form>
  );
}
export function SketchCircularPatternManipulator({
  center,
  anchor,
  count,
  angle,
  closed,
  pixelScale,
  onStart,
  onEdit,
}: {
  center: CadPoint;
  anchor: CadPoint;
  count: number;
  angle: number;
  closed: boolean;
  pixelScale: number;
  onStart: (kind: 'center' | 'sweep', event: PointerEvent<SVGElement>) => void;
  onEdit: (field: 'count' | 'angle') => void;
}) {
  const k = 1 / pixelScale,
    r = Math.max(20 * k, Math.hypot(anchor.x - center.x, anchor.y - center.y)),
    start = Math.atan2(anchor.y - center.y, anchor.x - center.x),
    sweep = ((angle * Math.PI) / 180) * (closed ? (count - 1) / count : 1),
    end = start + sweep,
    point = { x: center.x + r * Math.cos(end), y: center.y + r * Math.sin(end) };
  const path = Array.from({ length: 49 }, (_, i) => {
    const a = start + (sweep * i) / 48;
    return `${i ? 'L' : 'M'}${center.x + r * Math.cos(a)} ${-center.y - r * Math.sin(a)}`;
  }).join('');
  const drag = (kind: 'center' | 'sweep') => (e: PointerEvent<SVGElement>) => {
    e.preventDefault();
    e.stopPropagation();
    onStart(kind, e);
  };
  return (
    <g stroke="#2467d1" fill="#fff" strokeWidth={1.5 * k}>
      <path d={path} fill="none" strokeDasharray={`${4 * k} ${3 * k}`} pointerEvents="none" />
      <path d={`M${center.x - 9 * k} ${-center.y}h${18 * k}M${center.x} ${-center.y - 9 * k}v${18 * k}`} pointerEvents="none" />
      <circle
        data-circular-handle="center"
        cx={center.x}
        cy={-center.y}
        r={6 * k}
        onPointerDown={drag('center')}
        style={{ cursor: 'move' }}>
        <title>Drag pattern center</title>
      </circle>
      <circle
        data-circular-handle="sweep"
        cx={point.x}
        cy={-point.y}
        r={6 * k}
        onPointerDown={drag('sweep')}
        style={{ cursor: 'crosshair' }}>
        <title>Drag total sweep</title>
      </circle>
      <text
        role="button"
        tabIndex={0}
        aria-label="Edit circular instance count"
        x={point.x + 10 * k}
        y={-point.y - 10 * k}
        fill="currentColor"
        stroke="none"
        fontSize={12 * k}
        onPointerDown={e => e.stopPropagation()}
        onDoubleClick={e => {
          e.stopPropagation();
          onEdit('count');
        }}
        onKeyDown={e => {
          if (e.key === 'Enter') {
            e.preventDefault();
            e.stopPropagation();
            onEdit('count');
          }
        }}>
        ×{count}
      </text>
    </g>
  );
}
