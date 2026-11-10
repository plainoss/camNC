import { newCadId } from './document';
import { copyOperationSourceIssue } from './copyOperationSource';
import { evaluateCadDocument } from './features';
import { cadPartReference } from './partReferences';
import { trimCadFolders } from './folderModel';
import type { CadCopyTransform, CadDocument } from './types';

/** Fresh ordered documents use current tool material. This explicit conversion opts into ordered cut semantics. */
export function orderedCadDocument(document: CadDocument): CadDocument {
  if (document.operationOrder !== undefined) return document;
  return { ...document, version: 4, operationOrder: document.partCuts?.map(cut => cut.id) ?? [] };
}

/** Upgrading an existing file preserves its old cut batch by source identity, never by cached candidate geometry. */
export function upgradeCadCopyOperations(document: CadDocument): CadDocument {
  if (document.operationOrder !== undefined) return document;
  const next = orderedCadDocument(document),
    legacyPartCutIds = next.operationOrder!;
  return legacyPartCutIds.length ? { ...next, legacyPartCutIds: [...legacyPartCutIds] } : next;
}

/** Explicit migration, which may change earlier cuts by making their tools inherit prior material. Review before saving. */
export function migrateLegacyCutsToOrdered(document: CadDocument): CadDocument {
  const ordered = orderedCadDocument(document);
  if (!ordered.legacyPartCutIds) return ordered === document ? ordered : { ...ordered, revision: document.revision + 1 };
  const { legacyPartCutIds: _legacy, ...source } = ordered;
  return { ...source, revision: document.revision + 1 };
}

const checked = (document: CadDocument) => {
  const issue = copyOperationSourceIssue(document);
  if (issue) throw Error(issue);
  return document;
};

/** Append a pose operation after all existing operations. Target availability is checked at this exact stage. */
export function addCopyTransform(
  document: CadDocument,
  partId: string,
  copyId: string,
  change: Omit<CadCopyTransform, 'id' | 'partId' | 'copyId'>
) {
  const next = upgradeCadCopyOperations(document),
    result = evaluateCadDocument(next);
  if (!result.available?.includes(cadPartReference(partId, copyId)) || !result.placements?.[cadPartReference(partId, copyId)])
    throw Error('This physical copy is not available at this operation.');
  const move: CadCopyTransform = { id: newCadId(), partId, copyId, ...change };
  return {
    id: move.id,
    document: checked({
      ...next,
      revision: document.revision + 1,
      copyTransforms: [...(next.copyTransforms ?? []), move],
      operationOrder: [...next.operationOrder!, move.id],
    }),
  };
}

/** Editing keeps a missing target's stable reference, so restoring its original slot reapplies this operation. */
export function updateCopyTransform(document: CadDocument, id: string, change: Partial<Omit<CadCopyTransform, 'id'>>) {
  const next = {
    ...document,
    revision: document.revision + 1,
    copyTransforms: document.copyTransforms?.map(move => (move.id === id ? { ...move, ...change } : move)),
  };
  return checked(next);
}

export function removeCopyTransform(document: CadDocument, id: string) {
  return checked({
    ...document,
    revision: document.revision + 1,
    copyTransforms: document.copyTransforms?.filter(move => move.id !== id),
    operationOrder: document.operationOrder?.filter(operation => operation !== id),
  });
}

/** Reordering may not silently move an old fixed-tool cut across its compatibility boundary. */
export function setCopyOperationOrder(document: CadDocument, operationOrder: string[]) {
  return checked({ ...document, revision: document.revision + 1, operationOrder });
}

/** Source prefix for history and reload, using the same IDs and stage order as evaluation. */
export function copyOperationPrefix(document: CadDocument, through?: string): CadDocument {
  const order = document.operationOrder;
  if (!order) return document;
  const at = through === undefined ? -1 : order.indexOf(through);
  if (through !== undefined && at < 0) throw Error('This operation is not in the source order.');
  const operationOrder = order.slice(0, at + 1),
    kept = new Set(operationOrder);
  // A finite prefix removes later cut records; its folder memberships must remain valid source too.
  return checked(
    trimCadFolders({
      ...document,
      operationOrder,
      partCuts: document.partCuts?.filter(cut => kept.has(cut.id)),
      copyTransforms: document.copyTransforms?.filter(move => kept.has(move.id)),
      ...(document.legacyPartCutIds && { legacyPartCutIds: document.legacyPartCutIds.filter(id => kept.has(id)) }),
    })
  );
}
