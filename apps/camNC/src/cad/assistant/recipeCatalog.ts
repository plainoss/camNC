import pebbleTraySource from '../../../../../packages/cad-script/examples/pebble-tray.cad.ts?raw';

export type AssistantRecipeName = 'pebble-tray' | 'cupboard';
export type AssistantRecipeParameters = Readonly<Record<string, number | string | readonly number[]>>;
export interface AssistantRecipe {
  name: AssistantRecipeName;
  description: string;
  parameters: Record<string, unknown>;
}

const dimension = { type: 'number', exclusiveMinimum: 0, maximum: 10_000 };
const common = {
  folderName: { type: 'string', minLength: 1, maxLength: 120 },
  at: { type: 'array', items: { type: 'number', minimum: -100_000, maximum: 100_000 }, minItems: 3, maxItems: 3 },
};
const schema = (properties: Record<string, unknown>) => ({
  type: 'object',
  properties: { ...common, ...properties },
  additionalProperties: false,
});

/** Trusted recipes create ordinary editable parts and variables; none can apply to the open editor. */
export const assistantRecipeCatalog: readonly AssistantRecipe[] = [
  {
    name: 'pebble-tray',
    description:
      'One editable asymmetric four-arc tray with a constant-width pocket. Numeric mm: width > height, wall < 0.32*height, pocketDepth < blank. Defaults 280×190, blank 40, pocket 30, wall 18. at defaults to [0,0,0].',
    parameters: schema({ width: dimension, height: dimension, blank: dimension, pocketDepth: dimension, wall: dimension }),
  },
  {
    name: 'cupboard',
    description:
      'Editable cupboard with boards, back, joints, pin holes and a shelf pattern. Numeric mm; board must exceed the fixed 12 mm pin-hole depth. Defaults 600×720×300, board 18 and 3 shelves. at defaults to [0,0,0]; specify it beside existing work.',
    parameters: schema({
      width: dimension,
      height: dimension,
      depth: dimension,
      board: dimension,
      shelves: { type: 'integer', minimum: 1, maximum: 200 },
    }),
  },
];

export function plainAssistantData(input: unknown, what: string): Record<string, unknown> {
  if (!input || typeof input !== 'object' || Array.isArray(input) || ![Object.prototype, null].includes(Object.getPrototypeOf(input)))
    throw new Error(`${what} must be a plain data object.`);
  for (const key of Reflect.ownKeys(input)) {
    const descriptor = Object.getOwnPropertyDescriptor(input, key)!;
    if (typeof key !== 'string' || !descriptor.enumerable || !Object.hasOwn(descriptor, 'value'))
      throw new Error(`${what} must contain only JSON data fields.`);
  }
  return input as Record<string, unknown>;
}

/** Copy dense JSON arrays without invoking model-supplied accessors or custom iterators. */
export function assistantDataArray(input: unknown, what: string): unknown[] {
  if (!Array.isArray(input) || Object.getPrototypeOf(input) !== Array.prototype) throw new Error(`${what} must be a plain JSON array.`);
  const keys = Reflect.ownKeys(input);
  if (keys.length !== input.length + 1) throw new Error(`${what} must be a dense JSON array with no extra fields.`);
  const result: unknown[] = [];
  for (let index = 0; index < input.length; index++) {
    const descriptor = Object.getOwnPropertyDescriptor(input, String(index));
    if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) throw new Error(`${what} must contain only JSON data fields.`);
    result.push(descriptor.value);
  }
  return result;
}

