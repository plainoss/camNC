import { designSteps, rolledBackTo, type DesignStep } from './designSteps';
import { newCadId } from './document';
import { cadDocumentVersion } from './documentVersion';
import { cadFolderForStep, cadFolderIssue, cadFolderStepIssue } from './folderModel';
import type { CadDocument, CadFolder } from './types';
import { cadVariableUses } from './variables';

export { cadFolderForPart, cadFolderForStep, cadFolderIssue, trimCadFolders } from './folderModel';

type Change = { document: CadDocument } | { error: string };
export type CadFolderOptions = Pick<CadFolder, 'name' | 'partIds' | 'partCutIds' | 'planeIds'> & { id?: string };

function changed(document: CadDocument, patch: Partial<CadDocument>): CadDocument {
  const next = { ...document, ...patch, revision: document.revision + 1 };
  if (!next.folders?.length) delete next.folders;
  if (!next.variables?.length) delete next.variables;
  next.version = cadDocumentVersion(next);
  return next;
}

export function cadFolderSteps(document: CadDocument, folderId: string): DesignStep[] {
  return designSteps(document).filter(step => cadFolderForStep(document, step)?.id === folderId);
}

/** Makes a group of neighbouring parts and the cut-parts steps displayed between them. */
export function createCadFolder(
  document: CadDocument,
  options: CadFolderOptions
): { document: CadDocument; id: string } | { error: string } {
  const id = options.id ?? newCadId();
  const partIds = options.partIds.slice();
  const sourceOrder = new Map(document.parts.map((part, index) => [part.id, index]));
  partIds.sort((a, b) => (sourceOrder.get(a) ?? -1) - (sourceOrder.get(b) ?? -1));
  const steps = designSteps(document);
  const first = steps.findIndex(step => step.kind !== 'partCut' && partIds.includes(step.partId));
  let last = steps.length - 1;
  while (last >= 0 && (steps[last]!.kind === 'partCut' || !partIds.includes(steps[last]!.partId))) last--;
  while (last >= 0 && steps[last + 1]?.kind === 'partCut') last++;
  const partCutIds =
    options.partCutIds ??
    steps
      .slice(first, last + 1)
      .filter(step => step.kind === 'partCut')
      .map(step => step.id);
  const folder: CadFolder = {
    id,
    name: options.name.trim(),
    partIds,
    ...(partCutIds.length && { partCutIds: partCutIds.slice() }),
    ...(options.planeIds?.length && { planeIds: options.planeIds.slice() }),
  };
  const next = changed(document, { folders: [...(document.folders ?? []), folder] });
  const error = cadFolderIssue(next) || cadFolderStepIssue(next, steps);
  if (error) return { error };
  return { document: next, id };
}

export function renameCadFolder(document: CadDocument, id: string, name: string): Change {
  const folder = document.folders?.find(candidate => candidate.id === id);
  if (!folder) return { error: 'This folder no longer exists.' };
  if (!name.trim()) return { error: 'Enter a folder name.' };
  if (name.trim() === folder.name) return { document };
  return {
    document: changed(document, {
      folders: document.folders!.map(candidate => (candidate.id === id ? { ...candidate, name: name.trim() } : candidate)),
    }),
  };
}

function setFlag(document: CadDocument, id: string, flag: 'suppressed' | 'collapsed', value: boolean): Change {
  const folder = document.folders?.find(candidate => candidate.id === id);
  if (!folder) return { error: 'This folder no longer exists.' };
  if (!!folder[flag] === value) return { document };
  const folders = document.folders!.map(candidate => {
    if (candidate.id !== id) return candidate;
    const next = { ...candidate };
    if (value) next[flag] = true;
    else delete next[flag];
    return next;
  });
  return { document: changed(document, { folders }) };
}

export const setCadFolderSuppressed = (document: CadDocument, id: string, suppressed: boolean): Change =>
  setFlag(document, id, 'suppressed', suppressed);
export const setCadFolderCollapsed = (document: CadDocument, id: string, collapsed: boolean): Change =>
  setFlag(document, id, 'collapsed', collapsed);

/** Unpacking removes only the group. Source steps, flags, names and variable expressions stay exactly as they were. */
export function dissolveCadFolder(document: CadDocument, id: string): CadDocument {
  if (!document.folders?.some(folder => folder.id === id)) return document;
  return changed(document, {
    folders: document.folders.filter(folder => folder.id !== id),
    variables: document.variables?.map(variable => {
      if (variable.folderId !== id) return variable;
      const { folderId: _folderId, ...rest } = variable;
      return rest;
    }),
  });
}

export interface CadFolderVariableUse {
  variableId: string;
  variableName: string;
  ownerId: string;
  ownerName: string;
  count: number;
}

