/** A sum of variables times numbers, plus a number of mm: what most furniture dimensions are. */
interface Linear {
  constant: number;
  terms: Map<string, number>;
}

const kEpsilon = 1e-9;

/** Reads `width - 2*board + 10mm` as a sum, or undefined for anything else, such as a function or a unit other than mm. */
function parseLinear(text: string): Linear | undefined {
  const tokens = text.match(/\d+(?:\.\d+)?(?:mm)?|[A-Za-z_]\w*|[-+*/()]|\S/g) ?? [];
  let i = 0;
  const peek = () => tokens[i];
  const scale = (value: Linear, by: number): Linear => ({
    constant: value.constant * by,
    terms: new Map([...value.terms].map(([name, coefficient]) => [name, coefficient * by])),
  });
  const add = (a: Linear, b: Linear, sign: number): Linear => {
    const terms = new Map(a.terms);
    for (const [name, coefficient] of b.terms) terms.set(name, (terms.get(name) ?? 0) + sign * coefficient);
    return { constant: a.constant + sign * b.constant, terms };
  };
  const constantOf = (value: Linear) => (value.terms.size ? undefined : value.constant);
  const factor = (): Linear | undefined => {
    const token = tokens[i++];
    if (token === undefined) return undefined;
    if (token === '-' || token === '+') {
      const inner = factor();
      return inner && (token === '-' ? scale(inner, -1) : inner);
    }
    if (token === '(') {
      const inner = sum();
      return tokens[i++] === ')' ? inner : undefined;
    }
    if (/^\d/.test(token)) return { constant: parseFloat(token), terms: new Map() };
    // A word followed by ( is a function call, which isn't a sum.
    if (/^[A-Za-z_]/.test(token) && peek() !== '(') return { constant: 0, terms: new Map([[token, 1]]) };
    return undefined;
  };
  const product = (): Linear | undefined => {
    let left = factor();
    while (left && (peek() === '*' || peek() === '/')) {
      const op = tokens[i++];
      const right = factor();
      if (!right) return undefined;
      if (op === '*') {
        const [k, other] = constantOf(left) !== undefined ? [constantOf(left)!, right] : [constantOf(right), left];
        if (k === undefined) return undefined;
        left = scale(other, k);
      } else {
        const k = constantOf(right);
        if (k === undefined || Math.abs(k) < kEpsilon) return undefined;
        left = scale(left, 1 / k);
      }
    }
    return left;
  };
  const sum = (): Linear | undefined => {
    let left = product();
    while (left && (peek() === '+' || peek() === '-')) {
      const sign = tokens[i++] === '-' ? -1 : 1;
      const right = product();
      if (!right) return undefined;
      left = add(left, right, sign);
    }
    return left;
  };
  const result = sum();
  return result && i === tokens.length ? result : undefined;
}

const number = (value: number) => `${+value.toFixed(6)}`;

/** `a`, `a/2`, `2*a` or `2*a/3`; undefined for a coefficient that is no small fraction, which would print rounded. */
function scaled(name: string, size: number): string | undefined {
  for (let q = 1; q <= 12; q++) {
    const p = Math.round(size * q);
    if (p > 0 && Math.abs(p / q - size) < kEpsilon) return `${p === 1 ? '' : `${p}*`}${name}${q === 1 ? '' : `/${q}`}`;
  }
  return undefined;
}

function printLinear({ constant, terms }: Linear): string | number | undefined {
  const parts: string[] = [];
  // Added terms first, so a length reads `legW/2 - tenonW/2` rather than starting with a minus.
  const ordered = [...terms].filter(([, c]) => Math.abs(c) >= kEpsilon).sort(([, a], [, b]) => Number(a < 0) - Number(b < 0));
  for (const [name, coefficient] of ordered) {
    const text = scaled(name, Math.abs(coefficient));
    if (text === undefined) return undefined;
    parts.push(parts.length ? `${coefficient < 0 ? '-' : '+'} ${text}` : `${coefficient < 0 ? '-' : ''}${text}`);
  }
  if (!parts.length) return Math.abs(constant) < kEpsilon ? 0 : constant;
  // A constant that doesn't print exactly would change the length.
  if (Math.abs(+constant.toFixed(6) - constant) > kEpsilon) return undefined;
  if (Math.abs(+constant.toFixed(6)) > 0) parts.push(`${constant < 0 ? '-' : '+'} ${number(Math.abs(constant))}mm`);
  return parts.join(' ');
}

/**
 * `high - low` as a person would write it: `legW` for `legW/2 - (-legW/2)`, a plain number when the variables cancel.
 * Anything that isn't a sum is kept as written.
 */
export function differenceExpression(low: number | string, high: number | string): number | string {
  const read = (value: number | string) => (typeof value === 'number' ? { constant: value, terms: new Map() } : parseLinear(value));
  const a = read(low),
    b = read(high);
  if (typeof low === 'string' && typeof high === 'string' && low.trim() === high.trim()) return 0;
  if (a && b) {
    const terms = new Map(b.terms);
    for (const [name, coefficient] of a.terms) terms.set(name, (terms.get(name) ?? 0) - coefficient);
    const printed = printLinear({ constant: b.constant - a.constant, terms });
    if (printed !== undefined) return printed;
  }
  if (low === 0 || low === '0') return high;
  const term = (value: number | string) => (typeof value === 'number' || /^[\w.]+$/.test(value.trim()) ? `${value}` : `(${value})`);
  return `${typeof high === 'number' ? high : high.trim()} - ${term(low)}`;
}

/** `Σ k·value` written out, such as the middle of a half circle from its ends; undefined if a value isn't a sum. */
export function combineExpressions(parts: readonly (readonly [number, number | string])[]): number | string | undefined {
  let total: Linear = { constant: 0, terms: new Map() };
  for (const [k, value] of parts) {
    const read = typeof value === 'number' ? { constant: value, terms: new Map<string, number>() } : parseLinear(value);
    if (!read) return undefined;
    const terms = new Map(total.terms);
    for (const [name, coefficient] of read.terms) terms.set(name, (terms.get(name) ?? 0) + k * coefficient);
    total = { constant: total.constant + k * read.constant, terms };
  }
  return printLinear(total);
}
