import type { DesignStep } from './designSteps';
import type { CadDocument, CadFolder } from './types';

export function cadFolderForPart(document: CadDocument, partId: string): CadFolder | undefined {
  return document.folders?.find(folder => folder.partIds.includes(partId));
}

export function cadFolderForStep(document: CadDocument, step: DesignStep): CadFolder | undefined {
  return document.folders?.find(folder =>
    step.kind === 'partCut' ? folder.partCutIds?.includes(step.id) : folder.partIds.includes(step.partId)
  );
}

export function cadFolderStepIssue(document: CadDocument, steps: DesignStep[]): string | null {
  for (const folder of document.folders ?? []) {
    const indexes = steps.flatMap((step, index) => (cadFolderForStep(document, step)?.id === folder.id ? [index] : []));
    if (indexes.some((at, index) => index > 0 && at !== indexes[index - 1]! + 1)) return 'Choose neighbouring steps for a folder.';
  }
  return null;
}

/** Folder membership is a view over source order; no feature ID is manufactured for a folder row. */
export function cadFolderIssue(document: CadDocument): string | null {
  if (document.folders === undefined) {
    return document.variables?.some(variable => variable.folderId !== undefined) ? 'A variable belongs to a missing folder.' : null;
  }
  if (!Array.isArray(document.folders)) return 'Invalid CAD folders.';
  const folders = new Set<string>();
  const owned = new Set<string>();
  const members = (ids: unknown, available: string[], kind: string, optional = false): string | null => {
    if (ids === undefined && optional) return null;
    if (!Array.isArray(ids) || ids.some(id => typeof id !== 'string' || !available.includes(id)))
      return `A folder references a missing ${kind}.`;
    for (const id of ids) {
      if (owned.has(id)) return 'A source step belongs to more than one folder.';
      owned.add(id);
    }
    const indices = ids.map(id => available.indexOf(id));
    if (indices.some((at, index) => index > 0 && at !== indices[index - 1]! + 1))
      return `A folder's ${kind}s must be neighbours in source order.`;
    return null;
  };
  for (const folder of document.folders) {
    if (
      !folder ||
      typeof folder !== 'object' ||
      typeof folder.id !== 'string' ||
      !folder.id ||
      folders.has(folder.id) ||
      typeof folder.name !== 'string' ||
      !folder.name.trim() ||
      (folder.collapsed !== undefined && folder.collapsed !== true) ||
      (folder.suppressed !== undefined && folder.suppressed !== true)
    )
      return 'Invalid CAD folder.';
    folders.add(folder.id);
    const issue =
      members(
        folder.partIds,
        document.parts.map(part => part.id),
        'part'
      ) ||
      members(
        folder.partCutIds,
        (document.partCuts ?? []).map(cut => cut.id),
        'cut-parts step',
        true
      ) ||
      members(
        folder.planeIds,
        (document.planes ?? []).map(plane => plane.id),
        'plane',
        true
      );
    if (issue) return issue;
  }
  if (document.variables?.some(variable => variable.folderId !== undefined && !folders.has(variable.folderId)))
    return 'A variable belongs to a missing folder.';
  return null;
}

/** Transient rollback and step deletion keep groups but remove memberships of source steps that are gone. */
export function trimCadFolders(document: CadDocument): CadDocument {
  if (!document.folders?.length) return document;
  const parts = new Set(document.parts.map(part => part.id));
  const cuts = new Set(document.partCuts?.map(cut => cut.id));
  const planes = new Set(document.planes?.map(plane => plane.id));
  return {
    ...document,
    folders: document.folders.map(folder => ({
      ...folder,
      partIds: folder.partIds.filter(id => parts.has(id)),
      ...(folder.partCutIds && { partCutIds: folder.partCutIds.filter(id => cuts.has(id)) }),
      ...(folder.planeIds && { planeIds: folder.planeIds.filter(id => planes.has(id)) }),
    })),
  };
}