/** Lists every outside owner that would lose a variable when the folder is deleted. */
export function cadFolderVariableUses(document: CadDocument, id: string): CadFolderVariableUse[] {
  const folder = document.folders?.find(candidate => candidate.id === id);
  if (!folder) return [];
  const uses: CadFolderVariableUse[] = [];
  const empty: CadDocument = { ...document, variables: [], parts: [], partCuts: [], planes: [] };
  for (const variable of document.variables?.filter(candidate => candidate.folderId === id) ?? []) {
    const record = (ownerId: string, ownerName: string, source: CadDocument) => {
      const count = cadVariableUses(source, variable.name);
      if (count) uses.push({ variableId: variable.id, variableName: variable.name, ownerId, ownerName, count });
    };
    for (const part of document.parts.filter(part => !folder.partIds.includes(part.id)))
      record(part.id, part.name, { ...empty, parts: [part] });
    for (const cut of document.partCuts?.filter(cut => !folder.partCutIds?.includes(cut.id)) ?? [])
      record(cut.id, `Cut parts ${cut.id}`, { ...empty, partCuts: [cut] });
    for (const plane of document.planes?.filter(plane => !folder.planeIds?.includes(plane.id)) ?? [])
      record(plane.id, plane.name, { ...empty, planes: [plane] });
    for (const other of document.variables?.filter(candidate => candidate.folderId !== id) ?? [])
      record(other.id, other.name, { ...empty, variables: [other] });
  }
  return uses;
}

export function deleteCadFolder(document: CadDocument, id: string): Change {
  const folder = document.folders?.find(candidate => candidate.id === id);
  if (!folder) return { document };
  const uses = cadFolderVariableUses(document, id);
  if (uses.length)
    return {
      error: `Folder variables are still used outside it: ${uses.map(use => `${use.variableName} in ${use.ownerName}`).join(', ')}.`,
    };
  const externalDatum = document.parts.find(
    part => !folder.partIds.includes(part.id) && part.drawnOn?.datum && folder.planeIds?.includes(part.drawnOn.datum)
  );
  if (externalDatum) return { error: `${externalDatum.name} still uses a plane in this folder.` };
  return {
    document: changed(document, {
      folders: document.folders!.filter(candidate => candidate.id !== id),
      variables: document.variables?.filter(variable => variable.folderId !== id),
      parts: document.parts.filter(part => !folder.partIds.includes(part.id)),
      partCuts: document.partCuts?.filter(cut => !folder.partCutIds?.includes(cut.id)),
      planes: document.planes?.filter(plane => !folder.planeIds?.includes(plane.id)),
    }),
  };
}

/** Moves a folder as a block, refusing to split another folder. `undefined` moves it to the end. */
export function moveCadFolder(document: CadDocument, id: string, beforePartId?: string): Change {
  const folder = document.folders?.find(candidate => candidate.id === id);
  if (!folder) return { error: 'This folder no longer exists.' };
  if (beforePartId && folder.partIds.includes(beforePartId)) return { document };
  if (beforePartId && !document.parts.some(part => part.id === beforePartId)) return { error: 'The destination part no longer exists.' };
  const destination = document.folders?.find(candidate => candidate.partIds.includes(beforePartId ?? ''));
  if (destination && destination.partIds[0] !== beforePartId) return { error: 'A folder cannot be moved inside another folder.' };
  const moving = document.parts.filter(part => folder.partIds.includes(part.id));
  const parts = document.parts.filter(part => !folder.partIds.includes(part.id));
  const index = beforePartId ? parts.findIndex(part => part.id === beforePartId) : parts.length;
  parts.splice(index, 0, ...moving);
  if (parts.every((part, at) => part === document.parts[at])) return { document };
  const order = new Map(parts.map((part, index) => [part.id, index]));
  for (const part of parts) {
    const on = part.drawnOn?.on;
    const parents = [
      ...(on && 'partId' in on ? [on.partId] : []),
      ...(part.sketchOf ? [part.sketchOf] : []),
      ...(part.addTo ? [part.addTo] : []),
    ];
    for (const parent of parents)
      if ((order.get(parent) ?? -1) > order.get(part.id)!) return { error: `${part.name} must stay after the part it is built on.` };
  }
  const next = changed(document, { parts });
  const error = cadFolderStepIssue(next, designSteps(next));
  return error ? { error } : { document: next };
}

/** Rollback counts actual features, so a closed folder ends at the same real step as an open one. */
export function rolledBackToFolder(document: CadDocument, id: string): CadDocument {
  const last = cadFolderSteps(document, id).at(-1);
  return last ? rolledBackTo(document, last.id) : document;
}
