import type { CadDocument, CadDrawnOn, CadPart, CadValueScope } from '@wbcnc/cad';
import { useEffect, useId, useRef, useState } from 'react';
import { drawnOnName } from './drawnOnName';
import { formatCadValue, parseCadValue } from './valueExpressions';
import './cadThicknessField.css';
import { CadValueInput } from './CadValueInput';

/** Where a drawn part starts from its plane or face, and which way it grows. The offset can use variables. */
export function CadDrawnOnField({
  document,
  part,
  variables,
  onChange,
  onDone,
  inwardToggle = true,
  livePreview = false,
}: {
  /** Whether it offers growing into the face, which the Extrude dialog's flip does instead. */
  inwardToggle?: boolean;
  livePreview?: boolean;
  document: CadDocument;
  part: CadPart & { drawnOn: CadDrawnOn };
  variables?: CadValueScope;
  onChange: (drawnOn: CadDrawnOn) => void;
  onDone?: () => void;
}) {
  const id = useId();
  const typed = part.drawnOn.offsetExpression ?? formatCadValue(part.drawnOn.offset);
  const [text, setText] = useState(typed);
  const [error, setError] = useState<string | null>(null);
  const dirty = useRef(false);
  useEffect(() => {
    if (!dirty.current) {
      setText(typed);
      setError(null);
    }
  }, [typed]);
  const apply = (value = text, preview = false) => {
    const parsed = parseCadValue(value, { unit: 'mm', variables });
    if ('error' in parsed) {
      if (!preview) setError(parsed.error);
      return;
    }
    if (!preview) dirty.current = false;
    setError(null);
    if (parsed.value !== part.drawnOn.offset || parsed.expression !== part.drawnOn.offsetExpression) {
      const next: CadDrawnOn = { ...part.drawnOn, offset: parsed.value, offsetExpression: parsed.expression };
      if (!parsed.expression) delete next.offsetExpression;
      onChange(next);
    }
  };
  return (
    <div className="cad-drawn-on-field">
      <p className="cad-thickness-hint">Drawn on {drawnOnName(document, part.drawnOn.on)}.</p>
      <label htmlFor={id} className="cad-number-field">
        Offset
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
              if (livePreview) apply(event.target.value, true);
            }}
            onBlur={() => {
              if (dirty.current) apply();
            }}
            onKeyDown={event => {
              // In a step's dialog, Enter and Escape go on to the dialog: Enter again accepts it, Escape cancels it.
              const inDialog = !!event.currentTarget.closest('.cad-feature-dialog');
              if (!(inDialog && (event.key === 'Enter' || event.key === 'Escape'))) event.stopPropagation();
              if (event.key === 'Enter') {
                apply();
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
        mm
      </label>
      {inwardToggle && (
        <label>
          <input
            type="checkbox"
            checked={!!part.drawnOn.inward}
            onChange={event => {
              const next: CadDrawnOn = { ...part.drawnOn, inward: true };
              if (!event.target.checked) delete next.inward;
              onChange(next);
            }}
          />
          Grows into the face
        </label>
      )}
      {error && (
        <p id={`${id}-error`} role="alert" className="cad-thickness-error">
          {error}
        </p>
      )}
    </div>
  );
}
