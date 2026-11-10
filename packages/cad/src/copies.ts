import { consumedTools } from './consumedTools';
import { newCadId } from './document';
import { isCadBody } from './extrudeSteps';
import { cadCopyName, resolvePartPatterns } from './partPatterns';
import type { CadDocument, CadPartCopy, CadPoint, EvaluatedCadCut, EvaluatedCadPart } from './types';
import { activeDesign } from './suppression';

/** Adds another of a part, laid out with the unplaced parts until it's placed. */
export function addPartCopy(
  document: CadDocument,
  partId: string,
  options: { mirrored?: boolean; offset?: CadPartCopy['offset']; turn?: CadPartCopy['turn'] } = {}
): { document: CadDocument; id: string } {
  const copy: CadPartCopy = {
    id: newCadId(),
    ...(options.mirrored && { mirrored: true }),
    ...(options.offset && { offset: options.offset }),
    ...(options.turn && { turn: options.turn }),
  };
  return {
    id: copy.id,
    document: resolvePartPatterns({
      ...document,
      revision: document.revision + 1,
      parts: document.parts.map(part => (part.id === partId ? { ...part, copies: [...(part.copies ?? []), copy] } : part)),
    }),
  };
}

/** Changes how far a transformed copy is moved from its part, and whether it's the part's mirror image. */
export function setPartCopyOffset(
  document: CadDocument,
  partId: string,
  copyId: string,
  change: { offset: NonNullable<CadPartCopy['offset']>; mirrored?: boolean; turn?: CadPartCopy['turn'] }
): CadDocument {
  return resolvePartPatterns({
    ...document,
    revision: document.revision + 1,
    parts: document.parts.map(part =>
      part.id !== partId
        ? part
        : {
            ...part,
            copies: part.copies?.map(copy => {
              if (copy.id !== copyId) return copy;
              const next: CadPartCopy = { ...copy, offset: change.offset };
              if (change.mirrored) next.mirrored = true;
              else delete next.mirrored;
              // Turned before the offset, or not at all.
              if (change.turn) next.turn = change.turn;
              else delete next.turn;
              return next;
            }),
          }
    ),
  });
}

/** Removes one copy of a part, leaving the part and its other copies. */
export function removePartCopy(document: CadDocument, partId: string, copyId: string): CadDocument {
  return {
    ...document,
    revision: document.revision + 1,
    parts: document.parts.map(part => {
      if (part.id !== partId || !part.copies?.some(copy => copy.id === copyId)) return part;
      const { copies: _copies, ...rest } = part;
      const copies = part.copies.filter(copy => copy.id !== copyId);
      return copies.length ? { ...rest, copies } : rest;
    }),
  };
}

/** The ID CAM gives a part's mirror image, which it cuts as a part of its own. */
export const mirroredPartId = (partId: string) => `${partId}:mirrored`;

// Mirroring reverses each loop, so turning it back keeps outer loops and holes running the way they did.
const mirrorLoop = (points: CadPoint[]) => points.map(point => ({ ...point, x: -point.x })).reverse();

/** A part's mirror image across its sketch's y axis: the shape a mirrored copy is cut to. */
export function mirrorEvaluatedPart(part: EvaluatedCadPart): EvaluatedCadPart {
  return {
    ...part,
    partId: mirroredPartId(part.partId),
    outline: mirrorLoop(part.outline),
    holes: part.holes.map(mirrorLoop),
    loops: part.loops.map(loop => ({ ...loop, points: mirrorLoop(loop.points) })),
    ...(part.cuts && {
      cuts: part.cuts.map(cut => ({
        ...cut,
        outline: mirrorLoop(cut.outline),
        islands: cut.islands.map(mirrorLoop),
        ...(cut.opening && { opening: { ...cut.opening, x0: -cut.opening.x1, x1: -cut.opening.x0 } }),
      })),
    }),
  };
}

/** One shape to cut, and a name for each piece of it. */
export interface CadPartToCut {
  part: EvaluatedCadPart;
  names: string[];
}

function loopKey(loop: CadPoint[]): string | undefined {
  const points = loop.map(point => [Math.round(point.x * 1e6) / 1e6, Math.round(point.y * 1e6) / 1e6]);
  return points.map((_, index) => JSON.stringify([...points.slice(index), ...points.slice(0, index)])).sort()[0];
}

/** Matching cuts alone do not establish matching stock: No cut can fill a profile hole on just one copy. */
export function sameCadProfile(a: EvaluatedCadPart, b: EvaluatedCadPart): boolean {
  const key = (part: EvaluatedCadPart) => JSON.stringify([part.thickness, loopKey(part.outline), part.holes.map(loopKey).sort()]);
  return key(a) === key(b);
}

/** Whether two cut sets remove the same material, regardless of tool IDs or loop starting points. */
export function sameCadCuts(a: readonly EvaluatedCadCut[] = [], b: readonly EvaluatedCadCut[] = []): boolean {
  const round = (n: number) => Math.round(n * 1e6) / 1e6;
  const key = (cuts: readonly EvaluatedCadCut[]) =>
    JSON.stringify(
      cuts
        .map(cut => ({
          side: cut.side,
          from: round(cut.from),
          to: round(cut.to),
          through: cut.through,
          outline: loopKey(cut.outline),
          islands: cut.islands.map(loopKey).sort(),
        }))
        .map(cut => JSON.stringify(cut))
        .sort()
    );
  return key(a) === key(b);
}

/** A copy's own cuts, mirrored with its shape only after selecting cuts in the original's frame. */
export function evaluatedPartCopy(part: EvaluatedCadPart, copy: CadPartCopy): EvaluatedCadPart {
  const own = part.copyCuts?.[copy.id];
  const profile = part.copyProfiles?.[copy.id];
  const shape = own || profile ? { ...part, ...profile, ...(own && { cuts: own }) } : part;
  return copy.mirrored ? mirrorEvaluatedPart(shape) : shape;
}

/**
 * What gets cut: pieces grouped by their cuts and whether they are mirrored, named as the assembly names them.
 */
export function cadPartsToCut(given: CadDocument, parts: readonly EvaluatedCadPart[]): CadPartToCut[] {
  // Copies switched off in the feature list aren't cut.
  const document = activeDesign(given);
  const consumed = consumedTools(document);
  return parts.flatMap(part => {
    const source = document.parts.find(candidate => candidate.id === part.partId);
    // A sketch not yet extruded, a step cutting others, or a tool used up by its cut, isn't a part to cut.
    if ((source && !isCadBody(document, source)) || consumed.has(part.partId)) return [];
    const groups: (CadPartToCut & { mirrored?: boolean })[] = [{ part, names: [part.name] }];
    for (const [index, copy] of (source?.copies ?? []).entries()) {
      const shape = evaluatedPartCopy(part, copy);
      const group = groups.find(
        entry => !!entry.mirrored === !!copy.mirrored && sameCadProfile(entry.part, shape) && sameCadCuts(entry.part.cuts, shape.cuts)
      );
      const name = cadCopyName(source!, index);
      if (group) group.names.push(name);
      else {
        const id = groups.some(entry => entry.part.partId === shape.partId) ? `${shape.partId}:copy:${copy.id}` : shape.partId;
        groups.push({
          part: { ...shape, partId: id, name: copy.mirrored ? `${part.name} (mirrored)` : part.name },
          names: [name],
          mirrored: !!copy.mirrored,
        });
      }
    }
    return groups.map(({ part, names }) => ({ part, names }));
  });
}
