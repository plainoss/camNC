import { CAD_THICKNESS_RANGE, type CadValueScope } from '@wbcnc/cad';
import { useEffect, useId, useRef, useState } from 'react';
import { parseCadValue } from './valueExpressions';
import { CadValueInput } from './CadValueInput';
import './cadThicknessField.css';

export interface CadThicknessFieldProps {
  value: number;
  /** The thickness as typed, shown in place of the value. */
  expression?: string;
  variables?: CadValueScope;
  onCommit: (value: number, expression?: string) => void;
  onDone?: () => void;
  onValidityChange?: (valid: boolean) => void;
}

const rangeError = `Thickness must be between ${CAD_THICKNESS_RANGE.min} and ${CAD_THICKNESS_RANGE.max} mm.`;
function thicknessValue(text: string, variables?: CadValueScope): { value: number; expression?: string } | { error: string } {
  const parsed = parseCadValue(text, { unit: 'mm', variables });
  if ('error' in parsed) return parsed;
  return parsed.value >= CAD_THICKNESS_RANGE.min && parsed.value <= CAD_THICKNESS_RANGE.max ? parsed : { error: rangeError };
}

/** Invalid drafts stay visible until corrected or explicitly canceled; blur never moves focus. */
export function CadThicknessField({ value, expression, variables, onCommit, onDone, onValidityChange }: CadThicknessFieldProps) {
  const id = useId();
  const typed = expression ?? String(value);
  const [text, setText] = useState(typed);
  const [error, setError] = useState<string | null>(null);
  const dirty = useRef(false);
  const previousValue = useRef(typed);
  const validityCallback = useRef(onValidityChange);
  const lastValidity = useRef<boolean | undefined>(undefined);
  const valid = !('error' in thicknessValue(text, variables));
  useEffect(() => {
    validityCallback.current = onValidityChange;
    if (lastValidity.current !== valid) {
      lastValidity.current = valid;
      onValidityChange?.(valid);
    }
  }, [valid, onValidityChange]);
  useEffect(
    () => () => {
      validityCallback.current?.(true);
    },
    []
  );
  useEffect(() => {
    if (previousValue.current === typed) return;
    previousValue.current = typed;
    if (!dirty.current) {
      setText(typed);
      setError(null);
    }
  }, [typed]);

  const commit = () => {
    const parsed = thicknessValue(text, variables);
    if ('error' in parsed) {
      setError(parsed.error);
      return false;
    }
    dirty.current = false;
    setText(parsed.expression ?? String(parsed.value));
    setError(null);
    if (parsed.value !== value || parsed.expression !== expression) onCommit(parsed.value, parsed.expression);
    return true;
  };

  return (
    <div className="cad-thickness-field">
      <label className="cad-number-field" htmlFor={id}>
        Thickness
        <span>
          <CadValueInput
            id={id}
            type="text"
            inputMode="decimal"
            value={text}
            aria-invalid={error ? true : undefined}
            aria-describedby={`${id}-hint${error ? ` ${id}-error` : ''}`}
            onChange={event => {
              const next = event.target.value;
              dirty.current = true;
              setText(next);
              if (error) {
                const parsed = thicknessValue(next, variables);
                setError('error' in parsed ? parsed.error : null);
              }
            }}
            onBlur={() => {
              if (dirty.current) commit();
            }}
            onKeyDown={event => {
              event.stopPropagation();
              if (event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229) return;
              if (event.key === 'Enter') {
                event.preventDefault();
                if (commit()) {
                  event.currentTarget.blur();
                  onDone?.();
                }
              } else if (event.key === 'Escape') {
                event.preventDefault();
                dirty.current = false;
                setText(typed);
                setError(null);
                event.currentTarget.blur();
                onDone?.();
              }
            }}
          />
        </span>
      </label>
      <p id={`${id}-hint`} className="cad-thickness-hint">
        0.1–300 mm. Units, arithmetic and variables accepted.
      </p>
      {error && (
        <p id={`${id}-error`} role="alert" className="cad-thickness-error">
          {error}
        </p>
      )}
    </div>
  );
}
