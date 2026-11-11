import { activeDesign, consumedTools, isCadPart, type CadDocument, type CadPart } from '@wbcnc/cad';
import { isBlank } from './editorHelpers';

/** Physical parts in the studio: suppressed copies and consumed tools retain source settings but have no visible row. */
export function builtStudioParts(document: CadDocument): CadPart[] {
  const active = activeDesign(document),
    consumed = consumedTools(active);
  // An Extrude Add body is listed under its host part, rather than as another part.
  return active.parts.filter(part => isCadPart(part) && !consumed.has(part.id));
}

/** The parts the studio's Parts list shows: a new design's untouched placeholder Part 1 is not one yet. */
export function listedStudioParts(document: CadDocument): CadPart[] {
  return document.parts.length === 1 && isBlank(document.parts[0]!) ? [] : builtStudioParts(document);
}

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
  };
  // A mirror image is of a part, as a pattern is.
  if (studioDisabled.pattern) studioDisabled.mirror = studioDisabled.pattern;
  return studioDisabled;
}
