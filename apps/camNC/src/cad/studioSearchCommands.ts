import type { SearchCommand } from './CommandSearch';
import type { PartPatternKind } from './partPatternKind';
import { kStudioCommands, type StudioCommand } from './studioCommands';

export type StudioSearchId = StudioCommand | 'linearPartPattern' | 'circularPartPattern';
interface Selection {
  command: StudioCommand;
  initialPatternKind?: PartPatternKind;
}

export function resolveStudioSearchCommand(id: SearchCommand['id']): Selection | undefined {
  if (id === 'linearPartPattern') return { command: 'pattern', initialPatternKind: 'linear' };
  if (id === 'circularPartPattern') return { command: 'pattern', initialPatternKind: 'circular' };
  const command = kStudioCommands.find(command => command.id === id);
  return command && { command: command.id };
}

export function studioSearchCommands(disabled: Partial<Record<StudioCommand, string>>): SearchCommand[] {
  return kStudioCommands.flatMap<SearchCommand>(({ id, label, hint, glyph }) => {
    // Search lists Linear pattern under Pattern, where both open the same dialog.
    if (disabled[id] || id === 'linearPattern') return [];
    if (id === 'pattern')
      return [
        { id: 'linearPartPattern', label: 'Linear pattern', description: 'Copies of the selected part in a row', glyph },
        { id: 'circularPartPattern', label: 'Circular pattern', description: 'Copies of the selected part around an axis', glyph },
      ];
    return [{ id, label, description: hint, glyph }];
  });
}
