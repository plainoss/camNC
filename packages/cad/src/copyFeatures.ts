import { newCadId } from './document';
import { addFaceSketch, setCutDepth, withFeatureVersion } from './features';
import { resolveDrawnPlacements } from './drawnOn';
import { cadCopyName, resolvePartPatterns } from './partPatterns';
import { detachedMirroredPart } from './detachedMirror';
import type { CadCutDepth, CadDocument, CadFaceRef, CadFeature, CadPart } from './types';

/** A copy keeps the family's features and adds only those explicitly addressed to it. */
export function featuresForCopy(part: CadPart, copyId?: string): CadFeature[] {
  const own = (part.features ?? []).filter(feature => feature.copyId === copyId && copyId !== undefined && feature.type === 'cut');
  return (part.features ?? []).filter(
    feature =>
      (!feature.copyId || feature.copyId === copyId) &&
      !(
        feature.type === 'cut' &&
        !feature.copyId &&
        own.some(other => other.type === 'cut' && other.sketchId === feature.sketchId && other.regionId === feature.regionId)
      )
  );
}

export function addCopyFaceSketch(
  document: CadDocument,
  partId: string,
  copyId: string,
  on: CadFaceRef
): { document: CadDocument; sketchId: string } {
  const part = document.parts.find(part => part.id === partId);
  if (!part?.copies?.some(copy => copy.id === copyId))
    throw new Error('This copy is not present. Restore its pattern count before sketching on it.');
  if (typeof on === 'object') {
    const floor = part.features?.find(feature => feature.type === 'cut' && feature.id === on.floorOf);
    if (!floor || (floor.copyId && floor.copyId !== copyId)) throw new Error('This pocket floor belongs to another copy.');
  }
  const added = addFaceSketch(document, partId, on);
  return {
    sketchId: added.sketchId,
    document: withFeatureVersion({
      ...added.document,
      parts: added.document.parts.map(part =>
        part.id !== partId
          ? part
          : {
              ...part,
              features: part.features?.map(feature =>
                feature.type === 'sketch' && feature.sketch.id === added.sketchId ? { ...feature, copyId } : feature
              ),
            }
      ),
    }),
  };
}

/** A cut on a family's existing region may also target just one copy. */
export function setCopyCutDepth(
  document: CadDocument,
  partId: string,
  copyId: string,
  sketchId: string,
  regionId: string,
  depth: CadCutDepth,
  expression?: string
): CadDocument {
  const part = document.parts.find(part => part.id === partId);
  if (!part?.copies?.some(copy => copy.id === copyId))
    throw new Error('This copy is not present. Restore its pattern count before cutting it.');
  const sketch = part.features?.find(feature => feature.type === 'sketch' && feature.sketch.id === sketchId);
  if (sketch?.copyId && sketch.copyId !== copyId) throw new Error('This sketch belongs to another copy.');
  const existing = part.features?.find(
    feature => feature.type === 'cut' && feature.copyId === copyId && feature.sketchId === sketchId && feature.regionId === regionId
  );
  if (existing)
    return withFeatureVersion({
      ...document,
      parts: document.parts.map(candidate =>
        candidate.id !== partId
          ? candidate
          : {
              ...candidate,
              features: candidate.features?.map(feature => {
                if (feature.id !== existing.id || feature.type !== 'cut') return feature;
                const { depthExpression: _expression, suppressed: _suppressed, ...cut } = feature;
                return { ...cut, depth, ...(depth !== 'through' && expression && { depthExpression: expression }) };
              }),
            }
      ),
    });
  // Let the normal cut API keep its validation and ordering, then give only the new feature its explicit target.
  const before = new Set(part.features?.map(feature => feature.id));
  const withoutFamilyCut: CadDocument = {
    ...document,
    parts: document.parts.map(candidate =>
      candidate.id !== partId
        ? candidate
        : {
            ...candidate,
            features: candidate.features?.filter(
              feature => feature.type !== 'cut' || feature.sketchId !== sketchId || feature.regionId !== regionId
            ),
          }
    ),
  };
  const added = setCutDepth(withoutFamilyCut, partId, sketchId, regionId, depth, expression);
  const updated = added.parts.find(candidate => candidate.id === partId)!;
  const created = updated.features!.find(feature => !before.has(feature.id))!;
  return withFeatureVersion({
    ...document,
    parts: document.parts.map(candidate =>
      candidate.id !== partId
        ? candidate
        : {
            ...candidate,
            features: [...(candidate.features ?? []), { ...created, copyId }],
          }
    ),
  });
}

