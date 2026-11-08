import { CAD_MAX_PART_PATTERN, type CadPartPattern, type CadValueScope } from '@wbcnc/cad';
import { useEffect, useId, useRef, useState } from 'react';
import { formatCadValue, parseCadValue } from './valueExpressions';
import './cadThicknessField.css';

type Pattern = Omit<CadPartPattern, 'id'>;
const kStart: Pattern = { axis: 'x', count: 2, spacing: 100 };

/** Copies of a part in a row along an axis. The count and the spacing can use variables, such as a number of shelves. */
export function CadPartPatternField({
  pattern,
  variables,
  onChange,
  onDone,
}: {
  pattern: CadPartPattern | undefined;
  variables?: CadValueScope;
  /** The new pattern, or `null` to take it away. */
  onChange: (pattern: Pattern | null) => void;
  onDone?: () => void;
}) {
  const id = useId();
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
  const apply = (axis = current.axis) => {
    const parsedCount = parseCadValue(count, { unit: 'scalar', variables });
    if ('error' in parsedCount) return setError(parsedCount.error);
    const n = Math.floor(parsedCount.value + 1e-9);
    if (n < 1 || n > CAD_MAX_PART_PATTERN) return setError(`A pattern makes one to ${CAD_MAX_PART_PATTERN}, counting the part itself.`);
    const parsedSpacing = parseCadValue(spacing, { unit: 'mm', variables });
    if ('error' in parsedSpacing) return setError(parsedSpacing.error);
    dirty.current = false;
    setError(null);
    const next: Pattern = {
      axis,
      count: n,
      spacing: parsedSpacing.value,
      ...(parsedCount.expression && { countExpression: parsedCount.expression }),
      ...(parsedSpacing.expression && { spacingExpression: parsedSpacing.expression }),
    };
    const same =
      pattern && (['axis', 'count', 'spacing', 'countExpression', 'spacingExpression'] as const).every(key => pattern[key] === next[key]);
    if (!same) onChange(next);
  };
  const keys = (event: React.KeyboardEvent) => {
    event.stopPropagation();
    if (event.key === 'Enter') {
      apply();
      onDone?.();
    } else if (event.key === 'Escape') {
      dirty.current = false;
      setCount(typedCount);
      setSpacing(typedSpacing);
      setError(null);
      onDone?.();
    }
  };
  const edit = (set: (value: string) => void) => (event: React.ChangeEvent<HTMLInputElement>) => {
    dirty.current = true;
    set(event.target.value);
  };
  return (
    <div className="cad-part-pattern-field">
      <label>
        <input type="checkbox" checked={!!pattern} onChange={event => (event.target.checked ? onChange(kStart) : onChange(null))} />
        Pattern copies in a row
      </label>
      {pattern && (
        <>
          <label htmlFor={`${id}-axis`} className="cad-number-field">
            Along
            <span>
              <select id={`${id}-axis`} value={pattern.axis} onChange={event => apply(event.target.value as Pattern['axis'])}>
                <option value="x">x</option>
                <option value="y">y</option>
                <option value="z">z</option>
              </select>
            </span>
          </label>
          <label htmlFor={`${id}-count`} className="cad-number-field">
            How many
            <span>
              <input
                id={`${id}-count`}
                value={count}
                spellCheck={false}
                aria-invalid={error ? true : undefined}
                onChange={edit(setCount)}
                onBlur={() => dirty.current && apply()}
                onKeyDown={keys}
              />
            </span>
          </label>
          <label htmlFor={`${id}-spacing`} className="cad-number-field">
            Spacing
            <span>
              <input
                id={`${id}-spacing`}
                value={spacing}
                spellCheck={false}
                aria-invalid={error ? true : undefined}
                onChange={edit(setSpacing)}
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
