import { cadFolderForStep, designSteps, type CadDocument } from '@wbcnc/cad';
import type { FeatureEntry } from './FeatureList';

export type ListedFeatureEntry = FeatureEntry | { kind: 'folder'; id: string };

export function folderOfFeature(document: CadDocument, entry: ListedFeatureEntry): string | undefined {
  if (entry.kind === 'folder') return undefined;
  if (entry.kind === 'step') return cadFolderForStep(document, entry.step)?.id;
  if (entry.kind === 'variable') return document.variables?.find(variable => variable.id === entry.id)?.folderId;
  return document.folders?.find(folder => folder.planeIds?.includes(entry.id))?.id;
}

/** Only presentation changes: every real feature keeps its place and participates in rollback while hidden. */
export function folderFeatureEntries(document: CadDocument): ListedFeatureEntry[] {
  const blank = new Set(
    document.parts
      .filter(part => !part.drawnOn && part.sketch.entities.every(entity => entity.type === 'point' && entity.fixed))
      .map(part => part.id)
  );
  const steps: FeatureEntry[] = designSteps(document)
    .filter(step => !blank.has(step.partId))
    .map(step => ({ kind: 'step', step }));
  const entries: ListedFeatureEntry[] = [
    ...(document.variables ?? []).filter(variable => !variable.folderId).map(variable => ({ kind: 'variable' as const, id: variable.id })),
    ...(document.planes ?? [])
      .filter(plane => !document.folders?.some(folder => folder.planeIds?.includes(plane.id)))
      .map(plane => ({ kind: 'plane' as const, id: plane.id })),
  ];
  const emitted = new Set<string>();
  const emitFolder = (id: string) => {
    if (emitted.has(id)) return;
    emitted.add(id);
    const folder = document.folders!.find(folder => folder.id === id)!;
    entries.push({ kind: 'folder', id });
    for (const variable of document.variables ?? []) if (variable.folderId === id) entries.push({ kind: 'variable', id: variable.id });
    for (const plane of document.planes ?? []) if (folder.planeIds?.includes(plane.id)) entries.push({ kind: 'plane', id: plane.id });
  };
  for (const entry of steps) {
    const folderId = folderOfFeature(document, entry);
    if (folderId) emitFolder(folderId);
    entries.push(entry);
  }
  for (const folder of document.folders ?? []) emitFolder(folder.id);
  return entries;
}
