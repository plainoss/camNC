import {
  addLine,
  addRectangle,
  createCadDocument,
  createCadPart,
  resolveExtrudeSteps,
  sketchRegions,
  type CadDocument,
  type CadPart,
} from '@wbcnc/cad';
import { expect, it } from 'vitest';
import { nativeCadModel } from './nativeCadModel';

/** A profile drawn on the Front plane, `points` in its sketch's mm, extruded 80 toward −Y. */
function frontProfile(draw: (part: CadPart) => CadPart['sketch']): CadDocument {
  const part = { ...createCadPart('Part 1', 80), id: 'profile', drawnOn: { on: { plane: 'front' as const }, offset: 0 } };
  part.sketch = draw(part);
  return resolveExtrudeSteps({
    ...createCadDocument(),
    parts: [{ ...part, regions: sketchRegions(part.sketch).map(region => region.id) }],
  });
}

it('mills a 120 × 18 profile drawn on the Front plane and extruded 80 from the top, as an 18 mm board 120 × 80', async () => {
  const { model, entries } = await nativeCadModel(frontProfile(part => addRectangle(part.sketch, { x: 0, y: 0, width: 120, height: 18 })));
  const [info] = model.parts;
  expect(info!.thickness).toBeCloseTo(18, 6);
  expect(info!.size.map(value => +value.toFixed(6))).toEqual([120, 80, 18]);
  const entry = entries.get(info!.id)!;
  expect(entry.features.outlines).toHaveLength(1);
  expect(entry.features.pockets).toHaveLength(0);
  // The studio still shows it where it was drawn: only CAM lays it down.
  expect(model.meshes[0]!.flat).not.toEqual([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
});

it('reads the notches of such a profile as grooves milled from the top', async () => {
  // 120 × 18 with two notches in its top edge, 30 wide at the top and 10 at their 10 mm deep floor.
  const notched = [
    [0, 0],
    [120, 0],
    [120, 18],
    [105, 18],
    [95, 8],
    [85, 8],
    [75, 18],
    [45, 18],
    [35, 8],
    [25, 8],
    [15, 18],
    [0, 18],
  ];
  const { model, entries } = await nativeCadModel(
    frontProfile(part =>
      notched.reduce(
        (sketch, [x1, y1], i) =>
          addLine(sketch, { x1: x1!, y1: y1!, x2: notched[(i + 1) % notched.length]![0]!, y2: notched[(i + 1) % notched.length]![1]! }),
        part.sketch
      )
    )
  );
  const [info] = model.parts;
  expect(info!.thickness).toBeCloseTo(18, 6);
  const entry = entries.get(info!.id)!;
  // The notches' floors are pockets 10 deep from the top, 80 long and 10 wide each: two regions at that depth.
  const floors = entry.features.pockets.map(pocket => +(info!.thickness - pocket.floorZ).toFixed(3));
  expect(new Set(floors)).toEqual(new Set([10]));
  expect(entry.features.pockets.reduce((sum, pocket) => sum + pocket.strictRegion.length, 0)).toBe(2);
  expect(info!.summary.chips.map(chip => chip.label)).toContain('2 edge grooves 10 deep');
  // Their 45° sides aren't a flat bit's: the part is offered as a 3D part, to mill as a flat board only if chosen.
  expect(info!.summary.notFlat).toBe(true);
});
