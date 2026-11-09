import type { FuzzRandom } from './fuzz';

/**
 * Cuts a JSON text back to its last complete value and closes what is still open, so a file truncated anywhere becomes a
 * shorter document: an object missing its later fields, an array missing its later items.
 */
export function closeTruncatedJson(prefix: string): string {
  let inString = false;
  let escaped = false;
  const open: string[] = [];
  // The last place a cut leaves complete JSON, and what is open there.
  let safe = { at: 0, open: '' };
  for (let i = 0; i < prefix.length; i++) {
    const c = prefix[i]!;
    if (inString) {
      if (escaped) escaped = false;
      else if (c === '\\') escaped = true;
      else if (c === '"') inString = false;
      continue;
    }
    if (c === '"') inString = true;
    else if (c === '{' || c === '[') {
      open.push(c === '{' ? '}' : ']');
      safe = { at: i + 1, open: open.join('') };
    } else if (c === '}' || c === ']') {
      open.pop();
      safe = { at: i + 1, open: open.join('') };
    } else if (c === ',') safe = { at: i, open: open.join('') };
  }
  if (!safe.at) return 'null';
  return prefix.slice(0, safe.at) + [...safe.open].reverse().join('');
}

type Container = Record<string, unknown> | unknown[];
interface Slot {
  parent: Container;
  key: string | number;
  path: string;
}

function slots(root: unknown): Slot[] {
  const out: Slot[] = [];
  const visit = (value: unknown, path: string) => {
    if (!value || typeof value !== 'object') return;
    const container = value as Container;
    for (const key of Array.isArray(container) ? container.keys() : Object.keys(container)) {
      const child = (container as Record<string | number, unknown>)[key];
      const childPath = `${path}${typeof key === 'number' ? `[${key}]` : `.${key}`}`;
      out.push({ parent: container, key, path: childPath });
      visit(child, childPath);
    }
  };
  visit(root, '$');
  return out;
}

const get = (slot: Slot) => (slot.parent as Record<string | number, unknown>)[slot.key];
const set = (slot: Slot, value: unknown) => {
  (slot.parent as Record<string | number, unknown>)[slot.key] = value;
};
const kind = (value: unknown) => (value === null ? 'null' : Array.isArray(value) ? 'array' : typeof value);
const describe = (value: unknown) => {
  const text = JSON.stringify(value) ?? String(value);
  return text.length > 40 ? `${text.slice(0, 37)}...` : text;
};

const OTHER_VALUES: readonly unknown[] = [null, 0, -1, 0.5, 1e308, -1e308, '', 'x', true, false, [], {}, [0], { x: 0 }, ['x']];
const EDGE_NUMBERS: readonly number[] = [0, -0, -1, -1e9, 1e9, 1e-12, 0.5, 2 ** 31, Number.MAX_SAFE_INTEGER, 1e308];

/**
 * One random damage to a parsed JSON document, in place: a value of another type, a missing field or item, a duplicated
 * item, an edge-case number, or a reference pointing at a missing or a different kind of object. Returns what it did.
 */
export function mutateDocument(random: FuzzRandom, document: unknown): string {
  const all = slots(document);
  if (!all.length) return 'nothing to mutate';
  const strings = all.filter(slot => typeof get(slot) === 'string');
  const ids = strings.filter(slot => slot.key === 'id').map(slot => get(slot) as string);
  const references = strings.filter(slot => typeof slot.key === 'number' || (slot.key !== 'id' && /Id$|^id$|On$|Of$|To$/.test(slot.key)));
  const numbers = all.filter(slot => typeof get(slot) === 'number');
  const arrays = all.filter(slot => Array.isArray(get(slot)) && (get(slot) as unknown[]).length);
  const choice = random.int(6);
  if (choice === 0 && references.length && ids.length) {
    const slot = random.pick(references);
    const value = random.chance(0.3) ? `missing-${random.int(1000)}` : random.pick(ids);
    set(slot, value);
    return `reference ${slot.path} -> ${value}`;
  }
  if (choice === 1 && numbers.length) {
    const slot = random.pick(numbers);
    const value = random.pick(EDGE_NUMBERS);
    set(slot, value);
    return `number ${slot.path} -> ${value}`;
  }
  if (choice === 2) {
    const slot = random.pick(all);
    if (Array.isArray(slot.parent)) slot.parent.splice(slot.key as number, 1);
    else delete slot.parent[slot.key as string];
    return `remove ${slot.path}`;
  }
  if (choice === 3 && arrays.length) {
    const slot = random.pick(arrays);
    const items = get(slot) as unknown[];
    const index = random.int(items.length);
    items.splice(index, 0, structuredClone(items[index]));
    return `duplicate ${slot.path}[${index}]`;
  }
  const slot = random.pick(all);
  const current = kind(get(slot));
  const others = OTHER_VALUES.filter(value => kind(value) !== current);
  const value = structuredClone(random.pick(others));
  set(slot, value);
  return `type ${slot.path}: ${current} -> ${describe(value)}`;
}
