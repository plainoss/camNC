import { expect, it } from 'vitest';
import { assistantRecipeCatalog, buildAssistantRecipe } from './recipeCatalog';

it('describes bounded recipes and instantiates numeric parameter data without model-authored source', () => {
  expect(assistantRecipeCatalog.map(recipe => recipe.name)).toEqual(['pebble-tray', 'cupboard']);
  const tray = buildAssistantRecipe('pebble-tray', {
    width: 240,
    height: 160,
    blank: 30,
    pocketDepth: 20,
    wall: 12,
    folderName: 'Tray "A"',
  });
  expect(tray.parameters).toMatchObject({ width: 240, height: 160, blank: 30, pocketDepth: 20, wall: 12, folderName: 'Tray "A"' });
  expect(tray.source).toContain('const recipe = design(');
  expect(tray.source).toContain('"width":"240mm"');
  expect(Object.isFrozen(tray.parameters)).toBe(true);
  expect(Object.isFrozen(tray.parameters.at)).toBe(true);
  const cupboard = buildAssistantRecipe('cupboard', { width: 800, height: 900, shelves: 4 });
  expect(cupboard.source).toBe(
    'd => cupboard({"name":"Cupboard","width":"800mm","height":"900mm","depth":"300mm","board":"18mm","shelves":4,"at":[0,0,0]})(d)'
  );
});

it('refuses unsupported names, callbacks, expressions, dimensions and impossible recipe combinations', () => {
  for (const name of ['../tray', 'constructor', '__proto__', null]) expect(() => buildAssistantRecipe(name)).toThrow(/Unknown recipe/);
  for (const parameters of [
    { width: '240mm' },
    { width: Infinity },
    { height: 0 },
    { wall: 100 },
    { pocketDepth: 40 },
    { width: 180 },
    { folderName: '' },
    { at: [0, 0] },
    { at: [0, NaN, 0] },
    { at: [0, 0, 100001] },
    { source: 'd => {}' },
    { toJSON: () => ({}) },
  ])
    expect(() => buildAssistantRecipe('pebble-tray', parameters)).toThrow();
  for (const parameters of [{ board: 12 }, { width: 30 }, { height: 190 }, { depth: 80 }, { shelves: 3.5 }, { shelves: 200 }])
    expect(() => buildAssistantRecipe('cupboard', parameters)).toThrow();
  const accessor = Object.defineProperty({}, 'width', {
    enumerable: true,
    get() {
      throw new Error('must not run');
    },
  });
  expect(() => buildAssistantRecipe('pebble-tray', accessor)).toThrow(/JSON data/);
  const coordinates = Object.defineProperty([0, 0, 0], '0', {
    enumerable: true,
    get() {
      throw new Error('must not run');
    },
  });
  expect(() => buildAssistantRecipe('pebble-tray', { at: coordinates })).toThrow(/JSON data/);
  expect(() =>
    buildAssistantRecipe('pebble-tray', {
      at: Object.assign([0, 0, 0], {
        toJSON() {
          throw new Error('must not run');
        },
      }),
    })
  ).toThrow(/JSON array/);
  expect(() => buildAssistantRecipe('pebble-tray', Object.create({ width: 240 }))).toThrow(/plain data/);
  expect(() => buildAssistantRecipe('pebble-tray', JSON.parse('{"__proto__":{}}'))).toThrow(/Unknown/);
});