/** Detach snapshots the current local sketch and placement; it carries no link back to the family. */
export function detachPartCopy(
  given: CadDocument,
  partId: string,
  copyId: string,
  name?: string
): { document: CadDocument; partId: string } | { error: string } {
  const document = resolvePartPatterns(resolveDrawnPlacements(given).document);
  const source = document.parts.find(part => part.id === partId);
  const index = source?.copies?.findIndex(copy => copy.id === copyId) ?? -1;
  if (!source || index < 0) return { error: 'This copy is not present. Restore its pattern count before detaching it.' };
  const copy = source.copies![index]!;
  const detached: CadPart = structuredClone(source);
  detached.name = name?.trim() || cadCopyName(source, index);
  detached.features = featuresForCopy(source, copyId).map(feature => {
    const { copyId: _copy, removedBy: _removedBy, ...rest } = feature;
    return rest;
  });
  delete detached.copies;
  delete detached.pattern;
  delete detached.drawnOn;
  delete detached.moved;
  delete detached.sketchOf;
  delete detached.faceProfile;
  delete detached.addTo;
  delete detached.remove;
  delete detached.suppressed;
  if (copy.placement) detached.placement = structuredClone(copy.placement);
  else delete detached.placement;
  const ids = new Map<string, string>();
  const collect = (value: unknown) => {
    if (!value || typeof value !== 'object') return;
    if ('id' in value && typeof value.id === 'string') ids.set(value.id, newCadId());
    for (const child of Object.values(value)) collect(child);
  };
  collect(detached);
  for (const id of ids.keys())
    if (id.endsWith(':origin') && ids.has(id.slice(0, -':origin'.length))) ids.set(id, `${ids.get(id.slice(0, -':origin'.length))}:origin`);
  const ordered = [...ids.keys()].sort((a, b) => b.length - a.length);
  const remap = (value: unknown, key = ''): unknown => {
    if (typeof value === 'string') {
      if (key === 'name' || key === 'label' || key === 'expression' || key.endsWith('Expression')) return value;
      if (ids.has(value)) return ids.get(value)!;
      // Region signatures contain their sketch and curve IDs separated by CAD punctuation.
      return ordered.reduce(
        (text, id) =>
          text.replace(new RegExp(`(?<![A-Za-z0-9_-])${id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![A-Za-z0-9_-])`, 'g'), ids.get(id)!),
        value
      );
    }
    if (Array.isArray(value)) return value.map(item => remap(item, key));
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, remap(item, key)]));
    return value;
  };
  const reflected = copy.mirrored ? detachedMirroredPart(document, source, copy, name) : null;
  if (reflected && 'error' in reflected) return reflected;
  const part = reflected ?? (remap(detached) as CadPart);
  let parts = document.parts.map(candidate => {
    if (candidate.id !== partId) return candidate;
    const next = {
      ...candidate,
      copies: candidate.copies!.filter(copy => copy.id !== copyId),
      features: candidate.features?.filter(feature => feature.copyId !== copyId),
    };
    if (copy.pattern && next.pattern) {
      const logical = Number(copyId.slice(copy.pattern.length + 1));
      next.pattern = { ...next.pattern, excluded: [...new Set([...(next.pattern.excluded ?? []), logical])].sort((a, b) => a - b) };
    }
    return next;
  });
  const at = parts.findIndex(candidate => candidate.id === partId);
  parts = [...parts.slice(0, at + 1), part, ...parts.slice(at + 1)];
  const next = withFeatureVersion({
    ...document,
    revision: given.revision + 1,
    parts,
    ...(document.partCuts && {
      partCuts: document.partCuts.map(cut => {
        const follow = (references: string[]) => [
          ...new Set(
            references.flatMap(reference =>
              reference === `${partId}:${copyId}` ? [part.id] : reference === partId ? [reference, part.id] : [reference]
            )
          ),
        ];
        return { ...cut, tools: follow(cut.tools), targets: follow(cut.targets) };
      }),
    }),
    ...(document.folders && {
      folders: document.folders.map(folder =>
        !folder.partIds.includes(partId)
          ? folder
          : {
              ...folder,
              partIds: parts.filter(candidate => folder.partIds.includes(candidate.id) || candidate.id === part.id).map(part => part.id),
            }
      ),
    }),
  });
  return { document: next, partId: part.id };
}
