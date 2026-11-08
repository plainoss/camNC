import { useEffect, useRef, type ReactNode } from 'react';
import './featureDialog.css';

/**
 * A design step's settings, over the top left of the 3D view: its name, a green tick to keep them and a red cross to
 * leave them as they were. Changes show in the view as they're made. Enter in a field keeps them, Escape leaves them.
 */
export function FeatureDialog({
  title,
  okLabel = 'OK',
  okDisabled,
  onOk,
  onCancel,
  autoFocus = true,
  className,
  children,
}: {
  title: string;
  okLabel?: string;
  okDisabled?: boolean;
  onOk: () => void;
  onCancel: () => void;
  /** Puts the keyboard in its first field on opening. A sketch's dialog leaves it on the drawing. */
  autoFocus?: boolean;
  className?: string;
  children: ReactNode;
}) {
  const frame = useRef<HTMLDivElement>(null);
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
        // A field applies its value on Enter first, then the dialog is done.
        else if (event.key === 'Enter' && event.target instanceof HTMLInputElement && event.target.type !== 'checkbox' && !okDisabled)
          requestAnimationFrame(onOk);
      }}>
      <div className="cad-feature-dialog-head">
        <h3>{title}</h3>
        <button type="button" className="cad-feature-ok" aria-label={okLabel} title={okLabel} disabled={okDisabled} onClick={onOk}>
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
