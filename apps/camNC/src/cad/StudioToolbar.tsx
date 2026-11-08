import type { ReactNode } from 'react';
import { SketchToolGlyph, ToolHint } from './SketchToolbar';

export type StudioCommand = 'sketch' | 'extrude' | 'cutParts' | 'transform' | 'pattern' | 'variable';

const kCommands: { id: StudioCommand; label: string; hint: string; glyph: ReactNode }[] = [
  {
    id: 'sketch',
    label: 'Sketch',
    hint: 'Sketch a new part on a plane or on a part’s face',
    glyph: <path d="M4 20h4L19 9l-4-4L4 16zM13.5 6.5l4 4" />,
  },
  {
    id: 'extrude',
    label: 'Extrude',
    hint: 'How thick the selected part is, where it starts and which way it grows',
    glyph: <path d="M5 15h9v5H5zM5 15l4-4h9l-4 4M18 11v5l-4 4M9 11V4M7 6l2-2 2 2" />,
  },
  {
    id: 'cutParts',
    label: 'Cut parts',
    hint: 'Cut parts out of the parts they reach into, with a clearance',
    glyph: <path d="M3 9h18v9H3zM9 9V4h6v5M8 9v4h8V9" />,
  },
  {
    id: 'transform',
    label: 'Transform',
    hint: 'A copy of the selected part, moved along X, Y and Z',
    glyph: <path d="M4 14h8v6H4zM12 4h8v6h-8zM8 14V9h4M16 10v5h-4M10 7l2 2-2 2" />,
  },
  {
    id: 'pattern',
    label: 'Pattern',
    hint: 'Copies of the selected part in a row',
    glyph: <path d="M3 8h4v8H3zM10 8h4v8h-4zM17 8h4v8h-4z" />,
  },
  {
    id: 'variable',
    label: 'Variable',
    hint: 'A named size, such as the board thickness, that any value can use',
    glyph: <path d="M8 5C5 8 5 16 8 19M16 5c3 3 3 11 0 14M10 9l4 6M14 9l-4 6" />,
  },
];

/**
 * The studio's commands, which each open a step's dialog over the view, then undo, redo, and leaving the design. While
 * a sketch is open the sketch toolbar takes its place.
 */
export function StudioToolbar({
  busy,
  disabled,
  active,
  canUndo,
  canRedo,
  onCommand,
  onUndo,
  onRedo,
  onCancel,
  onFinish,
  canFinish,
}: {
  busy: boolean;
  /** Commands that need something first, such as a selected part, with why. */
  disabled: Partial<Record<StudioCommand, string>>;
  active: StudioCommand | null;
  canUndo: boolean;
  canRedo: boolean;
  canFinish: boolean;
  onCommand: (command: StudioCommand) => void;
  onUndo: () => void;
  onRedo: () => void;
  onCancel: () => void;
  onFinish: () => void;
}) {
  return (
    <header className="cad-toolbar cad-studio-toolbar" role="toolbar" aria-label="Part Studio toolbar">
      <div className="cad-tool-group" role="group" aria-label="Part Studio features" inert={busy}>
        {kCommands.map(command => (
          <ToolHint key={command.id} label={disabled[command.id] ?? command.hint}>
            <button
              type="button"
              className="cad-studio-command"
              aria-pressed={active === command.id}
              aria-disabled={disabled[command.id] ? true : undefined}
              onClick={() => !disabled[command.id] && onCommand(command.id)}>
              <svg viewBox="0 0 24 24" aria-hidden="true">
                {command.glyph}
              </svg>
              {command.label}
            </button>
          </ToolHint>
        ))}
      </div>
      <div className="cad-tool-group cad-session-actions" aria-label="Design actions" role="group">
        <ToolHint label="Undo (Ctrl or Command Z)">
          <button
            type="button"
            className="cad-icon-button"
            aria-label="Undo (Ctrl or Command Z)"
            disabled={!canUndo || busy}
            onClick={onUndo}>
            <SketchToolGlyph kind="undo" />
          </button>
        </ToolHint>
        <ToolHint label="Redo (Ctrl or Command Shift Z)">
          <button
            type="button"
            className="cad-icon-button"
            aria-label="Redo (Ctrl or Command Shift Z)"
            disabled={!canRedo || busy}
            onClick={onRedo}>
            <SketchToolGlyph kind="redo" />
          </button>
        </ToolHint>
        <span className="cad-toolbar-divider" aria-hidden="true" />
        <ToolHint label="Leave the design without these changes">
          <button type="button" className="cad-icon-button cad-cancel" aria-label="Cancel" disabled={busy} onClick={onCancel}>
            <SketchToolGlyph kind="cancel" />
          </button>
        </ToolHint>
        <ToolHint label="Keep the design and lay its parts out on boards">
          <button type="button" className="cad-studio-done cad-finish" disabled={busy || !canFinish} onClick={onFinish}>
            <SketchToolGlyph kind="finish" />
            Done
          </button>
        </ToolHint>
      </div>
    </header>
  );
}
