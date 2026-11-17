import { addLine, createCadPart } from './document';
import { cadSketchRegions, isCadPart } from './features';
import { cadFaceSketches, faceIsUnderside, flipUnderside } from './featureModel';
import { evaluateCadPart, pointInPolygon } from './geometry';
import { regionInteriorPoint } from './sketchRegions';
import { cadCuts } from './featureModel';
import type { CadDocument, CadPart, EvaluatedCadPart } from './types';

/**
 * Splits each part a Remove's through cuts run across, edge to edge, into its pieces, as the reference does: the part
 * keeps the first piece, and each other piece is a part of its own, named as a new part is. Pieces from an earlier
 * resolve are made again, keeping their names; a part no longer split gets its whole self back.
 */
export function withPartPieces(document: CadDocument, earlier: CadDocument = document): CadDocument {
  const before = new Map(earlier.parts.filter(part => part.pieceOf).map(part => [part.id, part]));
  let parts = withoutPartPieces(document).parts;
  // Named as a new part is, after the parts listed: a Remove's or a sketch's own name isn't a part's.
  const names = new Set(parts.filter(part => isCadPart(part)).map(part => part.name));
  const made: CadPart[] = [];
  parts = parts.map(part => {
    // A Split's far side is a part of its own; the part keeps the near side (`pieceProfile`).
    const far = splitHalves(part)?.far;
    if (far) {
      const id = `${part.id}-${part.split!.id}`;
      let name = before.get(id)?.name;
      for (let n = 1; !name || names.has(name); n++) name = `Part ${n}`;
      names.add(name);
      made.push(pieceOfPart(part, id, name, far, part.split!.id));
      return part;
    }
    const split = severed(part);
    if (!split) return part;
    const [kept, ...others] = split.pieces;
    const pieces = others.map(({ points }, index): CadPart => {
      const id = `${part.id}-${split.by}-${index + 1}`;
      let name = before.get(id)?.name;
      for (let n = 1; !name || names.has(name); n++) name = `Part ${n}`;
      names.add(name);
      return pieceOfPart(part, id, name, points, split.by);
    });
    made.push(...pieces);
    return { ...part, piece: { sketchId: split.sketchId, regionId: kept!.id, by: split.by } };
  });
  if (!made.length && parts.every((part, i) => part === document.parts[i]) && parts.length === document.parts.length) return document;
  return { ...document, parts: [...parts, ...made] };
}

/** A piece of `part` split off by step `by`: a part of its own, drawn as `points`, in the part's place. */
function pieceOfPart(part: CadPart, id: string, name: string, points: { x: number; y: number }[], by: string): CadPart {
  let sketch = createCadPart(name, part.thickness).sketch;
  points.forEach((a, i) => {
    const b = points[(i + 1) % points.length]!;
    sketch = addLine(sketch, { x1: a.x, y1: a.y, x2: b.x, y2: b.y });
  });
  // Its own outline, whole: none of the part's picked regions, features, copies, patterns or its split.
  const {
    features: _features,
    copies: _copies,
    pattern: _pattern,
    regions: _regions,
    addedRegions: _added,
    fillets: _fillets,
    split: _split,
    piece: _piece,
    ...shape
  } = part;
  return { ...shape, id, name, sketch, pieceOf: { partId: part.id, by } } as CadPart;
}

/** A polygon's side of a line: the points with (p − o)·n ≥ 0, cut off where the line crosses it. */
export function clipToSide(points: { x: number; y: number }[], line: { x: number; y: number; nx: number; ny: number }) {
  const side = (p: { x: number; y: number }) => (p.x - line.x) * line.nx + (p.y - line.y) * line.ny;
  const kept: { x: number; y: number }[] = [];
  points.forEach((a, i) => {
    const b = points[(i + 1) % points.length]!;
    const sa = side(a),
      sb = side(b);
    if (sa >= 0) kept.push(a);
    if (sa >= 0 !== sb >= 0) {
      const t = sa / (sa - sb);
      kept.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
    }
  });
  // A crossing at a corner is that corner: each point once, the last not the first again.
  const same = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.hypot(a.x - b.x, a.y - b.y) < 1e-6;
  const distinct = kept.filter((p, i) => i === 0 || !same(p, kept[i - 1]!));
  while (distinct.length > 1 && same(distinct[0]!, distinct.at(-1)!)) distinct.pop();
  return distinct;
}

const area = (points: { x: number; y: number }[]) =>
  Math.abs(points.reduce((sum, a, i) => sum + a.x * points[(i + 1) % points.length]!.y - points[(i + 1) % points.length]!.x * a.y, 0)) / 2;

/**
 * The two sides of a part its Split's plane cuts it into, in its sketch's coordinates: `near`, which it keeps, and
 * `far`. None when it has no Split, the plane misses it, or doesn't stand across its sketch plane.
 */
