import { useDesignUnits } from './designUnits';
import type { CadPart, CadValueScope } from '@wbcnc/cad';
import { useEffect, useId, useRef, useState } from 'react';
import './cadThicknessField.css';
import { CadValueInput } from './CadValueInput';

const kDefaultBit = '6';

/** Bones in a part's inside corners, for the bit it'll be cut with: off, or on for a diameter that can use variables. */
export function CadReliefField({
  relief,
  variables,
  onChange,
  onDone,
}: {
  relief: CadPart['cornerRelief'];
  variables?: CadValueScope;
  onChange: (relief: CadPart['cornerRelief']) => void;
  onDone?: () => void;
}) {
  const { parseCadValue, lengthText, lengthUnit } = useDesignUnits();
  const id = useId();
  const typed = relief ? (relief.diameterExpression ?? lengthText(relief.diameter)) : lengthText(Number(kDefaultBit));
  const [text, setText] = useState(typed);
  const [error, setError] = useState<string | null>(null);
  // Only a size typed here and not cancelled is saved; anything else, such as undo, shows through.
  const dirty = useRef(false);
  useEffect(() => {
    if (!dirty.current) {
      setText(typed);
      setError(null);
    }
  }, [typed]);
  const apply = (on: boolean, value = text) => {
    if (!on) return onChange(undefined);
    const parsed = parseCadValue(value, { unit: 'mm', variables });
    if ('error' in parsed || parsed.value <= 0) {
      setError('error' in parsed ? parsed.error : 'A bit needs to be wider than nothing.');
      return;
    }
    setError(null);
    dirty.current = false;
    if (parsed.value !== relief?.diameter || parsed.expression !== relief?.diameterExpression)
      onChange({ diameter: parsed.value, ...(parsed.expression && { diameterExpression: parsed.expression }) });
  };
  return (
    <div className="cad-relief-field">
      <label>
        <input type="checkbox" checked={!!relief} onChange={event => apply(event.target.checked)} />
        Relieve inside corners
      </label>
      {relief && (
        <label htmlFor={id} className="cad-number-field">
          for a bit of
          <span>
            <CadValueInput
              bare
              id={id}
              value={text}
              spellCheck={false}
              aria-invalid={error ? true : undefined}
              aria-describedby={error ? `${id}-error` : undefined}
              onChange={event => {
                dirty.current = true;
                setText(event.target.value);
              }}
              onBlur={() => {
                if (dirty.current) apply(true);
              }}
              onKeyDown={event => {
                // In a step's dialog, Enter and Escape go on to the dialog: Enter again accepts it, Escape cancels it.
                const inDialog = !!(event.currentTarget as HTMLElement).closest('.cad-feature-dialog');
                if (!(inDialog && (event.key === 'Enter' || event.key === 'Escape'))) event.stopPropagation();
                if (event.key === 'Enter') {
                  apply(true);
                  onDone?.();
                } else if (event.key === 'Escape') {
                  dirty.current = false;
                  setText(typed);
                  setError(null);
                  onDone?.();
                }
              }}
            />
          </span>
          {lengthUnit}
        </label>
      )}
      {error && (
        <p id={`${id}-error`} role="alert" className="cad-thickness-error">
          {error}
        </p>
      )}
      <p className="cad-thickness-hint">Bones let a square part go fully into a corner a round bit cuts.</p>
    </div>
  );
}
