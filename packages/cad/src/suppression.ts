import { cadCopyName } from './partPatterns';
import { trimCadFolders } from './folderModel';
import { CAD_IDENTITY_PLACEMENT } from './placement';
import type { CadDocument, CadPart } from './types';

/**
 * The design as it's built, with what's suppressed in the feature list left out: a suppressed extrude leaves its part a
 * sketch, a suppressed transform or pattern makes no copies, and a suppressed cut-parts step cuts nothing. Everything
 * keeps its settings for when it's switched back on.
 */
export function activeDesign(document: CadDocument): CadDocument {
  const masked = document.folders?.filter(folder => folder.suppressed) ?? [];
  const folderParts = new Set(masked.flatMap(folder => folder.partIds));
  const folderCuts = new Set(masked.flatMap(folder => folder.partCutIds ?? []));
  const folderPlanes = new Set(masked.flatMap(folder => folder.planeIds ?? []));
  const suppressedPart = (part: CadPart) =>
    part.suppressed || folderParts.has(part.id) || (part.drawnOn?.datum && folderPlanes.has(part.drawnOn.datum));
  const sketches = new Set(document.parts.filter(part => part.extrude === false).map(part => part.id));
  const suppressedSomething =
    masked.length ||
    document.partCuts?.some(step => step.suppressed || [...step.tools, ...step.targets].some(id => sketches.has(id.split(':')[0]!))) ||
    document.parts.some(part => part.suppressed || part.pattern?.suppressed || part.copies?.some(copy => copy.suppressed));
  if (!suppressedSomething) return document;
  const parts = document.parts.map((part): CadPart => {
    const next: CadPart = suppressedPart(part) ? { ...part, extrude: false } : { ...part };
    if (part.pattern?.suppressed) {
      // Circular patterns anchor an otherwise unplaced seed at the origin. Keep that frame in the built view when
      // removing the pattern and its copies, including portable files that never had an explicit seed placement.
      if (part.pattern.circular && !part.placement) next.placement = CAD_IDENTITY_PLACEMENT;
      delete next.pattern;
    }
    // The copies left keep the names they had, rather than moving up into a suppressed one's.
    const copies = (part.copies ?? [])
      .map((copy, index) => ({ ...copy, name: cadCopyName(part, index) }))
      .filter(copy => !copy.suppressed && !(copy.pattern && part.pattern?.suppressed));
    if (copies.length) next.copies = copies;
    else delete next.copies;
    return next;
  });
  // A part that isn't built cuts nothing and is cut by nothing, as a sketch not yet extruded.
  const built = new Set(parts.filter(part => part.extrude !== false).map(part => part.id));
  const kept = (ids: string[]) => ids.filter(id => built.has(id.split(':')[0]!));
  const partCuts = (document.partCuts ?? [])
    .filter(step => !step.suppressed && !folderCuts.has(step.id))
    .map(step => ({ ...step, tools: kept(step.tools), targets: kept(step.targets) }))
    .filter(step => step.tools.length && step.targets.length);
  const next: CadDocument = { ...document, parts };
  if (partCuts.length) next.partCuts = partCuts;
  else delete next.partCuts;
  return trimCadFolders(next);
}
