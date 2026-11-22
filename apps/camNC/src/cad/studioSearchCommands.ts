import { t as translate } from '@wbcnc/i18n';
import type { SearchCommand } from './CommandSearch';
import type { PartPatternKind } from './partPatternKind';
import { kStudioCommands, type StudioCommand } from './studioCommands';

/** The reference's other plane commands, listed under Plane as not available yet. */
const kOtherPlanes = [
  translate('Plane Normal To Edge'),
  translate('Plane Containing Edges'),
  translate('Offset Planes'),
  translate('Intermediate Planes'),
  translate('Surface Tangent Plane'),
] as const;

export type StudioSearchId = StudioCommand | 'linearPartPattern' | 'circularPartPattern' | `plane:${(typeof kOtherPlanes)[number]}`;
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
        {
          id: 'linearPartPattern',
          label: translate('Linear pattern'),
          description: translate('Copies of the selected part in a row'),
          glyph,
        },
        {
          id: 'circularPartPattern',
          label: translate('Circular pattern'),
          description: translate('Copies of the selected part around an axis'),
          glyph,
        },
      ];
    if (id === 'plane')
      return [
        { id, label, description: hint, glyph },
        ...kOtherPlanes.map(name => ({ id: `plane:${name}` as const, label: name, glyph, unavailable: translate('Not available yet') })),
      ];
    return [{ id, label, description: hint, glyph }];
  });
}
