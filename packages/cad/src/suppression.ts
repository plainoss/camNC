import type { CadDocument, CadPart } from './types';

/**
 * The design as it's built, with what's suppressed in the feature list left out: a suppressed extrude leaves its part a
 * sketch, a suppressed transform or pattern makes no copies, and a suppressed cut-parts step cuts nothing. Everything
 * keeps its settings for when it's switched back on.
 */
export function activeDesign(document: CadDocument): CadDocument {
  const suppressedSomething =
    document.partCuts?.some(step => step.suppressed) ||
    document.parts.some(part => part.suppressed || part.pattern?.suppressed || part.copies?.some(copy => copy.suppressed));
  if (!suppressedSomething) return document;
  const parts = document.parts.map((part): CadPart => {
    const next: CadPart = part.suppressed ? { ...part, extrude: false } : { ...part };
    if (part.pattern?.suppressed) delete next.pattern;
    const copies = (part.copies ?? []).filter(copy => !copy.suppressed && !(copy.pattern && part.pattern?.suppressed));
    if (copies.length) next.copies = copies;
    else delete next.copies;
    return next;
  });
  const partCuts = (document.partCuts ?? []).filter(step => !step.suppressed);
  const next: CadDocument = { ...document, parts };
  if (partCuts.length) next.partCuts = partCuts;
  else delete next.partCuts;
  return next;
}
