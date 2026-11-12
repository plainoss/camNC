import type { StudioCommand } from './studioCommands';

const dialogs = [
  ['choosingFace', 'sketch'],
  ['partCutting', 'cutParts'],
  ['variableDialog', 'variable'],
  ['mirrorDialog', 'mirror'],
  ['planeDialog', 'plane'],
  ['transformDialog', 'transform'],
] as const;

/** Preserve dialog precedence independently of the temporary command-search highlight. */
export function studioToolbarActive(
  open: Partial<Record<(typeof dialogs)[number][0], unknown>>,
  feature?: StudioCommand
): StudioCommand | null {
  return dialogs.find(([state]) => open[state])?.[1] ?? feature ?? null;
}
