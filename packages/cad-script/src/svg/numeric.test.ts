import { describe, expect, it } from 'vitest';
import { lengthMm, numbers, parseTransform, transformPoint } from './matrix';
import { readSvgNumber } from './numeric';
import { isOpaqueSvgPaint } from './paint';
import { parseSvgSketch } from './parse';
import { SVG_LIMITS } from './types';

describe('linear SVG numeric grammar', () => {
  it('preserves signed decimals, fractions, trailing decimal points and exponents', () => {
    expect(numbers(' +12 -0.5 .25 1. -2.5e+2 5E-2 ')).toEqual([12, -0.5, 0.25, 1, -250, 0.05]);
    expect(numbers('1-2+.3.4,5')).toEqual([1, -2, 0.3, 0.4, 5]);
    expect(numbers('\t\r\n')).toEqual([]);
    const token = readSvgNumber('-.25e+2mm');
    expect(token).toEqual({ value: -25, end: 7 });
  });
  it.each(['.', '+', '-.', '1e', '1e+', '1e-', '1e2e3', '1x', '0x10', 'NaN', 'Infinity', '--1', ',1', '1,', '1,,2'])(
    'rejects malformed tokens: %s',
    source => {
      expect(() => numbers(source)).toThrow();
    }
  );
  it('bounds exported numeric helpers by input size and finite CAD ranges', () => {
    const oversized = ' '.repeat(SVG_LIMITS.bytes + 1);
    for (const parse of [numbers, lengthMm, parseTransform]) expect(() => parse(oversized)).toThrow(/input limit/);
    for (const source of ['1e9999', '1000001', '-1000001']) expect(() => numbers(source)).toThrow(/finite range/);
  });
});

describe('SVG absolute lengths', () => {
  it.each([
    ['96', 25.4],
    ['96PX', 25.4],
    ['1mm', 1],
    ['1CM', 10],
    ['1in', 25.4],
    ['72PT', 25.4],
    ['6pc', 25.4],
    ['4Q', 1],
    [' +.5e1 mm ', 5],
    ['1.\tMM', 1],
    ['.25E+2mm', 25],
  ] as const)('preserves conversion of %s', (source, mm) => expect(lengthMm(source)).toBeCloseTo(mm, 10));
  it.each(['', ' ', '.mm', '1e mm', '1e+2x', '1em', '1%', '1mmx', '1 mm mm', '1 2mm', '1.2.3mm', '1,2mm', '1e9999mm'])(
    'rejects invalid lengths: %s',
    source => {
      expect(() => lengthMm(source)).toThrow();
    }
  );
});

describe('SVG affine transforms', () => {
  it('preserves multiplication order, rotation centers, skew and reflections', () => {
    expect(transformPoint(parseTransform('translate(10,20) scale(2 3)'), [1, 1])).toEqual([12, 23]);
    expect(transformPoint(parseTransform('scale(2 3),translate(10 20)'), [1, 1])).toEqual([22, 63]);
    expect(transformPoint(parseTransform('matrix(1 2 3 4 5 6)'), [7, 8])).toEqual([36, 52]);
    const rotated = transformPoint(parseTransform('rotate(9e1 10 20)'), [11, 20]);
    expect(rotated[0]).toBeCloseTo(10, 10);
    expect(rotated[1]).toBeCloseTo(21, 10);
    const reflected = transformPoint(parseTransform('scale(-2 3)skewX(45)'), [2, 4]);
    expect(reflected[0]).toBeCloseTo(-12, 10);
    expect(reflected[1]).toBeCloseTo(12, 10);
    expect(transformPoint(parseTransform('skewY(45)'), [2, 4])[1]).toBeCloseTo(6, 10);
    expect(parseTransform(' translate ( +.5e1 , -2. ) ')).toEqual([1, 0, 0, 1, 5, -2]);
    expect(parseTransform(' \t\n ')).toEqual([1, 0, 0, 1, 0, 0]);
  });
  it.each([
    'translate',
    'translate(',
    'translate(1',
    'translate((1))',
    'translate(scale(2))',
    'translate(1))',
    'translate(1),',
    'translate(1,)',
    'translate(,1)',
    'translate(1,,2)',
    ',translate(1)',
    'translate(1),,scale(2)',
    'translate(1)junk',
    'translate1(1)',
    'translate(1e)',
    'translate(1 2 3)',
    'matrix(1 2 3)',
    'scale()',
    'skewZ(1)',
    'scale(0)',
    'matrix(1 1 1 1 0 0)',
  ])('rejects malformed or collapsed transforms: %s', source => expect(() => parseTransform(source)).toThrow());
});

describe('bounded hostile numeric inputs', () => {
  const longSpace = ' '.repeat(800_000),
    longDigits = '9'.repeat(800_000),
    longZeros = '0'.repeat(800_000);
  it('rejects long transform names, whitespace, missing/nested parentheses and bad numeric suffixes without echoing them', () => {
    for (const source of [
      'a'.repeat(800_000),
      'translate' + longSpace + 'x',
      'translate(' + longSpace,
      'translate(' + longSpace + '(1))',
      `translate(${longDigits}x)`,
    ]) {
      try {
        parseTransform(source);
        throw new Error('Expected rejected transform.');
      } catch (error) {
        expect(error).toBeInstanceOf(Error);
        expect((error as Error).message).not.toBe('Expected rejected transform.');
        expect((error as Error).message.length).toBeLessThan(120);
      }
    }
  });
  it('preserves long valid tokens and rejects long malformed lengths without timing thresholds', () => {
    expect(lengthMm('1' + longSpace + 'mm')).toBe(1);
    expect(lengthMm(longZeros + '1mm')).toBe(1);
    expect(parseTransform(`translate(${longZeros}1)`)).toEqual([1, 0, 0, 1, 1, 0]);
    for (const source of [longDigits + 'x', '1' + longSpace + 'x', longZeros + '1e+', longSpace + 'x'])
      expect(() => lengthMm(source)).toThrow();
  });
  it('rejects malformed RGB channels while retaining finite decimal/exponent/percentage forms', () => {
    for (const paint of [`rgb(${longDigits}x 0 0)`, `rgb(${longZeros}1x 0 0)`, 'rgb(1e+ 0 0)', 'rgb(1e9999 0 0)'])
      expect(isOpaqueSvgPaint(paint)).toBe(false);
    for (const paint of ['rgb(+.5e2 0 1.)', 'rgb(1e2%, 0%, .5%)', 'rgb(1,2,3)', `rgb(${longZeros}1 0 0)`])
      expect(isOpaqueSvgPaint(paint)).toBe(true);
  });
  it('rejects hostile attribute values through the complete SVG import path', () => {
    for (const attrs of [`transform="${'a'.repeat(800_000)}"`, `width="1${longSpace}x"`, `fill="rgb(${longDigits}x 0 0)"`]) {
      const source = `<svg xmlns="http://www.w3.org/2000/svg"><rect ${attrs} width="20" height="10"/></svg>`;
      // Width uses the root to avoid duplicate XML attributes in that regression.
      const input = attrs.startsWith('width=')
        ? `<svg xmlns="http://www.w3.org/2000/svg" ${attrs}><rect width="20" height="10"/></svg>`
        : source;
      expect(() => parseSvgSketch(input)).toThrow();
    }
  });
});
