import { isJoinedBody } from './extrudeSteps';
import type { CadDocument, CadPart } from './types';

/** Rebind structured face/corner references without rewriting labels or variable expressions. */
export function rebindDetachedCopyReferences(
  document: CadDocument,
  sourceId: string,
  copyId: string,
  detached: CadPart,
  ids: ReadonlyMap<string, string>,
  mirrored: boolean
): { document: CadDocument } | { error: string } {
  let error: string | null = null;
  const inherited = new Set(document.parts.filter(part => part.addTo === sourceId && isJoinedBody(document, part)).map(part => part.id));
  const remapReference = (value: unknown, key: string): unknown => {
    if ((key === 'pointId' || key === 'edge') && typeof value === 'string') {
      const next = ids.get(value);
      if (!next) error = 'This copy has a reference whose sketch lineage cannot be preserved. Remove that reference before detaching it.';
      return next ?? value;
    }
    if (Array.isArray(value)) return value.map(item => remapReference(item, key));
    if (value && typeof value === 'object')
      return Object.fromEntries(Object.entries(value).map(([name, item]) => [name, remapReference(item, name)]));
    return value;
  };
  const visit = (value: unknown, key = ''): unknown => {
    if (typeof value === 'string') return key === 'targets' && value === `${sourceId}:${copyId}` ? detached.id : value;
    if (Array.isArray(value)) return value.map(item => visit(item, key));
    if (!value || typeof value !== 'object') return value;
    const record = value as Record<string, unknown>;
    if (record.copyId === copyId && inherited.has(String(record.partId)))
      error = 'This copy has a reference to a joined body on it. Remove that reference before detaching the copy.';
    if (record.partId === sourceId && record.copyId === copyId) {
      // A reflected snapshot has new sketch axes and tessellated lineage. Refuse external supports rather than
      // silently change a dependent sketch's frame or redirect its picked edge/corner to a different point.
      if (mirrored) {
        error = 'This mirrored copy has a face or corner reference. Remove those references before detaching it.';
        return value;
      }
      const { copyId: _copyId, ...reference } = record;
      return { ...(remapReference(reference, '') as Record<string, unknown>), partId: detached.id };
    }
    return Object.fromEntries(Object.entries(record).map(([name, item]) => [name, visit(item, name)]));
  };
  const next = visit(document) as CadDocument;
  return error ? { error } : { document: next };
}
