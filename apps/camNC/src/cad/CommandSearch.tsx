import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { SketchToolGlyph } from './SketchToolbar';
import type { SketchToolDefinition } from './sketchTools';
import type { ConstraintCommandTool } from '@wbcnc/cad-editor/constraintCommands';
import type { StudioCommand } from './studioCommands';
import './commandSearch.css';

export type SearchCommand = Omit<SketchToolDefinition, 'id'> & {
  id: SketchToolDefinition['id'] | ConstraintCommandTool | StudioCommand | 'construction' | 'fix' | 'fit';
  description?: string;
  /** The command's own icon, for one that isn't a sketch tool. */
  glyph?: ReactNode;
};

/** Nonmodal tool search keeps the drawing available and closes on outside click or Escape. */
export function CommandSearch({
  commands,
  onChoose,
  onClose,
  onHighlight,
}: {
  commands: readonly SearchCommand[];
  onChoose: (command: SearchCommand['id']) => void;
  onClose: (restoreFocus?: boolean) => void;
  onHighlight: (command: SearchCommand['id'] | null) => void;
}) {
  const panel = useRef<HTMLDivElement>(null),
    input = useRef<HTMLInputElement>(null);
  const id = useId();
  const [query, setQuery] = useState(''),
    [index, setIndex] = useState(0),
    [highlight, setHighlight] = useState(true);
  const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const matches = words.length ? commands.filter(command => words.every(word => command.label.toLowerCase().includes(word))) : [];
  const active = matches[Math.min(index, matches.length - 1)];
  useEffect(() => {
    panel.current?.showPopover();
    input.current?.focus();
  }, []);
  useEffect(() => {
    onHighlight(highlight ? (active?.id ?? null) : null);
    return () => onHighlight(null);
  }, [active?.id, highlight, onHighlight]);
  return (
    <div
      ref={panel}
      popover="auto"
      className="cad-command-palette"
      aria-label="Search tools"
      onToggle={event => {
        if (event.newState === 'closed') onClose(false);
      }}
      onKeyDown={event => {
        event.stopPropagation();
        if (event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229) return;
        if (event.key === 'Escape') {
          event.preventDefault();
          onClose();
        } else if (event.altKey && event.code === 'KeyC') {
          event.preventDefault();
          onClose();
        } else if (
          (event.key === 'ArrowDown' || event.key === 'ArrowUp') &&
          (event.target === input.current || (event.target instanceof HTMLElement && event.target.getAttribute('role') === 'option'))
        ) {
          event.preventDefault();
          if (matches.length) {
            const next = (Math.min(index, matches.length - 1) + (event.key === 'ArrowDown' ? 1 : -1) + matches.length) % matches.length;
            setIndex(next);
            if (event.target !== input.current) panel.current?.querySelectorAll<HTMLButtonElement>('[role="option"]')[next]?.focus();
          }
        } else if (event.key === 'Enter' && event.target === input.current && active) {
          event.preventDefault();
          onChoose(active.id);
        }
      }}>
      <div className="cad-command-search-heading">
        <input
          ref={input}
          type="search"
          aria-label="Search tools"
          placeholder="Search tools…"
          value={query}
          role="combobox"
          aria-autocomplete="list"
          aria-expanded={matches.length > 0}
          aria-controls={matches.length ? `${id}-results` : undefined}
          aria-activedescendant={active ? `${id}-${active.id}` : undefined}
          onChange={event => {
            setQuery(event.target.value);
            setIndex(0);
          }}
        />
        <button type="button" aria-label="Close search" onClick={() => onClose()}>
          ×
        </button>
      </div>
      {!words.length ? (
        <p>Start typing to search tools</p>
      ) : !matches.length ? (
        <p role="status">No tools found</p>
      ) : (
        <>
          <div id={`${id}-results`} role="listbox" aria-label="Tools" className="cad-command-results">
            {matches.map(command => (
              <button
                key={command.id}
                id={`${id}-${command.id}`}
                type="button"
                role="option"
                aria-selected={command.id === active?.id}
                onFocus={() => setIndex(matches.indexOf(command))}
                onPointerMove={event => {
                  setIndex(matches.indexOf(command));
                  if (event.currentTarget.parentElement?.contains(document.activeElement)) event.currentTarget.focus();
                }}
                onClick={() => onChoose(command.id)}>
                {command.glyph ? (
                  <svg viewBox="0 0 24 24" aria-hidden="true">
                    {command.glyph}
                  </svg>
                ) : (
                  command.id !== 'fit' && <SketchToolGlyph kind={command.id as SketchToolDefinition['id']} />
                )}
                <span>{command.label}</span>
                <kbd>{command.key}</kbd>
              </button>
            ))}
          </div>
          <div className="cad-command-description">
            <strong>{active?.label}</strong>
            <p>{active?.description ?? `Activate ${active?.label.toLowerCase()}.`}</p>
          </div>
        </>
      )}
      <p>
        Return to this dialog at any time by pressing <kbd>alt/⌥ C</kbd>
      </p>
      <label>
        <input type="checkbox" checked={highlight} onChange={event => setHighlight(event.target.checked)} /> Highlight tool in toolbar
      </label>
    </div>
  );
}
