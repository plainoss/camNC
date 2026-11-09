import { useEffect, useRef, useSyncExternalStore, type ReactNode } from 'react';
import { finalPreviewNow, subscribeFinalPreview } from './finalPreview';
import { fieldsSettled } from './variableFields';
import './featureDialog.css';

/**
 * A design step's settings, over the top left of the 3D view: its name, a green tick to keep them and a red cross to
 * leave them as they were. Changes show in the view as they’re made. Enter applies a field, Enter again keeps them, Escape leaves them.
 */
export function FeatureDialog({
  title,
  okLabel = 'OK',
  okDisabled,
  okReason,
  onOk,
  onCancel,
  autoFocus = true,
  className,
  children,
}: {
  title: string;
  okLabel?: string;
  okDisabled?: boolean;
  /** Why OK can't be used yet, shown on it while it's disabled. */
  okReason?: string | null;
  onOk: () => void;
  onCancel: () => void;
  /** Puts the keyboard in its first field on opening. A sketch's dialog leaves it on the drawing. */
  autoFocus?: boolean;
  className?: string;
  children: ReactNode;
}) {
  const frame = useRef<HTMLDivElement>(null);
  const final = useSyncExternalStore(subscribeFinalPreview, finalPreviewNow);
  // The field Enter last applied, and what it held: Enter on it again, unchanged, accepts the dialog.
  const lastEnter = useRef<{ input: HTMLInputElement; value: string } | null>(null);
  // As of the latest render: a field's Enter may have just found its value wrong, which shows a frame later.
  const latest = useRef({ okDisabled, onOk });
  latest.current = { okDisabled, onOk };
  /** Keeps the step once its fields have applied what was typed, such as a variable made in one on leaving it. */
  const ok = () =>
    void fieldsSettled().then(() => {
      if (!latest.current.okDisabled) latest.current.onOk();
    });
  // Opening it puts the keyboard in its first field, as a dialog should.
  useEffect(() => {
    if (autoFocus) frame.current?.querySelector<HTMLElement>('input, select, button:not(.cad-feature-dialog-head button)')?.focus();
    // Only on opening.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return (
    <div
      ref={frame}
      className={className ? `cad-feature-dialog ${className}` : 'cad-feature-dialog'}
      role="dialog"
      aria-label={title}
      onKeyDown={event => {
        const target = event.target as HTMLElement;
        const typing =
          (target instanceof HTMLInputElement && target.type !== 'checkbox') ||
          target instanceof HTMLSelectElement ||
          target instanceof HTMLTextAreaElement;
        // Typing stays in the dialog; any other key, such as a tool's shortcut after ticking a box, reaches the editor.
        if (typing || event.key === 'Escape' || event.key === 'Enter') event.stopPropagation();
        if (event.key === 'Escape') onCancel();
        // Enter applies a field's value and keeps the dialog open; Enter again, with nothing changed, accepts it, as in the
        // reference.
        else if (event.key === 'Enter' && event.target instanceof HTMLInputElement && event.target.type !== 'checkbox') {
          const input = event.target;
          if (lastEnter.current?.input === input && lastEnter.current.value === input.value) {
            lastEnter.current = null;
            requestAnimationFrame(ok);
          } else lastEnter.current = { input, value: input.value };
        }
      }}>
      <div className="cad-feature-dialog-head">
        <h3>{title}</h3>
        {final && (
          <button
            type="button"
            className="cad-feature-final"
            aria-pressed={final.shown}
            title="Show the whole design, with this change, rather than only as far as this step"
            onClick={final.toggle}>
            Final
          </button>
        )}
        <button
          type="button"
          className="cad-feature-ok"
          aria-label={okLabel}
          title={(okDisabled && okReason) || okLabel}
          aria-description={(okDisabled && okReason) || undefined}
          disabled={okDisabled}
          onClick={ok}>
          <svg viewBox="0 0 16 16" aria-hidden="true">
            <path d="M3 8.5 6.5 12 13 4.5" />
          </svg>
        </button>
        <button type="button" className="cad-feature-cancel" aria-label="Cancel" title="Cancel" onClick={onCancel}>
          <svg viewBox="0 0 16 16" aria-hidden="true">
            <path d="M4 4l8 8M12 4l-8 8" />
          </svg>
        </button>
      </div>
      <div className="cad-feature-dialog-body">{children}</div>
    </div>
  );
}
