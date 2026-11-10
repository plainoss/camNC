import { newCadId } from './document';
import { cadDocumentVersion } from './documentVersion';
import { cadMirrorFaceCopy, cadMirrorPlaneFrame } from './mirrorPlane';
import { cadPartReference } from './partReferences';
import { cadDrawnOnSupports, effectivePlacement } from './drawnOn';
import { mirroredPlacement, turnAbout } from './placement';
import { cadDirectionVector } from './directions';
import { circularPartPatternStep } from './circularPartPattern';
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
  const circular = pattern.circular;
  const angle = circular && circularPartPatternStep(circular, pattern.count);
  return Array.from({ length: Math.max(0, pattern.count - 1) }, (_, i) => i)
    .filter(i => !pattern.excluded?.includes(i + 1))
    .map(i => {
      const id = `${pattern.id}:${i + 1}`;
      const { name, suppressed } = before.get(id) ?? {};
      const copy: CadPartCopy = { id, pattern: pattern.id, ...(name && { name }), ...(suppressed && { suppressed }) };
      if (at) {
        if (circular) {
          copy.placement = turnAbout(at, circular.origin, circular.axis, (i + 1) * angle!);
          return copy;
        }
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
        if (copy.mirror) return copy;
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
  // Lay out pattern and transform copies first: a mirror must follow this edit's picked instance, not its old placement.
  const resolved = new Map<string, CadPartCopy>();
  const visiting = new Set<string>();
  const failed = new Set<string>();
  const resolve = (part: CadPart, copy: CadPartCopy): CadPartCopy | null => {
    const key = cadPartReference(part.id, copy.id);
    if (resolved.has(key)) return resolved.get(key)!;
    // Cyclic copy-face dependencies must not move on each regeneration.
    if (visiting.has(key) || failed.has(key)) return null;
    if (!copy.mirror) return copy;
    visiting.add(key);
    const on = copy.mirror.across;
    if ('partId' in on) {
      const support = cadMirrorFaceCopy({ ...document, parts }, cadPartReference(on.partId, on.copyId));
      if (support && !resolve(support.part, support.copy)) {
        failed.add(key);
        visiting.delete(key);
        return null;
      }
    }
    const current = {
      ...document,
      parts: parts.map(candidate => ({
        ...candidate,
        copies: candidate.copies?.map(c => resolved.get(cadPartReference(candidate.id, c.id)) ?? c),
      })),
    };
    const at = effectivePlacement(part, supports);
    const frame = at && cadMirrorPlaneFrame(current, copy.mirror);
    const next = frame && !('error' in frame) ? { ...copy, mirrored: true, placement: mirroredPlacement(at!, frame) } : copy;
    visiting.delete(key);
    resolved.set(key, next);
    return next;
  };
  const mirrored = parts.map(part => {
    const copies = part.copies?.map(copy => resolve(part, copy) ?? copy);
    if (JSON.stringify(copies) === JSON.stringify(part.copies)) return part;
    changed = true;
    return { ...part, copies };
  });
  return changed ? { ...document, parts: mirrored } : document;
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
