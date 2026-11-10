import { SVG_LIMITS } from './types';
/** Linear bounded scan before XML tree allocation. Not an XML parser: the strict
 * parser still validates syntax. This only counts tags/depth and rejects incomplete
 * tokens without a backtracking expression on potentially malformed large input.
 */
export function preflightSvg(source: string): void {
  let cursor = 0,
    depth = 0,
    elements = 0;
  while (cursor < source.length) {
    const open = source.indexOf('<', cursor);
    if (open < 0) break;
    if (source.startsWith('<!--', open)) {
      const end = source.indexOf('-->', open + 4);
      if (end < 0) throw new Error('Invalid SVG XML comment.');
      cursor = end + 3;
      continue;
    }
    let quote = '',
      end = open + 1;
    for (; end < source.length; end++) {
      const char = source[end];
      if (quote) {
        if (char === quote) quote = '';
      } else if (char === '"' || char === "'") quote = char;
      else if (char === '<') throw new Error('Invalid SVG XML tag.');
      else if (char === '>') break;
    }
    if (end === source.length) throw new Error('Invalid SVG XML: incomplete tag.');
    const tag = source.slice(open, end + 1);
    if (!tag.startsWith('<?')) {
      if (/^<\s*\//.test(tag)) depth--;
      else {
        if (++elements > SVG_LIMITS.elements) throw new Error('SVG element limit exceeded.');
        if (++depth > SVG_LIMITS.depth + 1) throw new Error('SVG nesting limit exceeded.');
        if (/\/\s*>$/.test(tag)) depth--;
      }
    }
    cursor = end + 1;
  }
}
