import { writeFileSync } from 'node:fs';
import { addPartCut, addRectangle, createCadDocument, createCadPart, solveCadDocument } from '@wbcnc/cad';
import { DEFAULT_TOOL, planBoard, profileFeatures } from '@wbcnc/cam';
import { expect, it } from 'vitest';
import { postedFloorDistance } from '../../cam/test/postedFloorDistance';
import { inspectCadDocument } from './inspect';

const cases = [false, true].flatMap(through => [
  { through, relief: false, clearance: 0 },
  { through, relief: true, clearance: 0 },
  { through, relief: true, clearance: 0.2 },
]);
it.each(cases)('observes selected6mm cutter at required depth: $through through, $relief relief, clearance$clearance', async ({ through, relief, clearance }) => {
  const seat = createCadPart('Seat', 18), tenon = createCadPart('Tenon', 18);
  seat.sketch = addRectangle(seat.sketch, { x: 0, y: 0, width: 200, height: 200, dimensioned: true, positioned: true });
  tenon.sketch = addRectangle(tenon.sketch, { x: 80, y: 91, width: 40, height: 18, dimensioned: true, positioned: true });
  seat.placement = { position: [0, 0, 0], rotation: [0, 0, 0, 1] };
  tenon.placement = { position: [0, 0, through ? 0 : 9], rotation: [0, 0, 0, 1] };
  if (relief) seat.cornerRelief = { diameter: 6 };
  const made = addPartCut({ ...createCadDocument('Cut parts mortise reach diagnostic'), parts: [seat, tenon] }, [tenon.id], [seat.id], { value: clearance });
  made.document.partCuts![0]!.consumeTools = true;
  const solved = await solveCadDocument(made.document);
  const inspected = await inspectCadDocument(solved.document);
  expect(solved.status).toBe('solved');
  const part = solved.parts.find(part => part.partId === seat.id)!;
  const profile = profileFeatures(part);
  const plan = planBoard({ id: 'seat-board', name: 'Seat', w: 240, h: 240, thickness: 18, stockTop: 18, holdDown: 'fixture-tape', clearHoles: true,
    parts: [{ id: 'seat', partId: seat.id, name: 'Seat', x: 20, y: 20, rotated: false }] },
    { tools: [{ ...DEFAULT_TOOL, diameter: 6 }] }, { part: () => ({ size: profile.size, features: profile.features, ...(relief && { cornerRelief: 6 }) }) });
  expect(plan.programs).toHaveLength(1);
  expect(plan.programs[0]!.diameter).toBe(6);
  const floor = through ? -0.3 : 9 - clearance;
  const distance = postedFloorDistance(plan.programs[0]!.gcode, floor);
  const distances = [[80, 91], [120, 91], [120, 109], [80, 109]].map(([x, y]) => distance(x! + 20, y! + 20));
  console.log('MORTISE_REACH', JSON.stringify({ through, relief, clearance, floor, ok: inspected.report.ok, warnings: inspected.report.warnings,
    nested: inspected.report.parts.find(part => part.name === 'Seat')?.toolpaths?.warnings, selected: plan.programs[0]!.diameter, distances }));
  if (process.env.SAVE_REPRO_FIXTURES === '1') {
    const name = `mortise-${through ? 'through' : 'blind'}-${relief ? 'relieved' : 'square'}-${clearance ? 'clearance' : 'zero'}`;
    writeFileSync(new URL(`../fixtures/designs/${name}.json`, import.meta.url), JSON.stringify(solved.document, null, 2)+'\n');
    writeFileSync(`/tmp/issue589-${name}.gcode`, plan.programs[0]!.gcode);
  }
});