function parametersFor(recipe: AssistantRecipeName, input: unknown): AssistantRecipeParameters {
  const supplied = input === undefined ? {} : plainAssistantData(input, 'Recipe parameters');
  const defaults: Record<string, number | string | readonly number[]> =
    recipe === 'pebble-tray'
      ? { width: 280, height: 190, blank: 40, pocketDepth: 30, wall: 18, folderName: 'Pebble tray', at: [0, 0, 0] }
      : { width: 600, height: 720, depth: 300, board: 18, shelves: 3, folderName: 'Cupboard', at: [0, 0, 0] };
  for (const [name, value] of Object.entries(supplied)) {
    if (!Object.hasOwn(defaults, name))
      throw new Error(`Unknown ${recipe} parameter ${name}. Available: ${Object.keys(defaults).join(', ')}.`);
    if (name === 'folderName') {
      if (typeof value !== 'string' || !value.trim() || value.length > 120) throw new Error('folderName must be 1–120 characters.');
      defaults[name] = value.trim();
    } else if (name === 'at') {
      const coordinates = assistantDataArray(value, 'at');
      if (
        coordinates.length !== 3 ||
        coordinates.some(entry => typeof entry !== 'number' || !Number.isFinite(entry) || Math.abs(entry) > 100_000)
      )
        throw new Error('at must contain three finite millimetre coordinates between -100000 and 100000.');
      defaults[name] = Object.freeze(coordinates as number[]);
    } else {
      if (
        typeof value !== 'number' ||
        !Number.isFinite(value) ||
        value <= 0 ||
        value > (name === 'shelves' ? 200 : 10_000) ||
        (name === 'shelves' && !Number.isInteger(value))
      )
        throw new Error(
          `${name} must be a positive ${name === 'shelves' ? 'integer up to 200' : 'finite millimetre dimension up to 10000'}.`
        );
      defaults[name] = value;
    }
  }
  if (recipe === 'pebble-tray') {
    if (!(Number(defaults.width) > Number(defaults.height))) throw new Error('A pebble tray needs width > height.');
    if (!(Number(defaults.wall) < Number(defaults.height) * 0.32)) throw new Error('A pebble tray needs wall < 0.32*height.');
    if (!(Number(defaults.pocketDepth) < Number(defaults.blank)))
      throw new Error('A tray pocket must leave a positive floor: pocketDepth < blank.');
  } else {
    if (!(Number(defaults.board) > 12)) throw new Error('This cupboard recipe needs board > 12 mm for its fixed-depth pin holes.');
    if (!(Number(defaults.width) > 2 * Number(defaults.board) + 2))
      throw new Error('Cupboard width must leave room between its side boards.');
    if (!(Number(defaults.height) > 2 * Number(defaults.board) + 160))
      throw new Error('Cupboard height must leave room for its pin-row margins.');
    if (Number(defaults.height) < 3 * Number(defaults.board) + 82.5 + (Number(defaults.shelves) - 1) * 32)
      throw new Error('Cupboard height cannot fit that many shelves at the minimum 32 mm pin pitch.');
    if (!(Number(defaults.depth) > 90)) throw new Error('Cupboard depth must exceed 90 mm for its back and two pin rows.');
  }
  for (const value of Object.values(defaults)) if (Array.isArray(value)) Object.freeze(value);
  return Object.freeze(defaults);
}

function trustedPebbleExpression(): string {
  const header = "import { design } from '@wbcnc/cad-script';";
  const marker = 'export default ';
  const start = pebbleTraySource.indexOf(marker);
  // Only the bundled, reviewed example is wrapped. Model text never participates in source extraction.
  if (!pebbleTraySource.startsWith(header) || start < header.length || pebbleTraySource.indexOf(marker, start + marker.length) >= 0)
    throw new Error('The bundled pebble example no longer has the expected module shape.');
  const expression = pebbleTraySource.slice(start + marker.length).trim();
  if (!expression.startsWith('design(') || !expression.endsWith(');'))
    throw new Error('The bundled pebble example has no design expression.');
  return expression.slice(0, -1);
}

export function buildAssistantRecipe(
  name: unknown,
  input?: unknown
): { recipe: AssistantRecipeName; parameters: AssistantRecipeParameters; source: string } {
  if (name !== 'pebble-tray' && name !== 'cupboard')
    throw new Error(`Unknown recipe. Available: ${assistantRecipeCatalog.map(recipe => recipe.name).join(', ')}.`);
  const parameters = parametersFor(name, input);
  let source: string;
  if (name === 'cupboard') {
    const { folderName, width, height, depth, board, shelves, at } = parameters;
    source = `d => cupboard(${JSON.stringify({ name: folderName, width: `${width}mm`, height: `${height}mm`, depth: `${depth}mm`, board: `${board}mm`, shelves, at })})(d)`;
  } else {
    const { folderName, at, ...dimensions } = parameters;
    const values = Object.fromEntries(Object.entries(dimensions).map(([key, value]) => [key, `${value}mm`]));
    // Bind numeric JSON parameters through the normal API inside the existing sandbox. Do not rewrite geometry source.
    source = `d => {
  const values = ${JSON.stringify(values)};
  const recipe = ${trustedPebbleExpression()};
  recipe({ ...d, folder: (_name, build) => d.folder(${JSON.stringify(folderName)}, scope => build({ ...scope,
    variable: (name, value) => scope.variable(name, Object.hasOwn(values, name) ? values[name] : value),
    newPart: (...args) => { const part = scope.newPart(...args); part.place({ at: ${JSON.stringify(at)} }); return part; }
  })) });
}`;
  }
  return { recipe: name, parameters, source };
}
