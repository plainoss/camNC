import { cadPartsToCut, migrateDimensionPlacements, type CadDocument } from '@wbcnc/cad';
import { solveCadDocument } from '../cad/solveCad';
import { updateJobForModel, type CamJobV1 } from './jobDb';
import { carryDesignTabs } from './designTabAnchors';
import { designGeometryFingerprint, designGeometryKey } from './designGeometry';
import { asMilled } from './millSide';
import { missingNativeHoleChoices } from './holeChoices';

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
// Representation upgrades are not edits; durable optimistic guards still compare exact snapshots below.
const sameDesignContent = (a: CadDocument | null | undefined, b: CadDocument | null | undefined) =>
  same(a && { ...migrateDimensionPlacements(a), revision: 0 }, b && { ...migrateDimensionPlacements(b), revision: 0 });

/** A draft is recoverable after reload; it never changes the geometry CAM has accepted. */
export async function saveDesignDraft(
  base: CamJobV1,
  document: CadDocument,
  expectedDraft: CadDocument | undefined = base.design?.draft
): Promise<CamJobV1> {
  if (!base.design || document.id !== base.design.draft.id) throw new Error('This design is no longer open.');
  const saved = await updateJobForModel(base, current => {
    if (!current.design || !same(current.design.draft, expectedDraft)) return null;
    return { ...current, design: { ...current.design, draft: document } };
  });
  if (!saved) {
    const error = new Error('This design changed in another view. Your local sketch is kept; save a copy or use the saved sketch.');
    error.name = 'CadDraftConflict';
    throw error;
  }
  return saved;
}

/** Accept a valid sketch as a new CAM revision, preserving settings and references by permanent ID. */
export async function acceptDesign(base: CamJobV1, document: CadDocument): Promise<CamJobV1> {
  if (!base.design) throw new Error('This job is not a native design.');
  const solved = await solveCadDocument(document);
  if (solved.status !== 'solved' || !cadPartsToCut(solved.document, solved.parts).length)
    throw new Error(
      solved.diagnostics.find(d => d.severity === 'error')?.message || 'Draw at least one closed part before continuing to Boards.'
    );
  const before = base.design.accepted ? await solveCadDocument(base.design.accepted) : null;
  // Mirrored copies are parts of their own to CAM, and plain copies add to a part's quantity.
  const toCut = cadPartsToCut(solved.document, solved.parts),
    cut = toCut.map(entry => entry.part),
    cutBefore = before ? cadPartsToCut(before.document, before.parts).map(entry => entry.part) : [];
  // Keyed as milled: a part that now lies turned over is another program, so a sheet cut the other way up no longer matches.
  const partGeometryKeys = Object.fromEntries(
    await Promise.all(cut.map(async part => [part.partId, await designGeometryKey(asMilled(part))]))
  );
  const saved = await updateJobForModel(base, current => {
    if (!current.design || !same(current.design.draft, base.design!.draft)) return null;
    const previous = new Map(cutBefore.map(p => [p.partId, p]));
    const partRevisions = { ...current.design.partRevisions };
    for (const part of cut) {
      const oldPart = previous.get(part.partId);
      if (!oldPart || designGeometryFingerprint(oldPart) !== designGeometryFingerprint(part))
        partRevisions[part.partId] = (partRevisions[part.partId] ?? 0) + 1;
    }
    const present = new Set(cut.map(p => p.partId));
    for (const id of previous.keys()) if (!present.has(id)) partRevisions[id] = (partRevisions[id] ?? 0) + 1;
    const known = new Map(current.parts.map(p => [p.id, p]));
    const nativeParts = toCut.map(({ part: p, names }) => ({
      id: p.partId,
      name: p.name,
      quantity: names.length,
      milled: known.get(p.partId)?.milled ?? true,
    }));
    // Missing part records remain available to repair existing board references.
    const ids = new Set(nativeParts.map(p => p.id));
    const holeChoiceIssues = missingNativeHoleChoices(cut, current.plan?.holes);
    const acceptedGeometry = { ...current, design: { ...current.design, partRevisions, partGeometryKeys } };
    const boardSourceKeys = Object.fromEntries(
      (current.boards ?? []).map(board => [
        board.id,
        boardGeometryKey(
          acceptedGeometry,
          board.items.filter(id => !current.plan?.leaveOut?.includes(id)).map(id => id.split('#')[0]!)
        ),
      ])
    );
    return {
      ...current,
      name: solved.document.name,
      fileName: solved.document.name,
      readError: undefined,
      parts: [...nativeParts, ...current.parts.filter(p => !ids.has(p.id))],
      // CAD origin changes are not layout commands: the saved CAM positions remain authoritative.
      boards: carryDesignTabs(current.boards, before, solved, boardSourceKeys, { turnedBefore: !!current.design.turnsUndersideUp }),
      design: {
        draft: solved.document,
        accepted: solved.document,
        acceptedRevision: current.design.acceptedRevision + (sameDesignContent(current.design.accepted, solved.document) ? 0 : 1),
        partRevisions,
        partGeometryKeys,
        turnsUndersideUp: true,
        ...(holeChoiceIssues.length && { holeChoiceIssues }),
      },
    };
  });
  if (!saved) throw new Error('This design changed while it was being solved. Reopen it before accepting changes.');
  return saved;
}

export const hasDesignDraft = (job: CamJobV1) => !!job.design && !sameDesignContent(job.design.draft, job.design.accepted);

/** Physical stock depends on accepted geometry content, so a true revert can use its original remaining programs. */
export function boardGeometryKey(job: CamJobV1, partIds: string[]) {
  if (!job.design) return undefined;
  return `${job.id}:parts:${JSON.stringify([...new Set(partIds)].sort().map(id => [id, job.design!.partGeometryKeys?.[id] ?? `revision:${job.design!.partRevisions[id] ?? 0}`]))}`;
}
