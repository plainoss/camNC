import { SVGPathData } from 'svg-pathdata';
import type { CommandA } from 'svg-pathdata';
import { SVG_LIMITS, finite, type SvgContour, type SvgPoint, type SvgSegment } from './types';
export function parsePath(source: string): Omit<SvgContour, 'group' | 'fillRule'>[] {
  // The byte limit is checked before this parser runs; limit commands before normalization too.
  const data = new SVGPathData(source);
  if (data.commands.length > SVG_LIMITS.segments) throw new Error('SVG path has too many commands.');
  data.toAbs().normalizeST().normalizeHVZ(false).annotateArcs();
  const paths: Omit<SvgContour, 'group' | 'fillRule'>[] = [];
  let current: SvgPoint = [0, 0],
    start: SvgPoint = [0, 0];
  let path: Omit<SvgContour, 'group' | 'fillRule'> | undefined;
  const add = (segment: SvgSegment) => {
    if (
      segment.kind === 'line' &&
      Math.hypot(segment.points[0][0] - segment.points[1][0], segment.points[0][1] - segment.points[1][1]) < 1e-10
    )
      return;
    if (!path) throw new Error('SVG path must begin with a move.');
    path.segments.push(segment);
  };
  for (const c of data.commands) {
    // An arc to its own start is a legal SVG no-op. Its center is undefined,
    // so skip the parser's annotated center before checking finite values.
    if (c.type === SVGPathData.ARC && c.x === current[0] && c.y === current[1]) continue;
    for (const value of Object.values(c)) if (typeof value === 'number') finite(value);
    if (c.type === SVGPathData.MOVE_TO) {
      current = [c.x, c.y];
      start = current;
      path = { segments: [], closed: false };
      paths.push(path);
      continue;
    }
    if (c.type === SVGPathData.CLOSE_PATH) {
      if (!path) throw new Error('SVG close command has no path.');
      if (Math.hypot(current[0] - start[0], current[1] - start[1]) > 1e-10) add({ kind: 'line', points: [current, start] });
      path.closed = true;
      current = start;
      continue;
    }
    if (path?.closed) {
      path = { segments: [], closed: false };
      paths.push(path);
      start = current;
    }
    if (c.type === SVGPathData.LINE_TO) add({ kind: 'line', points: [current, [c.x, c.y]] });
    else if (c.type === SVGPathData.CURVE_TO) add({ kind: 'bezier', points: [current, [c.x1, c.y1], [c.x2, c.y2], [c.x, c.y]] });
    else if (c.type === SVGPathData.QUAD_TO) add({ kind: 'bezier', points: [current, [c.x1, c.y1], [c.x, c.y]] });
    else if (c.type === SVGPathData.ARC) for (const segment of arcSegments(c, current)) add(segment);
    else throw new Error('Unsupported normalized SVG command.');
    current = [c.x, c.y];
  }
  return paths.filter(p => p.segments.length > 0);
}
function arcSegments(c: CommandA, from: SvgPoint): SvgSegment[] {
  if (Math.hypot(c.x - from[0], c.y - from[1]) < 1e-12) return [];
  if (c.rX === 0 || c.rY === 0) return [{ kind: 'line', points: [from, [c.x, c.y]] }];
  const a = (c.phi1! * Math.PI) / 180,
    b = (c.phi2! * Math.PI) / 180,
    rotation = (c.xRot * Math.PI) / 180;
  const steps = Math.ceil(Math.abs(b - a) / (Math.PI / 2));
  const ellipse = (angle: number, scale = 1): SvgPoint => {
    const x = c.rX * Math.cos(angle) * scale,
      y = c.rY * Math.sin(angle) * scale;
    return [
      finite(c.cX! + Math.cos(rotation) * x - Math.sin(rotation) * y),
      finite(c.cY! + Math.sin(rotation) * x + Math.cos(rotation) * y),
    ];
  };
  const result: SvgSegment[] = [];
  for (let i = 0; i < steps; i++) {
    const lo = a + ((b - a) * i) / steps,
      hi = a + ((b - a) * (i + 1)) / steps,
      w = Math.cos((hi - lo) / 2);
    result.push({
      kind: 'conic',
      points: [i === 0 ? from : ellipse(lo), ellipse((lo + hi) / 2, 1 / w), i === steps - 1 ? [c.x, c.y] : ellipse(hi)],
      rho: w / (1 + w),
    });
  }
  return result;
}
