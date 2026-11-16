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
    const split = severed(part);
    if (!split) return part;
    const [kept, ...others] = split.pieces;
    const pieces = others.map(({ points }, index): CadPart => {
      const id = `${part.id}-${split.by}-${index + 1}`;
      let name = before.get(id)?.name;
      for (let n = 1; !name || names.has(name); n++) name = `Part ${n}`;
      names.add(name);
      let sketch = createCadPart(name, part.thickness).sketch;
      points.forEach((a, i) => {
        const b = points[(i + 1) % points.length]!;
        sketch = addLine(sketch, { x1: a.x, y1: a.y, x2: b.x, y2: b.y });
      });
      // Its own outline, whole: none of the part's picked regions, features, copies or patterns.
      const {
        features: _features,
        copies: _copies,
        pattern: _pattern,
        regions: _regions,
        addedRegions: _added,
        fillets: _fillets,
        ...shape
      } = part;
      return { ...shape, id, name, sketch, pieceOf: { partId: part.id, by: split.by } } as CadPart;
    });
    made.push(...pieces);
    return { ...part, piece: { sketchId: split.sketchId, regionId: kept!.id, by: split.by } };
  });
  if (!made.length && parts.every((part, i) => part === document.parts[i]) && parts.length === document.parts.length) return document;
  return { ...document, parts: [...parts, ...made] };
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