export function splitHalves(part: CadPart): { near: { x: number; y: number }[]; far: { x: number; y: number }[] } | null {
  const line = part.split && !part.split.suppressed ? part.split.line : undefined;
  if (!line) return null;
  const outline = evaluateCadPart({ ...part, split: undefined } as CadPart).part?.outline;
  if (!outline) return null;
  const near = clipToSide(outline, line);
  const far = clipToSide(outline, { ...line, nx: -line.nx, ny: -line.ny });
  return area(near) > 1e-6 && area(far) > 1e-6 ? { near, far } : null;
}

/** The design with its parts whole again: no pieces split off, and no part keeping only one of its pieces. */
export function withoutPartPieces(document: CadDocument): CadDocument {
  if (!document.parts.some(part => part.pieceOf || part.piece)) return document;
  return {
    ...document,
    parts: document.parts
      .filter(part => !part.pieceOf)
      .map(part => {
        if (!part.piece) return part;
        const { piece: _piece, ...whole } = part;
        return whole;
      }),
  };
}

/** The pieces a part's through cuts from one face sketch leave of it, when they run across it and leave several. */
function severed(part: CadPart): { sketchId: string; by: string; pieces: { id: string; points: { x: number; y: number }[] }[] } | null {
  const cuts = cadCuts(part).filter(cut => cut.depth === 'through' && cut.removedBy && !cut.suppressed);
  if (!cuts.length) return null;
  const outline = evaluateCadPart(part).part?.outline;
  if (!outline) return null;
  for (const face of cadFaceSketches(part)) {
    const own = cuts.filter(cut => cut.sketchId === face.sketch.id);
    if (!own.length) continue;
    const regions = cadSketchRegions(part, face.sketch.id, outline);
    const cut = new Set(own.map(c => c.regionId));
    // Cut right across, the face is left in pieces with nothing around them: a through hole leaves the face whole.
    const left = regions.filter(region => !cut.has(region.id));
    if (left.length < 2 || left.some(region => region.holes.length)) continue;
    // In order across the face, so which piece the part keeps doesn't depend on how its sketch was drawn.
    const corner = (points: { x: number; y: number }[]) => [Math.min(...points.map(p => p.x)), Math.min(...points.map(p => p.y))];
    left.sort((a, b) => corner(a.points)[0]! - corner(b.points)[0]! || corner(a.points)[1]! - corner(b.points)[1]!);
    const under = faceIsUnderside(part, face.on);
    return {
      sketchId: face.sketch.id,
      by: own[0]!.removedBy!,
      pieces: left.map(region => ({ id: region.id, points: under ? flipUnderside(region.points) : region.points })),
    };
  }
  return null;
}

/** A split part's own piece as its profile: that region's outline, with the cuts that split it off taken out. */
export function pieceProfile(part: CadPart, profile: EvaluatedCadPart): { part: CadPart; profile: EvaluatedCadPart } {
  // A Split part keeps the near side of its plane, with the holes that lie there.
  const line = part.split && !part.split.suppressed ? part.split.line : undefined;
  if (line) {
    const near = clipToSide(profile.outline, line);
    const far = clipToSide(profile.outline, { ...line, nx: -line.nx, ny: -line.ny });
    if (area(near) > 1e-6 && area(far) > 1e-6) {
      const onNear = (points: { x: number; y: number }[]) =>
        points.every(p => (p.x - line.x) * line.nx + (p.y - line.y) * line.ny >= -1e-9);
      const loop = profile.loops.find(candidate => candidate.kind === 'outer');
      return {
        part,
        profile: {
          ...profile,
          outline: near,
          holes: profile.holes.filter(onNear),
          loops: [
            { id: loop?.id ?? `${part.id}:profile`, entityIds: loop?.entityIds ?? [], points: near, kind: 'outer' },
            ...profile.loops.filter(candidate => candidate.kind !== 'outer' && onNear(candidate.points)),
          ],
        },
      };
    }
  }
  const piece = part.piece;
  if (!piece) return { part, profile };
  const regions = cadSketchRegions(part, piece.sketchId, profile.outline);
  const region = regions.find(candidate => candidate.id === piece.regionId);
  const face = cadFaceSketches(part).find(candidate => candidate.sketch.id === piece.sketchId);
  if (!region || !face) return { part, profile };
  const outline = faceIsUnderside(part, face.on) ? flipUnderside(region.points) : region.points;
  // The face's other regions are the other pieces and the cuts between them: none of them is this piece's.
  const elsewhere = new Set(
    regions
      .filter(candidate => {
        const inside = regionInteriorPoint(candidate.points);
        return candidate.id !== region.id && !(inside && pointInPolygon(inside, region.points));
      })
      .map(candidate => candidate.id)
  );
  const features = part.features?.filter(
    feature => !(feature.type === 'cut' && feature.sketchId === piece.sketchId && elsewhere.has(feature.regionId))
  );
  const loop = profile.loops.find(candidate => candidate.kind === 'outer');
  return {
    part: { ...part, ...(features && { features }) },
    profile: {
      ...profile,
      outline,
      holes: [],
      loops: [{ id: loop?.id ?? `${part.id}:profile`, entityIds: loop?.entityIds ?? [], points: outline, kind: 'outer' }],
    },
  };
}
