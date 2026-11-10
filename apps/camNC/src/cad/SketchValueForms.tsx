import { useDesignUnits } from './designUnits';
import type { CadConstraint } from '@wbcnc/cad';
import type { CSSProperties, Ref } from 'react';
import { CadValueInput } from './CadValueInput';

/** The forms under the sketch canvas where a tool takes its numbers: polygon sides, chamfer, fillet, rho, dimension, size. */

type NumericConstraint = Extract<CadConstraint, { value: number }>;
type Outcome = { ok: true } | { ok: false; message: string };

export function SketchPolygonForm({
  inputRef,
  sides,
  canCreate,
  onSides,
  onCreate,
  onEscape,
}: {
  inputRef: Ref<HTMLInputElement>;
  sides: string;
  canCreate: boolean;
  onSides: (value: string) => void;
  onCreate: () => void;
  onEscape: () => void;
}) {
  return (
    <form
      className="cad-create-size"
      onSubmit={event => {
        event.preventDefault();
        onCreate();
      }}>
      <label>
        Polygon sides{' '}
        <input
          ref={inputRef}
          aria-label="Polygon sides"
          type="number"
          min={3}
          max={50}
          step={1}
          value={sides}
          onChange={event => onSides(event.target.value)}
          onKeyDown={event => {
            if (event.key === 'Escape') {
              event.preventDefault();
              onEscape();
            }
          }}
        />
      </label>
      <button type="submit" disabled={!canCreate}>
        Create polygon
      </button>
    </form>
  );
}

export function SketchChamferForm({
  distances,
  preview,
  selection,
  onDistances,
  onApply,
  onCancel,
}: {
  distances: string[];
  preview: Outcome | null;
  selection: Outcome | null;
  onDistances: (update: (previous: string[]) => string[]) => void;
  onApply: () => void;
  onCancel: () => void;
}) {
  return (
    <form
      className="cad-create-size cad-chamfer-editor"
      onSubmit={event => {
        event.preventDefault();
        onApply();
      }}>
      {distances.map((value, index) => (
        <label key={index}>
          Distance {index + 1}{' '}
          <CadValueInput
            aria-label={`Chamfer distance ${index + 1}`}
            inputMode="decimal"
            value={value}
            onChange={event => onDistances(previous => previous.map((text, i) => (i === index ? event.target.value : text)))}
            onKeyDown={event => {
              if (event.key === 'Escape') {
                event.preventDefault();
                onCancel();
              }
            }}
          />
        </label>
      ))}
      <button type="submit" disabled={!preview?.ok}>
        Apply chamfers
      </button>
      <button type="button" onClick={onCancel}>
        Cancel chamfers
      </button>
      {((preview && !preview.ok) || (selection && !selection.ok)) && (
        <span role="alert" className="cad-error">
          {(preview && !preview.ok ? preview.message : undefined) ?? (selection && !selection.ok ? selection.message : '')}
        </span>
      )}
    </form>
  );
}

export function SketchFilletForm({
  inputRef,
  radius,
  preview,
  onRadius,
  onFocus,
  onApply,
  onCancel,
}: {
  inputRef: Ref<HTMLInputElement>;
  radius: string;
  preview: Outcome | null;
  onRadius: (value: string) => void;
  onFocus: () => void;
  onApply: () => void;
  onCancel: () => void;
}) {
  return (
    <form
      className="cad-create-size cad-fillet-editor"
      onSubmit={event => {
        event.preventDefault();
        onApply();
      }}>
      <label>
        Fillet radius{' '}
        <CadValueInput
          inputRef={inputRef}
          aria-label="Fillet radius"
          inputMode="decimal"
          value={radius}
          onFocus={onFocus}
          onChange={event => onRadius(event.target.value)}
          onKeyDown={event => {
            if (event.key === 'Escape') {
              event.preventDefault();
              onCancel();
            }
          }}
        />
      </label>
      <button type="submit" disabled={!preview?.ok}>
        Apply fillets
      </button>
      <button type="button" onClick={onCancel}>
        Cancel fillets
      </button>
      {preview && !preview.ok && (
        <span role="alert" className="cad-error">
          {preview.message}
        </span>
      )}
    </form>
  );
}

