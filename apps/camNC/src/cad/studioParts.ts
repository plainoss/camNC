import { activeDesign, consumedTools, isCadPart, unionOf, type CadDocument, type CadPart } from '@wbcnc/cad';
import { isBlank } from './editorHelpers';
import type { StudioDialog } from './studioDialog';
import { unpickedExtrudePreview } from './unpickedExtrude';

/** Physical parts in the studio: suppressed copies and consumed tools retain source settings but have no visible row. */
export function builtStudioParts(document: CadDocument): CadPart[] {
  const active = activeDesign(document),
    consumed = consumedTools(active);
  // An Extrude Add body is listed under its host part, rather than as another part.
  return active.parts.filter(part => isCadPart(part) && !consumed.has(part.id));
}

/**
 * The parts the studio's Parts list shows: a new design's untouched placeholder Part 1 is not one yet, nor is the part
 * of an open Extrude with no region picked.
 */
export function listedStudioParts(document: CadDocument, dialog?: StudioDialog | null): CadPart[] {
  if (isBlankDesign(document)) return [];
  const built = builtStudioParts(unpickedExtrudePreview(document, dialog?.kind === 'extrude' ? dialog.partId : null));
  // A Boolean › Union's part is as thick as the part it makes, once it can join them.
  const joined = new Map<string, number>();
  const active = activeDesign(document);
  for (const step of active.partCuts ?? []) {
    const made = step.operation === 'union' ? unionOf(active, step) : null;
    if (made && 'part' in made) joined.set(made.part.partId, made.part.thickness);
  }
  return joined.size ? built.map(part => (joined.has(part.id) ? { ...part, thickness: joined.get(part.id)! } : part)) : built;
}

/** A new design, untouched: its only part is the placeholder sketch with nothing drawn yet. */
export const isBlankDesign = (document: CadDocument) => document.parts.length === 1 && isBlank(document.parts[0]!);

import type { StudioCommand } from './StudioToolbar';

export function disabledStudioCommands(part: CadPart | undefined, partHasOutline: boolean, partCount: number) {
  const studioDisabled: Partial<Record<StudioCommand, string>> = {
    // A sketch not yet extruded can be extruded; patterns and transforms need a part.
    ...(part?.extrude === false
      ? { pattern: 'Extrude the sketch first', transform: 'Extrude the sketch first' }
      : part && !isCadPart(part)
        ? { pattern: 'Select a part first', transform: 'Select a part first' }
        : !partHasOutline && { extrude: 'Select a part first', pattern: 'Select a part first', transform: 'Select a part first' }),
    ...(partCount < 2 && { cutParts: 'Cutting parts needs two parts' }),
    ...(partCount < 2 && { boolean: 'A Boolean needs two parts' }),
    ...(partCount < 1 && { linearPattern: 'A pattern needs a part' }),
  };
  // A mirror image is of a part, as a pattern is.
  if (studioDisabled.pattern) studioDisabled.mirror = studioDisabled.pattern;
  return studioDisabled;
}
