import { activeDesign, cadCopyName, consumedTools, isCadBody, physicalJoinedCopies, type CadDocument } from '@wbcnc/cad';

/** One physical wooden piece: a source instance, or one exact copy of it. */
export interface FurniturePiece {
  partId: string;
  copyId?: string;
  name: string;
}

const key = (piece: { partId: string; copyId?: string }) => `${piece.partId}:${piece.copyId ?? ''}`;

/**
 * Every active wooden piece of `given`, as the assembly places it: switched-off parts, folders and copies, unextruded
 * sketches and tools used up by their cut drop out. Purchased hardware is never a piece.
 */
export function furniturePieces(given: CadDocument): FurniturePiece[] {
  const document = physicalJoinedCopies(activeDesign(given));
  const consumed = consumedTools(document);
  return document.parts.flatMap(source => {
    if (!isCadBody(document, source) || consumed.has(source.id)) return [];
    return [
      { partId: source.id, name: source.name },
      ...(source.copies ?? []).map((copy, index) => ({ partId: source.id, copyId: copy.id, name: cadCopyName(source, index) })),
    ];
  });
}

/**
 * The active wooden pieces no active construction plan names as a member: pieces whose joints and fastening nothing
 * measures. A plan in a switched-off folder describes nothing built, so its members don't count.
 */
export function unplannedFurniturePieces(document: CadDocument): FurniturePiece[] {
  const parked = new Set(document.folders?.filter(folder => folder.suppressed).map(folder => folder.id));
  const planned = new Set((document.constructions ?? []).filter(plan => !parked.has(plan.folderId)).flatMap(plan => plan.members.map(key)));
  return furniturePieces(document).filter(piece => !planned.has(key(piece)));
}

/**
 * The pieces `document` adds to `base` that no construction plan measures. A piece kept from `base` is the user's
 * existing work and is left alone.
 */
export function addedUnplannedFurniturePieces(base: CadDocument | null, document: CadDocument): FurniturePiece[] {
  const existing = new Set(base ? furniturePieces(base).map(key) : []);
  return unplannedFurniturePieces(document).filter(piece => !existing.has(key(piece)));
}