export function SketchConicRhoForm({
  inputRef,
  rho,
  onRho,
  onApply,
  onClose,
}: {
  inputRef: Ref<HTMLInputElement>;
  rho: string;
  onRho: (value: string) => void;
  onApply: () => void;
  onClose: () => void;
}) {
  return (
    <form
      className="cad-create-size cad-conic-editor"
      onSubmit={event => {
        event.preventDefault();
        onApply();
      }}>
      <label>
        Rho{' '}
        <input
          ref={inputRef}
          aria-label="Conic rho"
          inputMode="decimal"
          value={rho}
          onChange={event => onRho(event.target.value)}
          onKeyDown={event => {
            if (event.key === 'Escape') {
              event.preventDefault();
              onClose();
            }
          }}
        />
      </label>
      <span>0 &lt; ρ &lt; 1</span>
      <button type="submit">Apply rho</button>
      <button type="button" onClick={onClose}>
        Close rho
      </button>
    </form>
  );
}

export function SketchDimensionEditor({
  dimension,
  inputRef,
  style,
  onApply,
  onCancel,
}: {
  dimension: NumericConstraint;
  inputRef: Ref<HTMLInputElement>;
  style: CSSProperties | undefined;
  onApply: () => void;
  onCancel: () => void;
}) {
  const { lengthText, lengthUnit } = useDesignUnits();
  return (
    <form
      className="cad-dimension-editor"
      style={style}
      onSubmit={event => {
        event.preventDefault();
        onApply();
      }}>
      <label htmlFor="cad-edit-dimension" className="sr-only">
        {dimension.label ?? dimension.type} <span>{dimension.type === 'angle' ? 'degrees' : lengthUnit}</span>
      </label>
      <div>
        <CadValueInput
          id="cad-edit-dimension"
          inputRef={inputRef}
          key={dimension.id}
          defaultValue={dimension.expression ?? (dimension.type === 'angle' ? String(dimension.value) : lengthText(dimension.value))}
          inputMode="decimal"
          unit={dimension.type === 'angle' ? 'deg' : 'mm'}
          unitClassName="cad-dimension-unit"
          onKeyDown={event => {
            if (event.key === 'Escape') {
              event.preventDefault();
              onCancel();
            } else if (event.key === 'Enter' && (event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229))
              event.preventDefault();
          }}
        />
        <button type="submit" aria-label="Apply dimension">
          ✓
        </button>
        <button type="button" aria-label="Cancel dimension edit" onClick={onCancel}>
          ×
        </button>
      </div>
    </form>
  );
}

export function SketchShapeSizeForm({
  from,
  rectangle,
  width,
  height,
  radius,
  onWidth,
  onHeight,
  onRadius,
  onCreate,
}: {
  from: { x: number; y: number };
  /** A rectangle takes width and height; otherwise a circle takes its radius. */
  rectangle: boolean;
  width: string;
  height: string;
  radius: string;
  onWidth: (value: string) => void;
  onHeight: (value: string) => void;
  onRadius: (value: string) => void;
  onCreate: () => void;
}) {
  const { formatLength } = useDesignUnits();
  return (
    <form
      className="cad-create-size"
      onSubmit={event => {
        event.preventDefault();
        onCreate();
      }}>
      <span>
        From {formatLength(from.x)}, {formatLength(from.y)}
      </span>
      {rectangle ? (
        <>
          <label>
            Width{' '}
            <CadValueInput aria-label="Rectangle width" value={width} onChange={event => onWidth(event.target.value)} inputMode="decimal" />
          </label>
          <label>
            Height{' '}
            <CadValueInput
              aria-label="Rectangle height"
              value={height}
              onChange={event => onHeight(event.target.value)}
              inputMode="decimal"
            />
          </label>
        </>
      ) : (
        <label>
          Radius{' '}
          <CadValueInput aria-label="Circle radius" value={radius} onChange={event => onRadius(event.target.value)} inputMode="decimal" />
        </label>
      )}
      <button type="submit">Create</button>
    </form>
  );
}
