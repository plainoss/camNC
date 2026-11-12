import { addPartCut, addRectangle, createCadDocument, createCadPart, solveCadDocument, type CadPartCut } from '@wbcnc/cad';
import { DEFAULT_TOOL, planBoard, profileFeatures } from '@wbcnc/cam';
import { expect, it } from 'vitest';
import { postedFloorDistance } from '../../cam/test/postedFloorDistance';

const kCutter = 6;
const tenonCorners = [
  [80, 91],
  [120, 91],
  [120, 109],
  [80, 109],
];

/** How close the planned 6 mm cutter's centre gets to each tenon corner at the mortise floor. */
async function cornerReach(through: boolean, relief: CadPartCut['cornerRelief'], clearance: number) {
  const seat = createCadPart('Seat', 18),
    tenon = createCadPart('Tenon', 18);
  seat.sketch = addRectangle(seat.sketch, { x: 0, y: 0, width: 200, height: 200, dimensioned: true, positioned: true });
  tenon.sketch = addRectangle(tenon.sketch, { x: 80, y: 91, width: 40, height: 18, dimensioned: true, positioned: true });
  seat.placement = { position: [0, 0, 0], rotation: [0, 0, 0, 1] };
  tenon.placement = { position: [0, 0, through ? 0 : 9], rotation: [0, 0, 0, 1] };
  const made = addPartCut(
    { ...createCadDocument('Mortise reach'), parts: [seat, tenon] },
    [tenon.id],
    [seat.id],
    { value: clearance },
    undefined,
    relief
  );
  made.document.partCuts![0]!.consumeTools = true;
  const solved = await solveCadDocument(made.document);
  expect(solved.status).toBe('solved');
  const profile = profileFeatures(solved.parts.find(part => part.partId === seat.id)!);
  const plan = planBoard(
    {
      id: 'seat-board',
      name: 'Seat',
      w: 240,
      h: 240,
      thickness: 18,
      stockTop: 18,
      holdDown: 'fixture-tape',
      clearHoles: true,
      tabs: { height: 3, width: 6, minCount: 0 },
      parts: [{ id: 'seat', partId: seat.id, name: 'Seat', x: 20, y: 20, rotated: false }],
    },
    { tools: [{ ...DEFAULT_TOOL, diameter: kCutter }] },
    { part: () => ({ size: profile.size, features: profile.features }), underside: () => profile.features }
  );
  expect(plan.programs.map(program => program.diameter)).toEqual([kCutter]);
  const distance = postedFloorDistance(plan.programs[0]!.gcode, through ? -0.3 : 9 - clearance);
  return tenonCorners.map(([x, y]) => distance(x! + 20, y! + 20));
}

it.each([false, true])('leaves square tenon corners out of reach of the cutter without relief (through: %s)', async through => {
  for (const reach of await cornerReach(through, null, 0)) expect(reach).toBeGreaterThan(kCutter / 2 + 1);
});

it.each([false, true])('reaches every tenon corner with a per-step dogbone and fit clearance (through: %s)', async through => {
  for (const reach of await cornerReach(through, { diameter: kCutter }, 0.2)) expect(reach).toBeLessThanOrEqual(kCutter / 2);
});
