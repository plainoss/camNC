import { SVG_LIMITS } from './types';
export const svgWhitespace = (char: string | undefined): boolean => char !== undefined && char.trim() === '';
export const svgLetter = (char: string | undefined): boolean =>
  char !== undefined && ((char >= 'A' && char <= 'Z') || (char >= 'a' && char <= 'z'));
const digit = (char: string | undefined): boolean => char !== undefined && char >= '0' && char <= '9';
export function boundSvgNumericText(source: string): void {
  if (source.length > SVG_LIMITS.bytes) throw new Error('SVG numeric text exceeds the input limit.');
}
/** Scan one decimal token with a monotonic cursor. The integer, fractional and
 * exponent digits occupy disjoint spans; no malformed suffix retries a prefix.
 * Callers validate separators/units and choose their own finite-value range.
 */
export function readSvgNumber(source: string, start = 0): { value: number; end: number } {
  boundSvgNumericText(source);
  let cursor = start;
  if (source[cursor] === '+' || source[cursor] === '-') cursor++;
  const integerStart = cursor;
  while (digit(source[cursor])) cursor++;
  const integerDigits = cursor - integerStart;
  let fractionalDigits = 0;
  if (source[cursor] === '.') {
    const fractionalStart = ++cursor;
    while (digit(source[cursor])) cursor++;
    fractionalDigits = cursor - fractionalStart;
  }
  if (!integerDigits && !fractionalDigits) throw new Error('Invalid SVG number.');
  if (source[cursor] === 'e' || source[cursor] === 'E') {
    cursor++;
    if (source[cursor] === '+' || source[cursor] === '-') cursor++;
    const exponentStart = cursor;
    while (digit(source[cursor])) cursor++;
    if (cursor === exponentStart) throw new Error('Invalid SVG exponent.');
  }
  return { value: Number(source.slice(start, cursor)), end: cursor };
}
