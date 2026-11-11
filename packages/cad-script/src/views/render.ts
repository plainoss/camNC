import type { CadDocument, EvaluatedCadPart } from '@wbcnc/cad';
import { cadViewBodies, cadViewLines, svgNumber as n, svgText, type CadViewLine } from './geometry';

import { normalizeCadViewSelection, type CadViewName, type CadViewSelection } from './selection';
export { normalizeCadViewSelection, type CadViewName, type CadViewSelection } from './selection';
export interface CadDrawing {
  name: CadViewName;
  svg: string;
  /** Coordinates shown on the drawing; millimetres, not tessellation pixel units. */
  axes: [string, string];
  bounds: { at: [number, number]; size: [number, number] };
}
const projections: { name: CadViewName; axes: [string, string]; u: number; v: number }[] = [
  { name: 'top', axes: ['X', 'Y'], u: 0, v: 1 },
  { name: 'front', axes: ['X', 'Z'], u: 0, v: 2 },
  { name: 'right', axes: ['Y', 'Z'], u: 1, v: 2 },
];

function projectedPaths(lines: readonly CadViewLine[], u: number, v: number): string {
  return lines
    .map(line => {
      const projected = line.points.map(point => [n(point[u]), n(-point[v])]);
      if (projected.length < 2 || projected.every(point => point[0] === projected[0][0] && point[1] === projected[0][1])) return '';
      const path = projected.map((point, index) => `${index ? 'L' : 'M'}${point.join(' ')}`).join('');
      const stroke = line.kind === 'outline' ? '#4b4132' : line.kind === 'hole' ? '#b44424' : '#155f91';
      return `<path class="${line.kind}"${line.cut ? ` data-cut="${svgText(line.cut)}"` : ''} d="${path}${line.closed ? 'Z' : ''}" fill="none" stroke="${stroke}" vector-effect="non-scaling-stroke" stroke-width="1.2"/>`;
    })
    .join('\n');
}

/** Orthographic line drawings of real evaluated contours, including pockets and holes on all physical copies. */
export function renderCadViews(
  document: CadDocument,
  parts: readonly EvaluatedCadPart[],
  selection: CadViewSelection = true
): CadDrawing[] {
  const selected = normalizeCadViewSelection(selection);
  // Skip contour projection entirely when the caller requests no images.
  if (!selected.length) return [];
  const bodies = cadViewBodies(document, parts);
  const byBody = bodies.map(body => ({ body, lines: cadViewLines(body) }));
  const points = byBody.flatMap(body => body.lines.flatMap(line => line.points));
  return selected
    .map(view => projections.find(projection => projection.name === view)!)
    .map(({ name, axes, u, v }): CadDrawing => {
      const xs = points.map(point => point[u]),
        ys = points.map(point => point[v]);
      const low: [number, number] = points.length ? [Math.min(...xs), Math.min(...ys)] : [0, 0];
      const high: [number, number] = points.length ? [Math.max(...xs), Math.max(...ys)] : [1, 1];
      const width = high[0] - low[0],
        height = high[1] - low[1],
        unit = Math.max(width, height) / 40;
      const margin = 3 * unit,
        title = `${name.toUpperCase()} · ${axes[0]} right, ${axes[1]} up · ${n(width)} × ${n(height)} mm`;
      const caption = 'Evaluated outlines and cuts · transparent line drawing · mm';
      const groups = byBody
        .map(
          ({ body, lines }) => `<g data-body="${svgText(body.name)}"><title>${svgText(body.name)}</title>${projectedPaths(lines, u, v)}</g>`
        )
        .join('\n');
      const svg = `<svg xmlns="http://www.w3.org/2000/svg" role="img" aria-label="${svgText(title)}" viewBox="${n(low[0] - margin)} ${n(-high[1] - 3 * unit)} ${n(width + 2 * margin)} ${n(height + 6 * unit)}" font-family="sans-serif"><rect x="${n(low[0] - margin)}" y="${n(-high[1] - 3 * unit)}" width="${n(width + 2 * margin)}" height="${n(height + 6 * unit)}" fill="white"/><text x="${n(low[0])}" y="${n(-high[1] - 1.2 * unit)}" font-size="${n(unit)}">${svgText(title)}</text>${groups}<text x="${n(low[0])}" y="${n(-low[1] + 2 * unit)}" font-size="${n(unit * 0.7)}">${caption}</text></svg>\n`;
      return { name, svg, axes, bounds: { at: low, size: [width, height] } };
    });
}
