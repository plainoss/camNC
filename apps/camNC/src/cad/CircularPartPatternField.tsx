import { CAD_MAX_PART_PATTERN, type CadPartPattern, type CadValueScope } from '@wbcnc/cad';
import { useEffect, useId, useRef, useState } from 'react';
import type { CadConnectorPick } from './PartFeatureDialogs';
import { CadValueInput } from './CadValueInput';
import { formatCadValue, parseCadValue } from './valueExpressions';
import './cadThicknessField.css';
import './circularPartPatternField.css';

type Pattern = Omit<CadPartPattern, 'id'>;
type Circular = NonNullable<CadPartPattern['circular']>;
type Vec3 = [number, number, number];
const axes: Record<CadPartPattern['axis'], Vec3> = { x: [1, 0, 0], y: [0, 1, 0], z: [0, 0, 1] };

/** A circular part pattern's fixed world axis and live count/angle values. */
export function CircularPartPatternField({
  pattern,
  variables,
  pickPoint,
  onChange,
  onDone,
  onValidityChange,
}: {
  pattern: CadPartPattern & { circular: Circular };
  variables?: CadValueScope;
  pickPoint?: (picked: ((pick: CadConnectorPick) => void) | null) => void;
  onChange: (pattern: Pattern) => void;
  onDone?: () => void;
  onValidityChange?: (problem: string | null) => void;
}) {
  const id = useId();
  const circular = pattern.circular;
  const typedCount = pattern.countExpression ?? String(pattern.count);
  const typedAngle = circular.angleExpression ?? formatCadValue(circular.angle);
  const typedOrigin = circular.origin.map(formatCadValue) as [string, string, string];
  const originKey = typedOrigin.join(',');
  const axisKey = circular.axis.join(',');
  const [count, setCount] = useState(typedCount);
  const [angle, setAngle] = useState(typedAngle);
  const [origin, setOrigin] = useState(typedOrigin);
  const [draftAxis, setDraftAxis] = useState(circular.axis);
  const [picking, setPicking] = useState(false);
  const [pickProblem, setPickProblem] = useState<string | null>(null);
  const dirty = useRef(false);
  const pickGeneration = useRef(0);
  // A late viewport callback must not change a closed field or replace a newer manual axis.
  useEffect(
    () => () => {
      pickGeneration.current++;
    },
    []
  );
  useEffect(() => {
    if (!dirty.current) {
      setCount(typedCount);
      setAngle(typedAngle);
      setOrigin(typedOrigin);
      setDraftAxis(circular.axis);
    }
    // The origin is compared by value, rather than a new tuple on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [typedCount, typedAngle, originKey, axisKey]);

  const parse = (originText = origin, axis = draftAxis): Pattern | string => {
    const parsedCount = parseCadValue(count, { unit: 'scalar', variables });
    if ('error' in parsedCount) return parsedCount.error;
    if (!Number.isInteger(parsedCount.value) || parsedCount.value < 1 || parsedCount.value > CAD_MAX_PART_PATTERN)
      return `Instance count must be a whole number from 1 to ${CAD_MAX_PART_PATTERN}, including the original part.`;
    const parsedAngle = parseCadValue(angle, { unit: 'deg', variables });
    if ('error' in parsedAngle) return parsedAngle.error;
    if (parsedAngle.value <= 0 || parsedAngle.value > 360) return 'Angle must be greater than 0° and no more than 360°.';
    const parsedOrigin = originText.map(text => parseCadValue(text, { unit: 'mm' }));
    for (const coordinate of parsedOrigin) if ('error' in coordinate) return `Axis origin: ${coordinate.error}`;
    if (!axis.every(Number.isFinite) || Math.hypot(...axis) < 1e-9) return 'Pick a straight edge or a face for the axis.';
    return {
      axis: pattern.axis,
      spacing: pattern.spacing,
      ...(pattern.suppressed && { suppressed: pattern.suppressed }),
      count: parsedCount.value,
      ...(parsedCount.expression && { countExpression: parsedCount.expression }),
      circular: {
        ...circular,
        axis,
        origin: parsedOrigin.map(coordinate => ('value' in coordinate ? coordinate.value : 0)) as Vec3,
        angle: parsedAngle.value,
        angleExpression: parsedAngle.expression,
      },
    };
  };
  const parsed = parse();
  const problem = typeof parsed === 'string' ? parsed : pickProblem;
  useEffect(() => onValidityChange?.(problem), [problem, onValidityChange]);
  useEffect(() => () => onValidityChange?.(null), [onValidityChange]);

  const apply = (change: Partial<Circular> = {}, originText = origin) => {
    const next = parse(originText, change.axis ?? draftAxis);
    if (typeof next === 'string') return;
    dirty.current = false;
    setPickProblem(null);
    onChange({ ...next, circular: { ...next.circular!, ...change } });
  };
  // Viewport picks arrive later, after a count or angle may have changed.
  const latestApply = useRef(apply);
  latestApply.current = apply;
  const cancelPick = () => {
    pickGeneration.current++;
    pickPoint?.(null);
    setPicking(false);
  };
  const keys = (event: React.KeyboardEvent) => {
    const inDialog = !!event.currentTarget.closest('.cad-feature-dialog');
    if (!(inDialog && (event.key === 'Enter' || event.key === 'Escape'))) event.stopPropagation();
    if (event.key === 'Enter') {
      apply();
      onDone?.();
    } else if (event.key === 'Escape') {
      dirty.current = false;
      setCount(typedCount);
      setAngle(typedAngle);
      setOrigin(typedOrigin);
      setDraftAxis(circular.axis);
      setPickProblem(null);
      cancelPick();
      onDone?.();
    }
  };
  const edit =
    (set: (text: string) => void, editsAxis = false) =>
    (event: React.ChangeEvent<HTMLInputElement>) => {
      if (editsAxis) cancelPick();
      dirty.current = true;
      setPickProblem(null);
      set(event.currentTarget.value);
    };
  const selectedAxis = (Object.keys(axes) as CadPartPattern['axis'][]).find(axis =>
    axes[axis].every((value, i) => Math.abs(value - draftAxis[i]!) < 1e-9)
  );
  const coordinates = (values: number[]) => values.map(value => +value.toFixed(3)).join(', ');
  return (
    <div className="cad-part-pattern-field cad-circular-part-pattern">
      {pickPoint && (
        <button
          type="button"
          className="cad-feature-selection"
          data-active={picking ? '' : undefined}
          aria-label="Axis of pattern"
          onClick={() => {
            const generation = ++pickGeneration.current;
            setPicking(true);
            setPickProblem(null);
            pickPoint(pick => {
              if (generation !== pickGeneration.current) return;
              pickGeneration.current++;
              setPicking(false);
              const point = pick.edge?.a ?? pick.point;
              const along = pick.edge ? (pick.edge.b.map((value, i) => value - pick.edge!.a[i]!) as Vec3) : pick.normal;
              const length = Math.hypot(...along);
              if (!point.every(Number.isFinite) || !Number.isFinite(length) || length < 1e-9)
                return setPickProblem('Pick a straight edge or a face for the axis.');
              const axis = along.map(value => value / length) as Vec3;
              const originText = point.map(formatCadValue) as [string, string, string];
              // Keep the complete picked line while another draft field is invalid, ready to apply when corrected.
              dirty.current = true;
              setDraftAxis(axis);
              setOrigin(originText);
              latestApply.current({ origin: point, axis }, originText);
            });
          }}>
          <small>Axis of pattern</small>
          <span>
            {picking
              ? 'Pick an edge or a face'
              : `${selectedAxis?.toUpperCase() ?? `(${coordinates(draftAxis)})`} through (${origin.join(', ')})`}
          </span>
        </button>
      )}
      <label htmlFor={`${id}-axis`} className="cad-number-field">
        Axis direction
        <span>
          <select
            id={`${id}-axis`}
            value={selectedAxis ?? 'picked'}
            onChange={event => {
              cancelPick();
              const axis = axes[event.currentTarget.value as CadPartPattern['axis']];
              dirty.current = true;
              setDraftAxis(axis);
              apply({ axis });
            }}>
            {!selectedAxis && <option value="picked">Picked axis</option>}
            <option value="x">X</option>
            <option value="y">Y</option>
            <option value="z">Z</option>
          </select>
        </span>
      </label>
      <label htmlFor={`${id}-angle`} className="cad-number-field">
        Angle
        <span>
          <CadValueInput
            id={`${id}-angle`}
            aria-label="Angle"
            unit="deg"
            value={angle}
            spellCheck={false}
            aria-invalid={typeof parsed === 'string' || undefined}
            onChange={edit(setAngle)}
            onBlur={() => dirty.current && apply()}
            onKeyDown={keys}
          />
        </span>
      </label>
      <label htmlFor={`${id}-count`} className="cad-number-field">
        Instance count
        <span>
          <CadValueInput
            bare
            id={`${id}-count`}
            value={count}
            spellCheck={false}
            aria-invalid={typeof parsed === 'string' || undefined}
            onChange={edit(setCount)}
            onBlur={() => dirty.current && apply()}
            onKeyDown={keys}
          />
        </span>
      </label>
      <label className="cad-circular-pattern-option">
        <input
          type="checkbox"
          checked={circular.equalSpacing !== false}
          onChange={event => apply({ equalSpacing: event.currentTarget.checked })}
        />
        Equal spacing
      </label>
      <label className="cad-circular-pattern-option">
        <input type="checkbox" checked={!!circular.opposite} onChange={event => apply({ opposite: event.currentTarget.checked })} />
        Opposite direction
      </label>
      <p className="cad-feature-hint">
        {circular.equalSpacing !== false
          ? 'Spread instances within the angle. A full circle has no duplicate at 360°.'
          : 'Use the angle between each instance.'}{' '}
        The count includes the original part.
      </p>
      <details>
        <summary>Axis origin</summary>
        {(['X', 'Y', 'Z'] as const).map((axis, index) => (
          <label key={axis} htmlFor={`${id}-origin-${axis}`} className="cad-number-field">
            {axis}
            <span>
              <CadValueInput
                id={`${id}-origin-${axis}`}
                aria-label={`Axis origin ${axis}`}
                value={origin[index]}
                spellCheck={false}
                onChange={edit(
                  text => setOrigin(values => values.map((value, i) => (i === index ? text : value)) as [string, string, string]),
                  true
                )}
                onBlur={() => dirty.current && apply()}
                onKeyDown={keys}
              />
            </span>
          </label>
        ))}
      </details>
      {problem && (
        <p role="alert" className="cad-thickness-error">
          {problem}
        </p>
      )}
    </div>
  );
}
