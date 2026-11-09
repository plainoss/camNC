import { activeDesign, consumedTools, isCadPart, type CadDocument, type CadPart } from '@wbcnc/cad';

/** Physical parts in the studio: suppressed copies and consumed tools retain source settings but have no visible row. */
export function builtStudioParts(document: CadDocument): CadPart[] {
  const active = activeDesign(document),
    consumed = consumedTools(active);
  // An Extrude Add body is listed under its host part, rather than as another part.
  return active.parts.filter(part => isCadPart(part) && !consumed.has(part.id));
}
