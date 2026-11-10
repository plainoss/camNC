import { cadDrawnOnSupports, effectivePlacement, isJoinedBody, joinedCopyPlacement, type CadDocument, type CadPlacement } from '@wbcnc/cad';
import type { AssemblyInstance } from './assemblyModel';

interface Piece {
  instance: AssemblyInstance;
  placement?: CadPlacement;
  origin?: [number, number];
  width: number;
}

/** Display-only row placement; a virtual joined copy shares its host's chosen row rather than receiving another row. */
export function assemblyDisplayPlacements(document: CadDocument, source: CadDocument, pieces: Piece[], start: number, gap: number) {
  const instanceKey = ({ partId, copyId }: Pick<AssemblyInstance, 'partId' | 'copyId'>) => (copyId ? `${partId}/${copyId}` : partId);
  const byId = new Map(document.parts.map(part => [part.id, part]));
  const byKey = new Map(pieces.map(piece => [instanceKey(piece.instance), piece]));
  const supports = cadDrawnOnSupports(document);
  const placements = new Map<string, CadPlacement>();
  let cursor = start;
  const place = (piece: Piece): CadPlacement => {
    const key = instanceKey(piece.instance),
      cached = placements.get(key);
    if (cached) return cached;
    let placement = piece.placement;
    const { partId, copyId } = piece.instance,
      part = byId.get(partId);
    const inherited =
      copyId &&
      part &&
      isJoinedBody(document, part) &&
      !source.parts.find(candidate => candidate.id === partId)?.copies?.some(copy => copy.id === copyId);
    if (!placement && inherited) {
      const parent = byId.get(part.addTo!),
        host = byKey.get(instanceKey({ partId: part.addTo!, copyId }));
      const copy = parent?.copies?.find(copy => copy.id === copyId);
      const parentAt = parent && effectivePlacement(parent, supports),
        partAt = effectivePlacement(part, supports);
      // Core admits only direct-root Add bodies, so a host cannot recursively depend on this child.
      if (parentAt && partAt && host && copy) placement = joinedCopyPlacement(parentAt, partAt, place(host), !!copy.mirrored);
    }
    if (!placement) {
      // Keep legacy +0 at the origin; unary negation would expose -0 in the placement map.
      placement = { position: [cursor - (piece.origin?.[0] ?? 0), 0 - (piece.origin?.[1] ?? 0), 0], rotation: [0, 0, 0, 1] };
      cursor += piece.width + gap;
    }
    placements.set(key, placement);
    return placement;
  };
  pieces.forEach(place);
  return placements;
}
