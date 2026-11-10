import { CAD_MAX_PART_PATTERN, type CadDocument, type CadDrawnOn, type CadPartPattern, type CadValueScope } from '@wbcnc/cad';
import { useEffect, useId, useRef, useState } from 'react';
import { formatCadValue, parseCadValue } from './valueExpressions';
import './cadThicknessField.css';
import { CadValueInput } from './CadValueInput';
import { drawnOnName } from './drawnOnName';
import { CircularPartPatternField } from './CircularPartPatternField';

type Pattern = Omit<CadPartPattern, 'id'>;
type Vec3 = [number, number, number];
const kStart: Pattern = { axis: 'x', count: 2, spacing: 100 };

/** The inline part controls also edit circular patterns without converting them into a row. */
export function CadPartPatternField(props: Parameters<typeof LinearPartPatternField>[0]) {
  const circular = props.pattern?.circular;
  return circular && props.pattern ? (
    <CircularPartPatternField
      pattern={{ ...props.pattern, circular }}
      variables={props.variables}
      onChange={props.onChange}
      onDone={props.onDone}
    />
  ) : (
    <LinearPartPatternField {...props} />
  );
}

/** Copies of a part in a row along an axis. The count and the spacing can use variables, such as a number of shelves. */
function LinearPartPatternField({
  pattern,
  document,
  pickDirection,
  pickEdge,
  variables,
  onChange,
  onDone,
  ready,
}: {
  pattern: CadPartPattern | undefined;
  document?: CadDocument;
  pickDirection?: (picked: (on: CadDrawnOn['on']) => void) => void;
  /** Starts picking a part's edge in the view for the direction; the edge comes back once, or null for a click off an edge. */
  pickEdge?: (picked: (edge: { a: Vec3; b: Vec3 } | null) => void) => void;
  variables?: CadValueScope;
  /** The new pattern, or `null` to take it away. */
  onChange: (pattern: Pattern | null) => void;
  onDone?: () => void;
  /** Patterning from the start, as the reference's Linear pattern dialog opens: no checkbox to switch it on first. */
  ready?: boolean;
}) {
  const id = useId();
  // Opened ready, a part without a pattern gets one straight away; the dialog's cancel takes it back off.
  useEffect(() => {
    if (ready && !pattern) onChange(kStart);
    // Only on opening.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const [picking, setPicking] = useState(false);
  const [pickingEdge, setPickingEdge] = useState(false);
  const pickGeneration = useRef(0);
  // A callback from an earlier picker or an unmounted linear field must not replace a newer pattern.
  useEffect(
    () => () => {
      pickGeneration.current++;
    },
    []
  );
  const cancelPick = () => {
    pickGeneration.current++;
    setPicking(false);
    setPickingEdge(false);
  };
  const current = pattern ?? kStart;
  const typedCount = current.countExpression ?? String(current.count),
    typedSpacing = current.spacingExpression ?? formatCadValue(current.spacing);
  const [count, setCount] = useState(typedCount);
  const [spacing, setSpacing] = useState(typedSpacing);
  const [error, setError] = useState<string | null>(null);
  // Only values typed here and not cancelled are saved; anything else, such as undo, shows through.
  const dirty = useRef(false);
  useEffect(() => {
    if (!dirty.current) {
      setCount(typedCount);
      setSpacing(typedSpacing);
      setError(null);
    }
  }, [typedCount, typedSpacing]);
  const apply = (
    axis = current.axis,
    direction: Pattern['direction'] | null = current.direction,
    vector: Vec3 | null = direction ? null : (current.vector ?? null),
    countText = count,
    spacingText = spacing,
    preview = false
  ) => {
    const parsedCount = parseCadValue(countText, { unit: 'scalar', variables });
    if ('error' in parsedCount) {
      if (!preview) setError(parsedCount.error);
      return;
    }
    const n = Math.floor(parsedCount.value + 1e-9);
    if (n < 1 || n > CAD_MAX_PART_PATTERN) {
      if (!preview) setError(`A pattern makes one to ${CAD_MAX_PART_PATTERN}, counting the part itself.`);
      return;
    }
    const parsedSpacing = parseCadValue(spacingText, { unit: 'mm', variables });
    if ('error' in parsedSpacing) {
      if (!preview) setError(parsedSpacing.error);
      return;
    }
    if (!preview) dirty.current = false;
    setError(null);
    const next: Pattern = {
      axis,
      ...(direction && { direction }),
      ...(vector && { vector }),
      count: n,
      spacing: parsedSpacing.value,
      ...(parsedCount.expression && { countExpression: parsedCount.expression }),
      ...(parsedSpacing.expression && { spacingExpression: parsedSpacing.expression }),
    };
    const same =
      pattern &&
      (['axis', 'direction', 'vector', 'count', 'spacing', 'countExpression', 'spacingExpression'] as const).every(
        key => pattern[key] === next[key]
      );
    if (!same) onChange(next);
  };
  // A pick lands after later renders, so it applies with the count and spacing as they are then, not as they were.
  const latestApply = useRef(apply);
  latestApply.current = apply;
  const keys = (event: React.KeyboardEvent) => {
    // In a step's dialog, Enter and Escape go on to the dialog: Enter again accepts it, Escape cancels it.
    const inDialog = !!(event.currentTarget as HTMLElement).closest('.cad-feature-dialog');
    if (!(inDialog && (event.key === 'Enter' || event.key === 'Escape'))) event.stopPropagation();
    if (event.key === 'Enter') {
      apply();
      onDone?.();
    } else if (event.key === 'Escape') {
      cancelPick();
      dirty.current = false;
      setCount(typedCount);
      setSpacing(typedSpacing);
      setError(null);
      onDone?.();
    }
  };
  const edit = (which: 'count' | 'spacing') => (event: React.ChangeEvent<HTMLInputElement>) => {
    dirty.current = true;
    const value = event.target.value;
    if (which === 'count') setCount(value);
    else setSpacing(value);
    if (ready) apply(undefined, undefined, undefined, which === 'count' ? value : count, which === 'spacing' ? value : spacing, true);
  };
  return (
    <div className="cad-part-pattern-field">
      {!ready && (
        <label>
          <input type="checkbox" checked={!!pattern} onChange={event => (event.target.checked ? onChange(kStart) : onChange(null))} />
          Pattern copies in a row
        </label>
      )}
      {pattern && (
        <>
          {pickDirection && (
            <button
              type="button"
              className="cad-feature-selection"
              data-active={picking || !pattern.direction ? '' : undefined}
              aria-label="Direction"
              onClick={() => {
                const generation = ++pickGeneration.current;
                setPicking(true);
                setPickingEdge(false);
                pickDirection(along => {
                  if (generation !== pickGeneration.current) return;
                  pickGeneration.current++;
                  latestApply.current(undefined, { along });
                  setPicking(false);
                });
              }}>
              <small>Direction</small>
              <span>
                {pattern.direction && document
                  ? drawnOnName(document, pattern.direction.along)
                  : pattern.vector
                    ? `Along an edge (${pattern.vector.map(value => +value.toFixed(3)).join(', ')})`
                    : 'Pick a plane or a face'}
              </span>
            </button>
          )}
          {pickEdge && (
            <button
              type="button"
              className="cad-feature-selection"
              data-active={pickingEdge ? '' : undefined}
              aria-label="Direction edge"
              onClick={() => {
                const generation = ++pickGeneration.current;
                setPickingEdge(true);
                setPicking(false);
                setError(null);
                pickEdge(edge => {
                  if (generation !== pickGeneration.current) return;
                  pickGeneration.current++;
                  setPickingEdge(false);
                  if (!edge) return setError('Click close to an edge of a part.');
                  const along = edge.b.map((value, axis) => value - edge.a[axis]!) as Vec3;
                  const length = Math.hypot(...along);
                  latestApply.current(undefined, null, along.map(value => +(value / length).toFixed(9)) as Vec3);
                });
              }}>
              <small>Or along an edge</small>
              <span>{pickingEdge ? 'Click an edge of a part' : 'Pick an edge'}</span>
            </button>
          )}
          {pattern.vector && !pattern.direction ? (
            <div className="cad-feature-selection">
              <button
                type="button"
                onClick={() => {
                  cancelPick();
                  apply(current.axis, null, null);
                }}>
                Clear
              </button>
              {/* The edge's direction turned the other way. */}
              <button
                type="button"
                onClick={() => {
                  cancelPick();
                  apply(current.axis, null, pattern.vector!.map(value => -value || 0) as Vec3);
                }}>
                Flip direction
              </button>
            </div>
          ) : pattern.direction ? (
            <>
              <div className="cad-feature-selection">
                <button
                  type="button"
                  onClick={() => {
                    cancelPick();
                    apply(current.axis, null);
                  }}>
                  Clear
                </button>
              </div>
              <label>
                <input
                  type="checkbox"
                  checked={!!pattern.direction.flip}
                  onChange={event => {
                    cancelPick();
                    apply(current.axis, { ...pattern.direction!, flip: event.target.checked });
                  }}
                />
                Flip direction
              </label>
            </>
          ) : (
            <label htmlFor={`${id}-axis`} className="cad-number-field">
              Along
              <span>
                <select
                  id={`${id}-axis`}
                  value={pattern.axis}
                  onChange={event => {
                    cancelPick();
                    apply(event.target.value as Pattern['axis']);
                  }}>
                  <option value="x">x</option>
                  <option value="y">y</option>
                  <option value="z">z</option>
                </select>
              </span>
            </label>
          )}
          <label htmlFor={`${id}-count`} className="cad-number-field">
            How many
            <span>
              <CadValueInput
                bare
                id={`${id}-count`}
                value={count}
                spellCheck={false}
                aria-invalid={error ? true : undefined}
                onChange={edit('count')}
                onBlur={() => dirty.current && apply()}
                onKeyDown={keys}
              />
            </span>
          </label>
          <label htmlFor={`${id}-spacing`} className="cad-number-field">
            Spacing
            <span>
              <CadValueInput
                bare
                id={`${id}-spacing`}
                value={spacing}
                spellCheck={false}
                aria-invalid={error ? true : undefined}
                onChange={edit('spacing')}
                onBlur={() => dirty.current && apply()}
                onKeyDown={keys}
              />
            </span>
            mm
          </label>
        </>
      )}
      {error && (
        <p role="alert" className="cad-thickness-error">
          {error}
        </p>
      )}
    </div>
  );
}
