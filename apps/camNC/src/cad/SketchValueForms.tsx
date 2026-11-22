import { t as translate } from '@wbcnc/i18n';
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
        {translate('Polygon sides')}{' '}
        <input
          ref={inputRef}
          aria-label={translate('Polygon sides')}
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
        {translate('Create polygon ')}
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
          {translate('Distance ')}
          {index + 1}{' '}
          <CadValueInput
            aria-label={translate('Chamfer distance {{value1}}', { value1: index + 1 })}
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
        {translate('Apply chamfers ')}
      </button>
      <button type="button" onClick={onCancel}>
        {translate('Cancel chamfers ')}
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
        {translate('Fillet radius')}{' '}
        <CadValueInput
          inputRef={inputRef}
          aria-label={translate('Fillet radius')}
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
        {translate('Apply fillets ')}
      </button>
      <button type="button" onClick={onCancel}>
        {translate('Cancel fillets ')}
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
        {translate('Rho')}{' '}
        <input
          ref={inputRef}
          aria-label={translate('Conic rho')}
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
      <button type="submit">{translate('Apply rho')}</button>
      <button type="button" onClick={onClose}>
        {translate('Close rho ')}
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
        {dimension.label ?? dimension.type} <span>{dimension.type === 'angle' ? translate('degrees') : lengthUnit}</span>
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
        <button type="submit" aria-label={translate('Apply dimension')}>
          ✓
        </button>
        <button type="button" aria-label={translate('Cancel dimension edit')} onClick={onCancel}>
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
        {translate('From ')}
        {formatLength(from.x)}, {formatLength(from.y)}
      </span>
      {rectangle ? (
        <>
          <label>
            {translate('Width')}{' '}
            <CadValueInput
              aria-label={translate('Rectangle width')}
              value={width}
              onChange={event => onWidth(event.target.value)}
              inputMode="decimal"
            />
          </label>
          <label>
            {translate('Height')}{' '}
            <CadValueInput
              aria-label={translate('Rectangle height')}
              value={height}
              onChange={event => onHeight(event.target.value)}
              inputMode="decimal"
            />
          </label>
        </>
      ) : (
        <label>
          {translate('Radius')}{' '}
          <CadValueInput
            aria-label={translate('Circle radius')}
            value={radius}
            onChange={event => onRadius(event.target.value)}
            inputMode="decimal"
          />
        </label>
      )}
      <button type="submit">{translate('Create')}</button>
    </form>
  );
}
