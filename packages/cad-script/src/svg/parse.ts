import { DOMParser, type Element } from '@xmldom/xmldom';
import { geometryBounds } from './bounds';
import { identity, lengthMm, multiply, numbers, parseTransform, transformPoint, viewportMatrix, type Matrix } from './matrix';
import { parsePath } from './path';
import { preflightSvg } from './preflight';
import { withoutSvgXmlDeclaration } from './xmlDeclaration';
import { isOpaqueSvgPaint } from './paint';
import { filledContours } from './topology';
import { finite, SVG_LIMITS, type SvgContour, type SvgSketchAsset } from './types';
const svgNamespace = 'http://www.w3.org/2000/svg';
const common = [
  'id',
  'transform',
  'fill',
  'fill-rule',
  'stroke',
  'stroke-width',
  'stroke-linecap',
  'stroke-linejoin',
  'stroke-miterlimit',
  'xmlns',
];
const attrsByTag: Record<string, string[]> = {
  svg: ['width', 'height', 'viewBox', 'preserveAspectRatio', 'version'],
  g: [],
  path: ['d'],
  rect: ['x', 'y', 'width', 'height', 'rx', 'ry'],
  circle: ['cx', 'cy', 'r'],
  ellipse: ['cx', 'cy', 'rx', 'ry'],
  polygon: ['points'],
  polyline: ['points'],
  line: ['x1', 'y1', 'x2', 'y2'],
  title: [],
  desc: [],
};
interface Paint {
  fill: string;
  rule: 'nonzero' | 'evenodd';
  stroke: string;
}
function attributes(element: Element): Record<string, string> {
  const out: Record<string, string> = {};
  for (let i = 0; i < element.attributes.length; i++) {
    const attr = element.attributes.item(i)!;
    out[attr.name] = attr.value;
  }
  return out;
}
function shapePath(tag: string, a: Record<string, string>): string {
  const n = (key: string, fallback = 0) => (a[key] === undefined ? fallback : scalar(a[key]));
  if (tag === 'path') return a.d ?? '';
  if (tag === 'line') return `M${n('x1')} ${n('y1')} L${n('x2')} ${n('y2')}`;
  if (tag === 'polygon' || tag === 'polyline') {
    const points = numbers(a.points ?? '');
    if (points.length < 4 || points.length % 2) throw new Error('SVG polygon needs complete point pairs.');
    return `M${points[0]} ${points[1]} ${points.slice(2).reduce((s, v, i) => s + (i % 2 ? ' ' : ' L') + v, '')}${tag === 'polygon' ? ' Z' : ''}`;
  }
  if (tag === 'circle' || tag === 'ellipse') {
    const x = n('cx'),
      y = n('cy'),
      rx = n(tag === 'circle' ? 'r' : 'rx'),
      ry = tag === 'circle' ? rx : n('ry');
    if (rx <= 0 || ry <= 0) throw new Error('SVG ellipse radii must be positive.');
    return `M${x - rx} ${y} A${rx} ${ry} 0 1 0 ${x + rx} ${y} A${rx} ${ry} 0 1 0 ${x - rx} ${y} Z`;
  }
  const x = n('x'),
    y = n('y'),
    w = n('width'),
    h = n('height');
  if (w <= 0 || h <= 0) throw new Error('SVG rectangle dimensions must be positive.');
  let rx = n('rx', n('ry')),
    ry = n('ry', rx);
  if (rx < 0 || ry < 0) throw new Error('SVG corner radii cannot be negative.');
  rx = Math.min(rx, w / 2);
  ry = Math.min(ry, h / 2);
  if (!rx || !ry) return `M${x} ${y} H${x + w} V${y + h} H${x} Z`;
  return `M${x + rx} ${y} H${x + w - rx} A${rx} ${ry} 0 0 1 ${x + w} ${y + ry} V${y + h - ry} A${rx} ${ry} 0 0 1 ${x + w - rx} ${y + h} H${x + rx} A${rx} ${ry} 0 0 1 ${x} ${y + h - ry} V${y + ry} A${rx} ${ry} 0 0 1 ${x + rx} ${y} Z`;
}
function scalar(source: string): number {
  // User-space geometry is unitless or px. Other absolute lengths are converted to CSS pixels.
  return /(?:mm|cm|in|pt|pc|q|px)\s*$/i.test(source)
    ? (lengthMm(source) * 96) / 25.4
    : (() => {
        const list = numbers(source);
        if (list.length !== 1) throw new Error('SVG geometry requires one number.');
        return list[0];
      })();
}
/** Parse a deliberately bounded, geometry-only SVG subset. Supplied XML is never rendered. */
export function parseSvgSketch(source: string): SvgSketchAsset {
  if (new TextEncoder().encode(source).length > SVG_LIMITS.bytes) throw new Error('SVG exceeds the 1 MB input limit.');
  const xml = withoutSvgXmlDeclaration(source);
  // Reject declarations and resources before XML parsing, including entity expansion and CSS references.
  if (/<!\s*(?:DOCTYPE|ENTITY)|<\s*\?|\b(?:href|style|class)\s*=|\burl\s*\(/i.test(xml))
    throw new Error('SVG declarations, styles and external resources are unsupported.');
  preflightSvg(xml);
  const document = new DOMParser({
    onError: (_level, message) => {
      throw new Error(`Invalid SVG XML: ${message}`);
    },
  }).parseFromString(xml, 'image/svg+xml');
  const root = document.documentElement;
  if (!root || root.localName !== 'svg' || root.namespaceURI !== svgNamespace)
    throw new Error('Expected an SVG root in the SVG namespace.');
  if (document.childNodes.length > 3) throw new Error('Unsupported SVG document nodes.');
  const rootAttrs = attributes(root),
    viewport = viewportMatrix(rootAttrs),
    contours: SvgContour[] = [],
    warnings: string[] = [];
  if (!rootAttrs.width && !rootAttrs.height)
    warnings.push('SVG user units use CSS pixels (96 per inch). Set import dimensions to choose the physical size.');
  let elements = 0,
    segments = 0,
    group = 0;
  const walk = (element: Element, parent: Matrix, paint: Paint, depth: number) => {
    if (++elements > SVG_LIMITS.elements || depth > SVG_LIMITS.depth) throw new Error('SVG element or nesting limit exceeded.');
    const tag = element.localName ?? '',
      a = attributes(element);
    if (element.namespaceURI !== svgNamespace || !Object.hasOwn(attrsByTag, tag) || (tag === 'svg' && depth !== 0))
      throw new Error(`Unsupported SVG element ${tag}.`);
    for (const name of Object.keys(a))
      if (!common.includes(name) && !attrsByTag[tag].includes(name)) throw new Error(`Unsupported SVG attribute ${name}.`);
    if (a.xmlns && a.xmlns !== svgNamespace) throw new Error('Unsupported SVG namespace.');
    const rule = a['fill-rule'] ?? paint.rule;
    if (rule !== 'nonzero' && rule !== 'evenodd') throw new Error('Unsupported SVG fill rule.');
    const next: Paint = {
      fill: (a.fill ?? paint.fill).trim().toLowerCase(),
      rule,
      stroke: (a.stroke ?? paint.stroke).trim().toLowerCase(),
    };
    if (!isOpaqueSvgPaint(next.fill)) throw new Error('Unsupported SVG paint.');
    if (next.stroke !== 'none') throw new Error('SVG strokes are unsupported. Convert strokes to closed filled outlines first.');
    const matrix = multiply(parent, a.transform ? parseTransform(a.transform) : identity);
    if (tag !== 'svg' && tag !== 'g' && tag !== 'title' && tag !== 'desc') {
      const paths = parsePath(shapePath(tag, a));
      group++;
      for (const path of paths) {
        // SVG implicitly closes filled subpaths. Keep that exact fill behavior explicitly in CAD.
        if (!path.closed && path.segments.length) {
          const first = path.segments[0].points[0],
            last = path.segments.at(-1)!.points.at(-1)!;
          if (Math.hypot(first[0] - last[0], first[1] - last[1]) > 1e-10) path.segments.push({ kind: 'line', points: [last, first] });
          path.closed = true;
        }
        segments += path.segments.length;
        if (segments > SVG_LIMITS.segments) throw new Error('SVG exceeds the 1024 segment limit.');
        if (next.fill === 'none') throw new Error('Unfilled SVG geometry is unsupported. Use closed filled outlines.');
        contours.push({
          ...path,
          group,
          fillRule: rule,
          segments: path.segments.map(s => ({ ...s, points: s.points.map(p => transformPoint(matrix, p)) }) as typeof s),
        });
      }
    }
    for (let child = element.firstChild; child; child = child.nextSibling) {
      if (child.nodeType === 1) {
        if (tag === 'title' || tag === 'desc') throw new Error('Geometry inside SVG descriptive elements is unsupported.');
        walk(child as Element, matrix, next, depth + 1);
      } else if (child.nodeType !== 8 && child.nodeType !== 3) throw new Error('Unsupported SVG node.');
      else if (child.nodeType === 3 && tag !== 'title' && tag !== 'desc' && child.nodeValue?.trim())
        throw new Error('SVG text geometry is unsupported.');
    }
  };
  walk(root, viewport, { fill: 'black', rule: 'nonzero', stroke: 'none' }, 0);
  const allBounds = geometryBounds(contours.flatMap(c => c.segments));
  // The importer does not perform clipping. Refuse geometry outside an explicitly
  // sized root viewport rather than importing material that the SVG hides.
  const box = rootAttrs.viewBox ? numbers(rootAttrs.viewBox) : undefined;
  let viewportWidth = rootAttrs.width ? lengthMm(rootAttrs.width) : undefined;
  let viewportHeight = rootAttrs.height ? lengthMm(rootAttrs.height) : undefined;
  if (box) {
    if (viewportWidth !== undefined && viewportHeight === undefined) viewportHeight = (viewportWidth * box[3]) / box[2];
    if (viewportHeight !== undefined && viewportWidth === undefined) viewportWidth = (viewportHeight * box[2]) / box[3];
    viewportWidth ??= (box[2] * 25.4) / 96;
    viewportHeight ??= (box[3] * 25.4) / 96;
  }
  if (
    (viewportWidth !== undefined && (allBounds.at[0] < -1e-7 || allBounds.at[0] + allBounds.size[0] > viewportWidth + 1e-7)) ||
    (viewportHeight !== undefined &&
      (allBounds.at[1] > 1e-7 || allBounds.at[1] + allBounds.size[1] > 1e-7 || allBounds.at[1] < -viewportHeight - 1e-7))
  )
    throw new Error('SVG geometry extends outside its viewport; clipping is unsupported.');
  const filled = filledContours(contours),
    bounds = geometryBounds(filled.flatMap(c => c.segments));
  [...bounds.at, ...bounds.size].forEach(n => finite(n));
  if (bounds.size.some(n => n <= 0)) throw new Error('SVG needs nonzero two-dimensional filled geometry.');
  if (filled.length !== contours.length) warnings.push('Redundant interior boundaries removed according to SVG fill rules.');
  return { version: 1, units: 'mm', contours: filled, bounds, warnings };
}
