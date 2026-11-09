import { SketchToolGlyph, ToolHint } from './SketchToolbar';
import { kStudioCommands, type StudioCommand } from './studioCommands';

export type { StudioCommand };

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
  onSearch,
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
  /** Opens the search of these commands, as Alt+C does. */
  onSearch?: () => void;
}) {
  return (
    <header
      className="cad-toolbar cad-studio-toolbar"
      role="toolbar"
      aria-label="Part Studio toolbar"
      title="Views: Shift+1 Front, Shift+2 Back, Shift+3 Left, Shift+4 Right, Shift+5 Top, Shift+6 Bottom, Shift+7 Isometric. F fits the model. P toggles base planes. Y hides the part under the pointer, Shift+T toggles transparency, Shift+Y shows all, Shift+I isolates the selected part.">
      <div className="cad-tool-group" role="group" aria-label="Part Studio features" inert={busy}>
        {kStudioCommands.map(command => (
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
      {onSearch && (
        <button type="button" className="cad-search-trigger" disabled={busy} onClick={onSearch} aria-keyshortcuts="Alt+C">
          Search tools… <kbd>alt/⌥ C</kbd>
        </button>
      )}
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
