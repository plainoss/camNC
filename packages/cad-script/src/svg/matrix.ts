import { finite, type SvgPoint } from './types';
import { boundSvgNumericText, readSvgNumber, svgLetter, svgWhitespace } from './numeric';
export type Matrix = [number, number, number, number, number, number];
export const identity: Matrix = [1, 0, 0, 1, 0, 0];
export function multiply(a: Matrix, b: Matrix): Matrix {
  return [
    a[0] * b[0] + a[2] * b[1],
    a[1] * b[0] + a[3] * b[1],
    a[0] * b[2] + a[2] * b[3],
    a[1] * b[2] + a[3] * b[3],
    a[0] * b[4] + a[2] * b[5] + a[4],
    a[1] * b[4] + a[3] * b[5] + a[5],
  ].map(n => finite(n, 'SVG transform')) as Matrix;
}
export function transformPoint(m: Matrix, p: SvgPoint): SvgPoint {
  return [finite(m[0] * p[0] + m[2] * p[1] + m[4]), finite(m[1] * p[0] + m[3] * p[1] + m[5])];
}
export function numbers(source: string): number[] {
  boundSvgNumericText(source);
  const values: number[] = [];
  let cursor = 0,
    commaPending = false;
  while (cursor < source.length) {
    if (svgWhitespace(source[cursor])) {
      cursor++;
      continue;
    }
    if (source[cursor] === ',') {
      if (!values.length || commaPending) throw new Error('Invalid SVG number-list separator.');
      commaPending = true;
      cursor++;
      continue;
    }
    const token = readSvgNumber(source, cursor);
    values.push(finite(token.value));
    commaPending = false;
    cursor = token.end;
  }
  if (commaPending) throw new Error('Incomplete SVG number list.');
  return values;
}
const transformNames = new Set(['matrix', 'translate', 'scale', 'rotate', 'skewX', 'skewY']);
export function parseTransform(source: string): Matrix {
  boundSvgNumericText(source);
  let cursor = 0,
    result = identity;
  const skipWhitespace = () => {
    while (svgWhitespace(source[cursor])) cursor++;
  };
  skipWhitespace();
  while (cursor < source.length) {
    const nameStart = cursor;
    while (svgLetter(source[cursor])) {
      cursor++;
      // All supported names fit in nine characters. Do not copy or echo a hostile long name.
      if (cursor - nameStart > 9) throw new Error('Unsupported SVG transform.');
    }
    const kind = source.slice(nameStart, cursor);
    if (!transformNames.has(kind)) throw new Error('Unsupported SVG transform.');
    skipWhitespace();
    if (source[cursor++] !== '(') throw new Error('Invalid SVG transform.');
    const valuesStart = cursor;
    while (cursor < source.length && source[cursor] !== ')') {
      if (source[cursor] === '(') throw new Error('Nested SVG transform parentheses are unsupported.');
      cursor++;
    }
    if (cursor === source.length) throw new Error('Incomplete SVG transform.');
    const v = numbers(source.slice(valuesStart, cursor++));
    let m: Matrix;
    if (kind === 'matrix' && v.length === 6) m = v as Matrix;
    else if (kind === 'translate' && (v.length === 1 || v.length === 2)) m = [1, 0, 0, 1, v[0], v[1] ?? 0];
    else if (kind === 'scale' && (v.length === 1 || v.length === 2)) m = [v[0], 0, 0, v[1] ?? v[0], 0, 0];
    else if (kind === 'rotate' && (v.length === 1 || v.length === 3)) {
      const a = (v[0] * Math.PI) / 180,
        c = Math.cos(a),
        s = Math.sin(a),
        x = v[1] ?? 0,
        y = v[2] ?? 0;
      m = [c, s, -s, c, x - c * x + s * y, y - s * x - c * y];
    } else if ((kind === 'skewX' || kind === 'skewY') && v.length === 1) {
      const t = Math.tan((v[0] * Math.PI) / 180);
      m = kind === 'skewX' ? [1, 0, t, 1, 0, 0] : [1, t, 0, 1, 0, 0];
    } else throw new Error('Invalid SVG transform parameters.');
    result = multiply(result, m);
    skipWhitespace();
    if (source[cursor] === ',') {
      cursor++;
      skipWhitespace();
      if (cursor === source.length) throw new Error('Incomplete SVG transform list.');
    }
  }
  if (Math.abs(result[0] * result[3] - result[1] * result[2]) < 1e-12) throw new Error('SVG transform collapses geometry.');
  return result;
}
const mmPerUnit: Record<string, number> = { '': 25.4 / 96, px: 25.4 / 96, mm: 1, cm: 10, in: 25.4, pt: 25.4 / 72, pc: 25.4 / 6, q: 0.25 };
export function lengthMm(source: string): number {
  boundSvgNumericText(source);
  const text = source.trim();
  let token: ReturnType<typeof readSvgNumber>;
  try {
    token = readSvgNumber(text);
  } catch {
    throw new Error('SVG dimensions require absolute units; percentages and relative units are unsupported.');
  }
  const unit = text.slice(token.end).trim().toLowerCase();
  if (!Object.hasOwn(mmPerUnit, unit))
    throw new Error('SVG dimensions require absolute units; percentages and relative units are unsupported.');
  return finite(token.value * mmPerUnit[unit]);
}
/** Root viewport mapping follows SVG meet/slice alignment, then flips Y for CAD. */
export function viewportMatrix(attrs: Record<string, string>): Matrix {
  const box = attrs.viewBox ? numbers(attrs.viewBox) : undefined;
  if (box && (box.length !== 4 || box[2] <= 0 || box[3] <= 0)) throw new Error('SVG viewBox needs four numbers with positive dimensions.');
  let width = attrs.width ? lengthMm(attrs.width) : undefined;
  let height = attrs.height ? lengthMm(attrs.height) : undefined;
  if ((width !== undefined && width <= 0) || (height !== undefined && height <= 0))
    throw new Error('SVG viewport dimensions must be positive.');
  if (!box) return [25.4 / 96, 0, 0, -25.4 / 96, 0, 0];
  if (width !== undefined && height === undefined) height = (width * box[3]) / box[2];
  if (height !== undefined && width === undefined) width = (height * box[2]) / box[3];
  width ??= (box[2] * 25.4) / 96;
  height ??= (box[3] * 25.4) / 96;
  let sx = width / box[2],
    sy = height / box[3],
    dx = 0,
    dy = 0;
  const aspect = (attrs.preserveAspectRatio ?? 'xMidYMid meet').trim();
  if (aspect !== 'none') {
    const match = /^(xMin|xMid|xMax)(YMin|YMid|YMax)(?:\s+(meet|slice))?$/.exec(aspect);
    if (!match) throw new Error('Unsupported SVG preserveAspectRatio.');
    sx = sy = match[3] === 'slice' ? Math.max(sx, sy) : Math.min(sx, sy);
    dx = (width - box[2] * sx) * (match[1] === 'xMin' ? 0 : match[1] === 'xMid' ? 0.5 : 1);
    dy = (height - box[3] * sy) * (match[2] === 'YMin' ? 0 : match[2] === 'YMid' ? 0.5 : 1);
    // Clipped slice output is deliberately unsupported: importing hidden material is unsafe.
    if (match[3] === 'slice' && (Math.abs(width - box[2] * sx) > 1e-8 || Math.abs(height - box[3] * sy) > 1e-8))
      throw new Error('SVG slice clipping is unsupported.');
  }
  return [sx, 0, 0, -sy, dx - box[0] * sx, -dy + box[1] * sy];
}
