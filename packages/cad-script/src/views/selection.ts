export type CadViewName = 'top' | 'front' | 'right';
export type CadViewSelection = boolean | readonly CadViewName[];

const allViews: readonly CadViewName[] = Object.freeze(['top', 'front', 'right']);
const noViews: readonly CadViewName[] = Object.freeze([]);

/** Explicit views bound both rendering work and image tokens; booleans retain legacy meaning. */
export function normalizeCadViewSelection(input: unknown): readonly CadViewName[] {
  if (input === undefined || input === false) return noViews;
  if (input === true) return allViews;
  if (!Array.isArray(input) || Object.getPrototypeOf(input) !== Array.prototype || input.length > 3)
    throw new Error('views must be a boolean or an array of up to three distinct names: top, front, right.');
  // Read only plain JSON data: getters/custom iterators must not run during tool validation.
  if (Reflect.ownKeys(input).length !== input.length + 1) throw new Error('views must be a dense JSON array without extra fields.');
  const selected: CadViewName[] = [];
  for (let index = 0; index < input.length; index++) {
    const descriptor = Object.getOwnPropertyDescriptor(input, String(index));
    if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) throw new Error('views must contain only JSON data fields.');
    const name = descriptor.value;
    if (name !== 'top' && name !== 'front' && name !== 'right') throw new Error('Unknown view name. Available: top, front, right.');
    if (selected.includes(name)) throw new Error(`Duplicate view name: ${name}.`);
    selected.push(name);
  }
  return Object.freeze(selected);
}
