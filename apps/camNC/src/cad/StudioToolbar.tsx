import type { ReactNode } from 'react';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@wbcnc/ui/components/dropdown-menu';
import { SketchToolGlyph, ToolHint } from './SketchToolbar';
import { kStudioCommands, type StudioCommand } from './studioCommands';
import { useToolbarOverflow } from './useToolbarOverflow';
import './studioToolbar.css';

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
  children,
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
  children?: ReactNode;
}) {
  const overflow = useToolbarOverflow<HTMLDivElement, HTMLDivElement>(kStudioCommands.length);
  const shown = kStudioCommands.slice(0, overflow.visible);
  const hidden = kStudioCommands.slice(overflow.visible);
  return (
    <header
      className="cad-toolbar cad-studio-toolbar"
      role="toolbar"
      aria-label="Part Studio toolbar"
      title="Views: Shift+1 Front, Shift+2 Back, Shift+3 Left, Shift+4 Right, Shift+5 Top, Shift+6 Bottom, Shift+7 Isometric. F fits the model. P toggles base planes. Y hides the part under the pointer, Shift+T toggles transparency, Shift+Y shows all, Shift+I isolates the selected part.">
      {/* What every command and the More control take, measured even while they are in the menu. */}
      <div className="cad-studio-command-sizes" aria-hidden="true" inert>
        <div ref={overflow.measureRef}>
          {kStudioCommands.map(command => (
            <button key={command.id} type="button" tabIndex={-1} className="cad-studio-command">
              <StudioCommandGlyph command={command} />
              {command.label}
            </button>
          ))}
          <button type="button" tabIndex={-1} className="cad-studio-command cad-studio-more">
            More
            <MoreGlyph />
          </button>
        </div>
      </div>
      {/* Commands that do not fit move into a More menu, so they cannot widen the mobile viewport or push Done off screen. */}
      <div
        ref={overflow.ref}
        className="cad-tool-group cad-drawing-tools cad-studio-commands"
        role="group"
        aria-label="Part Studio features"
        inert={busy}>
        {shown.map(command => (
          <ToolHint key={command.id} label={disabled[command.id] ?? command.hint}>
            <button
              type="button"
              className="cad-studio-command"
              aria-pressed={active === command.id}
              aria-disabled={disabled[command.id] ? true : undefined}
              onClick={() => !disabled[command.id] && onCommand(command.id)}>
              <StudioCommandGlyph command={command} />
              {command.label}
            </button>
          </ToolHint>
        ))}
        {hidden.length > 0 && (
          <DropdownMenu modal={false}>
            <ToolHint label={`More features: ${hidden.map(command => command.label).join(', ')}`}>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  className="cad-studio-command cad-studio-more"
                  aria-pressed={hidden.some(command => command.id === active) || undefined}>
                  More
                  <MoreGlyph />
                </button>
              </DropdownMenuTrigger>
            </ToolHint>
            <DropdownMenuContent align="end" className="cad-tool-menu cad-studio-more-menu">
              {hidden.map(command => (
                <ToolHint key={command.id} label={disabled[command.id] ?? command.hint}>
                  <DropdownMenuItem
                    aria-disabled={disabled[command.id] ? true : undefined}
                    data-active={active === command.id || undefined}
                    onSelect={event => {
                      // Like its toolbar button, a command that needs something first stays put and keeps its reason.
                      if (disabled[command.id]) event.preventDefault();
                      else onCommand(command.id);
                    }}>
                    <StudioCommandGlyph command={command} />
                    <span>{command.label}</span>
                  </DropdownMenuItem>
                </ToolHint>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>
      {onSearch && (
        <button type="button" className="cad-search-trigger" disabled={busy} onClick={onSearch} aria-keyshortcuts="Alt+C">
          Search tools… <kbd>alt/⌥ C</kbd>
        </button>
      )}
      <div className="cad-tool-group cad-session-actions" aria-label="Design actions" role="group">
        {children}
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

function StudioCommandGlyph({ command }: { command: (typeof kStudioCommands)[number] }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      {command.glyph}
    </svg>
  );
}

function MoreGlyph() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="m7 10 5 5 5-5" />
    </svg>
  );
}
