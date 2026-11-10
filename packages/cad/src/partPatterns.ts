import { newCadId } from './document';
import { cadDocumentVersion } from './documentVersion';
import { cadDatumFrame } from './datumPlanes';
import { cadDrawnOnSupports, cadFaceFrame, effectivePlacement } from './drawnOn';
import { mirroredPlacement, turnAbout } from './placement';
import { cadDirectionVector } from './directions';
import type { CadDocument, CadPart, CadPartCopy, CadPartPattern, CadPlacement } from './types';

const kAxes = { x: 0, y: 1, z: 2 } as const;
/** The most pieces a pattern makes, counting the part itself. */
export const CAD_MAX_PART_PATTERN = 200;

/** What a copy is called: its own name, or the part's with a number counting the part as the first. */
export const cadCopyName = (part: Pick<CadPart, 'name' | 'copies'>, index: number): string =>
  part.copies?.[index]?.name ??
  (() => {
    const copy = part.copies?.[index];
    const logical = copy?.pattern ? Number(copy.id.slice(copy.pattern.length + 1)) : NaN;
    const own = part.copies?.filter(copy => !copy.pattern).length ?? 0;
    return `${part.name} ${Number.isInteger(logical) ? own + logical + 1 : index + 2}`;
  })();

/**
 * A pattern's copies, laid out from where the part sits, which for an unplaced part others are drawn on is the origin.
 * Copies keep their names from one layout to the next.
 */
function patternCopies(
  part: CadPart,
  pattern: CadPartPattern,
  at: CadPlacement | undefined,
  along: [number, number, number] | null
): CadPartCopy[] {
  const before = new Map((part.copies ?? []).map(copy => [copy.id, copy]));
  const axis = kAxes[pattern.axis];
  return Array.from({ length: Math.max(0, pattern.count - 1) }, (_, i) => i)
    .filter(i => !pattern.excluded?.includes(i + 1))
    .map(i => {
      const id = `${pattern.id}:${i + 1}`;
      const name = before.get(id)?.name;
      const copy: CadPartCopy = { id, pattern: pattern.id, ...(name && { name }) };
      if (at) {
        const position = [...at.position] as [number, number, number];
        if (along) for (const k of [0, 1, 2]) position[k]! += (i + 1) * pattern.spacing * along[k]!;
        else position[axis] += (i + 1) * pattern.spacing;
        copy.placement = { position, rotation: at.rotation };
      }
      return copy;
    });
}

/**
 * Lays out every part pattern's copies from where its part now is, so they follow the part, its count and its spacing.
 * A part's other copies stay as they are, ahead of the pattern's.
 */
export function resolvePartPatterns(document: CadDocument): CadDocument {
  let changed = false;
  const supports = cadDrawnOnSupports(document);
  const parts = document.parts.map(part => {
    if (!part.pattern && !part.copies?.some(copy => copy.pattern || copy.offset || copy.along || copy.mirror)) return part;
    const at = effectivePlacement(part, supports);
    // A transformed copy sits where its offset puts it from the part.
    const own = (part.copies ?? [])
      .filter(copy => !copy.pattern)
      .map(copy => {
        // Along a picked direction, the offset follows from where that face is now.
        const vector = copy.along && cadDirectionVector(document, copy.along);
        if (copy.along && vector)
          copy = {
            ...copy,
            offset: { position: vector.map(value => value * copy.along!.distance) as [number, number, number], rotation: [0, 0, 0, 1] },
          };
        // A mirror image sits across its plane from where the part is now.
        if (copy.mirror) {
          const frame = copy.mirror.datum ? cadDatumFrame(document, copy.mirror.datum) : cadFaceFrame(document, copy.mirror.across);
          if (!at || !frame || 'error' in frame) return copy;
          return { ...copy, mirrored: true, placement: mirroredPlacement(at, frame) };
        }
        if (!copy.offset) return copy;
        const { placement: _placement, ...rest } = copy;
        if (!at) return rest;
        // Turned first, about a line through where the part is.
        const from = copy.turn ? turnAbout(at, copy.turn.about, copy.turn.axis, copy.turn.degrees) : at;
        const position = from.position.map((value, axis) => value + copy.offset!.position[axis]!) as [number, number, number];
        return { ...rest, placement: { position, rotation: from.rotation } };
      });
    const along = part.pattern?.direction ? cadDirectionVector(document, part.pattern.direction) : (part.pattern?.vector ?? null);
    const copies = [...own, ...(part.pattern ? patternCopies(part, part.pattern, at, along) : [])];
    if (JSON.stringify(copies) === JSON.stringify(part.copies ?? [])) return part;
    changed = true;
    const next: CadPart = { ...part, copies };
    if (!copies.length) delete next.copies;
    return next;
  });
  return changed ? { ...document, parts } : document;
}

/** Sets a part's pattern, or removes it with `null`, and lays its copies out. */
export function setPartPattern(document: CadDocument, partId: string, pattern: Omit<CadPartPattern, 'id'> | null): CadDocument {
  const next = resolvePartPatterns({
    ...document,
    revision: document.revision + 1,
    parts: document.parts.map(part => {
      if (part.id !== partId) return part;
      if (!pattern) {
        const next = { ...part };
        delete next.pattern;
        return next;
      }
      const next: CadPartPattern = {
        id: part.pattern?.id ?? newCadId(),
        ...(part.pattern?.excluded && { excluded: part.pattern.excluded }),
        ...pattern,
      };
      if (!next.countExpression) delete next.countExpression;
      if (!next.spacingExpression) delete next.spacingExpression;
      return { ...part, pattern: next };
    }),
  });
  return { ...next, version: cadDocumentVersion(next) };
}

/** Names one copy of a part, or gives it back the part's name with a number when `name` is empty. */
export function renamePartCopy(document: CadDocument, partId: string, copyId: string, name: string): CadDocument {
  return {
    ...document,
    revision: document.revision + 1,
    parts: document.parts.map(part =>
      part.id !== partId
        ? part
        : {
            ...part,
            copies: part.copies?.map(copy => {
              if (copy.id !== copyId) return copy;
              const next: CadPartCopy = { ...copy, name: name.trim() };
              if (!next.name) delete next.name;
              return next;
            }),
          }
    ),
  };
}

/** Adds a mirror image of a part across a plane or a face; its placement follows from both. */
export function addPartMirror(
  document: CadDocument,
  partId: string,
  across: NonNullable<CadPartCopy['mirror']>
): { document: CadDocument; id: string } {
  const id = newCadId();
  const copy: CadPartCopy = { id, mirrored: true, mirror: across.datum ? across : { across: across.across } };
  const next = {
    ...document,
    revision: document.revision + 1,
    parts: document.parts.map(part => (part.id === partId ? { ...part, copies: [...(part.copies ?? []), copy] } : part)),
  };
  return { document: resolvePartPatterns(next), id };
}
