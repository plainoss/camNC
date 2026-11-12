const whitespace = (char: string | undefined) => char === ' ' || char === '\t' || char === '\r' || char === '\n';
const letter = (char: string) => (char >= 'A' && char <= 'Z') || (char >= 'a' && char <= 'z');

/** Validate and remove the one optional initial XML declaration. The cursor only
 * advances: even an incomplete declaration with megabytes of whitespace is linear.
 * The supplied text is already decoded Unicode, so encoding/standalone metadata
 * needs no second interpretation by the XML parser. Other PIs remain forbidden.
 */
export function withoutSvgXmlDeclaration(source: string): string {
  const start = source.charCodeAt(0) === 0xfeff ? 1 : 0;
  if (!source.startsWith('<?xml', start)) return source;
  let cursor = start + 5;
  const invalid = (): never => {
    throw new Error('Invalid initial SVG XML declaration.');
  };
  const skipWhitespace = () => {
    const before = cursor;
    while (whitespace(source[cursor])) cursor++;
    return cursor > before;
  };
  const attribute = (name: string): string => {
    if (!source.startsWith(name, cursor)) return invalid();
    cursor += name.length;
    skipWhitespace();
    if (source[cursor++] !== '=') return invalid();
    skipWhitespace();
    const quote = source[cursor++];
    if (quote !== '"' && quote !== "'") return invalid();
    const valueStart = cursor;
    while (cursor < source.length && source[cursor] !== quote) cursor++;
    if (cursor === source.length) return invalid();
    const value = source.slice(valueStart, cursor++);
    return value;
  };
  if (!skipWhitespace()) return invalid();
  const version = attribute('version');
  if (version !== '1.0' && version !== '1.1') return invalid();
  let separated = skipWhitespace();
  if (source.startsWith('encoding', cursor)) {
    if (!separated) return invalid();
    const encoding = attribute('encoding');
    if (!encoding.length || !letter(encoding[0])) return invalid();
    for (const char of encoding)
      if (!letter(char) && !(char >= '0' && char <= '9') && char !== '.' && char !== '_' && char !== '-') return invalid();
    separated = skipWhitespace();
  }
  if (source.startsWith('standalone', cursor)) {
    if (!separated) return invalid();
    const standalone = attribute('standalone');
    if (standalone !== 'yes' && standalone !== 'no') return invalid();
    skipWhitespace();
  }
  if (!source.startsWith('?>', cursor)) return invalid();
  return source.slice(cursor + 2);
}
