import { useEffect, useRef, useState, type RefObject } from 'react';
import { editable } from './editorHelpers';
import { FeatureDialog } from './FeatureDialog';
import { fieldsSettled } from './variableFields';

function secondaryInteraction(host: HTMLElement, target = host.ownerDocument.activeElement): boolean {
  return (
    !!host.querySelector(
      '[popover]:popover-open, [aria-modal="true"], dialog[open], [role="menu"], [role="dialog"]:not(.cad-sketch-dialog)'
    ) || !!target?.closest('[role="menu"], [role="listbox"], dialog[open], [role="dialog"]:not(.cad-sketch-dialog)')
  );
}

/** Ctrl/⌘+Enter confirms the sketch, and Shift+E confirms it into a new Extrude; plain Enter belongs to drawing tools and value editors. */
function confirmIntent(event: KeyboardEvent): 'confirm' | 'extrude' | null {
  if (event.defaultPrevented || event.altKey || event.repeat || event.isComposing || event.keyCode === 229) return null;
  if (event.key === 'Enter' && (event.ctrlKey || event.metaKey) && !event.shiftKey) return 'confirm';
  // Shift+E is still a letter in a value being typed.
  if (event.shiftKey && !event.ctrlKey && !event.metaKey && event.key.toLowerCase() === 'e' && !editable(event.target)) return 'extrude';
  return null;
}

export function StudioSketchDialog({
  editor,
  title,
  plane,
  disabled,
  checking,
  reason,
  showConstraints,
  onShowConstraints,
  canConfirm = () => true,
  onConfirm,
  onExtrude = onConfirm,
  onCancel,
}: {
  editor: RefObject<HTMLDivElement | null>;
  title: string;
  plane: string;
  disabled: boolean;
  checking: boolean;
  reason: string | null;
  showConstraints: boolean;
  onShowConstraints: (show: boolean) => void;
  canConfirm?: () => boolean;
  onConfirm: () => void;
  onExtrude?: () => void;
  onCancel: () => void;
}) {
  const latest = useRef({ disabled, canConfirm });
  latest.current = { disabled, canConfirm };
  const confirming = useRef(false);
  const [ready, setReady] = useState<'confirm' | 'extrude' | false>(false);
  useEffect(() => {
    if (!ready || checking) return;
    setReady(false);
    confirming.current = false;
    // A new variable may start a sketch check on blur. Wait for that check, but discard a permanently invalid request.
    if (!disabled && canConfirm() && editor.current && !secondaryInteraction(editor.current))
      (ready === 'extrude' ? onExtrude : onConfirm)();
  }, [ready, checking, disabled, canConfirm, onConfirm, onExtrude, editor]);
  useEffect(() => {
    const host = editor.current;
    if (!host) return;
    let mounted = true;
    const keyDown = (event: KeyboardEvent) => {
      const intent = confirmIntent(event);
      if (!intent) return;
      // Search and secondary dialogs own their keys; confirming a sketch must not dismiss an unfinished interaction.
      if (secondaryInteraction(host, event.target instanceof Element ? event.target : undefined)) return;
      event.preventDefault();
      event.stopPropagation();
      if (latest.current.disabled || confirming.current || !latest.current.canConfirm()) return;
      confirming.current = true;
      const focused = host.ownerDocument.activeElement;
      if (focused instanceof HTMLInputElement || focused instanceof HTMLTextAreaElement || focused instanceof HTMLSelectElement)
        focused.blur();
      // A pending variable field may become invalid on blur. Recheck after its validation, as the green check does.
      void fieldsSettled().then(() => {
        if (mounted && host.isConnected) setReady(intent);
      });
    };
    // Capture also reaches focused sketch fields and the Show constraints checkbox without taking their focus.
    host.addEventListener('keydown', keyDown, true);
    return () => {
      mounted = false;
      host.removeEventListener('keydown', keyDown, true);
    };
  }, [editor]);
  return (
    <FeatureDialog
      title={title}
      okLabel="✓ Finish sketch"
      okDisabled={disabled}
      okReason={reason}
      okShortcut={{ keys: 'Control+Enter Meta+Enter', label: 'Ctrl/⌘+Enter' }}
      onOk={() => {
        if (canConfirm()) onConfirm();
      }}
      onCancel={onCancel}
      autoFocus={false}
      className="cad-sketch-dialog">
      <div className="cad-feature-selection">
        <small>Sketch plane</small>
        <span>{plane}</span>
      </div>
      <label>
        <input type="checkbox" checked={showConstraints} onChange={event => onShowConstraints(event.target.checked)} />
        Show constraints
      </label>
    </FeatureDialog>
  );
}
