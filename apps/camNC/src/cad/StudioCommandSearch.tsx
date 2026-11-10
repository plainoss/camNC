import type { RefObject } from 'react';
import { CommandSearch } from './CommandSearch';
import type { PartPatternKind } from './partPatternKind';
import type { StudioCommand } from './studioCommands';
import { resolveStudioSearchCommand, studioSearchCommands } from './studioSearchCommands';

/** Search offers explicit pattern kinds while the toolbar keeps its generic Pattern command. */
export function StudioCommandSearch({
  disabled,
  workspace,
  onOpenChange,
  onCommand,
}: {
  disabled: Partial<Record<StudioCommand, string>>;
  workspace: RefObject<HTMLElement | null>;
  onOpenChange: (open: boolean) => void;
  onCommand: (command: StudioCommand, initialPatternKind?: PartPatternKind) => void;
}) {
  return (
    <CommandSearch
      commands={studioSearchCommands(disabled)}
      onHighlight={() => {}}
      onClose={(restoreFocus = true) => {
        onOpenChange(false);
        if (restoreFocus) workspace.current?.querySelector<HTMLElement>('[data-testid="workspace-3d"]')?.focus();
      }}
      onChoose={id => {
        const selected = resolveStudioSearchCommand(id);
        if (!selected) return;
        onOpenChange(false);
        onCommand(selected.command, selected.initialPatternKind);
      }}
    />
  );
}
