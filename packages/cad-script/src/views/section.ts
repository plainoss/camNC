import { pointInPolygon, type CadDocument, type CadPoint, type EvaluatedCadPart } from '@wbcnc/cad';
import { cadViewBodies, svgNumber as n, svgText } from './geometry';

export interface CadSectionRequest {
  /** Physical part/copy name or its full ID. Names must be unique. */
  part: string;
  /** The evaluated cut's ID or an unambiguous prefix of it. */
  cut: string;
  /** Horizontal axis in the part's own sketch. */
  axis?: 'x' | 'y';
  /** Position along the other sketch axis, defaulting to the named cut's centre. */
  at?: number;
}
export interface CadSectionDrawing {
  part: string;
  cut: string;
  axis: 'x' | 'y';
  at: number;
  material: { from: number; to: number; low: number; high: number }[];
  svg: string;
}

/** Intersections of a polygon with the section's in-plane line; half-open edge rules count each vertex once. */
function intersections(loop: readonly CadPoint[], axis: 'x' | 'y', at: number): number[] {
  return loop.flatMap((a, index) => {
    const b = loop[(index + 1) % loop.length];
    const [au, av, bu, bv] = axis === 'x' ? [a.x, a.y, b.x, b.y] : [a.y, a.x, b.y, b.x];
    if ((av <= at && bv > at) || (bv <= at && av > at)) return [au + ((bu - au) * (at - av)) / (bv - av)];
    return [];
  });
}

/** True material in the section, with overlapping cuts united and islands left standing. */
function materialAt(part: EvaluatedCadPart, axis: 'x' | 'y', at: number): CadSectionDrawing['material'] {
  const loops = [part.outline, ...part.holes, ...(part.cuts ?? []).flatMap(cut => [cut.outline, ...cut.islands])];
  const breaks = [...new Set(loops.flatMap(loop => intersections(loop, axis, at)).map(value => Math.round(value * 1e9) / 1e9))].sort(
    (a, b) => a - b
  );
  const material: CadSectionDrawing['material'] = [];
  for (let index = 0; index + 1 < breaks.length; index++) {
    const from = breaks[index],
      to = breaks[index + 1];
    if (to - from < 1e-8) continue;
    const point = axis === 'x' ? { x: (from + to) / 2, y: at } : { x: at, y: (from + to) / 2 };
    if (!pointInPolygon(point, part.outline) || part.holes.some(hole => pointInPolygon(point, hole))) continue;
    const voids = (part.cuts ?? [])
      .filter(cut => pointInPolygon(point, cut.outline) && !cut.islands.some(island => pointInPolygon(point, island)))
      .map(cut =>
        cut.side === 'underside'
          ? [Math.max(0, cut.from), Math.min(part.thickness, cut.to)]
          : [Math.max(0, part.thickness - cut.to), Math.min(part.thickness, part.thickness - cut.from)]
      )
      .sort((a, b) => a[0] - b[0]);
    let low = 0;
    for (const [start, end] of [...voids, [part.thickness, part.thickness]]) {
      if (start > low + 1e-8) material.push({ from, to, low, high: start });
      low = Math.max(low, end);
    }
  }
  return material;
}

/** A local section through a named evaluated cut, so pocket floors can be measured rather than guessed from a box. */
export function renderCadSection(document: CadDocument, parts: readonly EvaluatedCadPart[], request: CadSectionRequest): CadSectionDrawing {
  const bodies = cadViewBodies(document, parts);
  const matching = bodies.filter(body => body.id === request.part || body.name === request.part);
  if (matching.length !== 1)
    throw new Error(
      matching.length
        ? `Part name ${request.part} is ambiguous; use its full ID.`
        : `No physical part ${request.part}. Choose ${bodies.map(body => body.name).join(', ')}.`
    );
  const body = matching[0],
    shape = body.shape;
  const exact = (shape.cuts ?? []).find(cut => cut.id === request.cut);
  const cuts = exact ? [exact] : (shape.cuts ?? []).filter(cut => cut.id.startsWith(request.cut));
  if (cuts.length !== 1)
    throw new Error(cuts.length ? `Cut handle ${request.cut} is ambiguous; use more of its ID.` : `No cut ${request.cut} on ${body.name}.`);
  const cut = cuts[0],
    axis = request.axis ?? 'x';
  const across = cut.outline.map(point => (axis === 'x' ? point.y : point.x));
  const at = request.at ?? (Math.min(...across) + Math.max(...across)) / 2;
  if (!Number.isFinite(at)) throw new Error('A section position must be finite.');
  if (!intersections(cut.outline, axis, at).length) throw new Error(`The section at ${at} does not cross cut ${request.cut}.`);
  const material = materialAt(shape, axis, at);
  const along = shape.outline.map(point => (axis === 'x' ? point.x : point.y));
  const left = Math.min(...along),
    width = Math.max(...along) - left,
    unit = Math.max(width, shape.thickness, 1) / 40;
  const title = `${body.name} · section along ${axis.toUpperCase()} at ${axis === 'x' ? 'Y' : 'X'}=${n(at)} mm`;
  const rectangles = material
    .map(
      cell =>
        `<rect class="material" x="${n(cell.from)}" y="${n(-cell.high)}" width="${n(cell.to - cell.from)}" height="${n(cell.high - cell.low)}" fill="#d7b889" stroke="#493a29" stroke-width="0.7" vector-effect="non-scaling-stroke"/>`
    )
    .join('');
  const floor = cut.through ? 0 : shape.thickness - cut.to;
  const caption = `Cut ${cut.id} · ${cut.through ? 'through' : `${n(cut.to - cut.from)} mm removed; ${n(floor)} mm floor below deepest cut`}`;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" role="img" aria-label="${svgText(title)}" viewBox="${n(left - 2 * unit)} ${n(-shape.thickness - 3 * unit)} ${n(width + 4 * unit)} ${n(shape.thickness + 6 * unit)}" font-family="sans-serif"><rect x="${n(left - 2 * unit)}" y="${n(-shape.thickness - 3 * unit)}" width="${n(width + 4 * unit)}" height="${n(shape.thickness + 6 * unit)}" fill="white"/><text x="${n(left)}" y="${n(-shape.thickness - unit)}" font-size="${n(unit)}">${svgText(title)}</text>${rectangles}<text x="${n(left)}" y="${n(2 * unit)}" font-size="${n(unit * 0.65)}">${svgText(caption)}</text></svg>\n`;
  return { part: body.name, cut: cut.id, axis, at, material, svg };
}
