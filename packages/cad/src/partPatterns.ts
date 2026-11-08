import { newCadId } from './document';
import { cadDrawnOnSupports, effectivePlacement } from './drawnOn';
import type { CadDocument, CadPart, CadPartCopy, CadPartPattern, CadPlacement } from './types';

const kAxes = { x: 0, y: 1, z: 2 } as const;
/** The most pieces a pattern makes, counting the part itself. */
export const CAD_MAX_PART_PATTERN = 200;

/** What a copy is called: its own name, or the part's with a number counting the part as the first. */
export const cadCopyName = (part: Pick<CadPart, 'name' | 'copies'>, index: number): string =>
  part.copies?.[index]?.name ?? `${part.name} ${index + 2}`;

/**
 * A pattern's copies, laid out from where the part sits, which for an unplaced part others are drawn on is the origin.
 * Copies keep their names from one layout to the next.
 */
function patternCopies(part: CadPart, pattern: CadPartPattern, at: CadPlacement | undefined): CadPartCopy[] {
  const before = new Map((part.copies ?? []).map(copy => [copy.id, copy]));
  const axis = kAxes[pattern.axis];
  return Array.from({ length: Math.max(0, pattern.count - 1) }, (_, i) => {
    const id = `${pattern.id}:${i + 1}`;
    const name = before.get(id)?.name;
    const copy: CadPartCopy = { id, pattern: pattern.id, ...(name && { name }) };
    if (at) {
      const position = [...at.position] as [number, number, number];
      position[axis] += (i + 1) * pattern.spacing;
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
    if (!part.pattern && !part.copies?.some(copy => copy.pattern || copy.offset)) return part;
    const at = effectivePlacement(part, supports);
    // A transformed copy sits where its offset puts it from the part.
    const own = (part.copies ?? [])
      .filter(copy => !copy.pattern)
      .map(copy => {
        if (!copy.offset) return copy;
        const { placement: _placement, ...rest } = copy;
        if (!at) return rest;
        const position = at.position.map((value, axis) => value + copy.offset!.position[axis]!) as [number, number, number];
        return { ...rest, placement: { position, rotation: at.rotation } };
      });
    const copies = [...own, ...(part.pattern ? patternCopies(part, part.pattern, at) : [])];
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
  return resolvePartPatterns({
    ...document,
    revision: document.revision + 1,
    parts: document.parts.map(part => {
      if (part.id !== partId) return part;
      if (!pattern) {
        const next = { ...part };
        delete next.pattern;
        return next;
      }
      const next: CadPartPattern = { id: part.pattern?.id ?? newCadId(), ...pattern };
      if (!next.countExpression) delete next.countExpression;
      if (!next.spacingExpression) delete next.spacingExpression;
      return { ...part, pattern: next };
    }),
  });
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
