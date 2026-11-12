import { expect, it } from 'vitest';
import {
  cadPartsToCut,
  cadSketchRegions,
  constructionReferenceIssues,
  evaluateCadDocument,
  parseCadDocument,
  setCadVariable,
  setCopyCutDepth,
} from '@wbcnc/cad';
import { editCad } from './edit';
import { panelChair } from './panelChair';
import { checkFurnitureHardware } from './furnitureHardware';

it('preserves the usable seat with an explicit expanded keyed envelope and durable purchased hardware', async () => {
  const result = await editCad(null, panelChair());
  expect(result.scriptError).toBeUndefined();
  expect(result.report.errors).toEqual([]);
  expect(result.report.assembly?.collisions).toEqual([]);
  const bodies = result.report.assembly!.parts;
  expect(bodies).toHaveLength(18);
  for (const [axis, size] of [512, 438, 900].entries()) {
    expect(Math.min(...bodies.map(b => b.at[axis]!))).toBeCloseTo(0, 6);
    expect(Math.max(...bodies.map(b => b.at[axis]! + b.size[axis]!))).toBeCloseTo(size, 6);
  }
  const seat = bodies.find(b => b.name === 'Seat')!;
  const left = bodies.find(b => b.name === 'left side')!,
    right = bodies.find(b => b.name === 'right side')!;
  expect(right.at[0]! - left.at[0]! - left.size[0]!).toBeCloseTo(404, 6);
  expect(seat.size[1]).toBeCloseTo(402, 6);
  expect(seat.at[2]! + seat.size[2]!).toBeCloseTo(450, 6);
  const reloaded = parseCadDocument(JSON.parse(JSON.stringify(result.document)));
  expect(constructionReferenceIssues(reloaded)).toEqual([]);
  const plan = reloaded.constructions![0]!;
  expect(plan.members).toHaveLength(18);
  expect(plan.hardware).toHaveLength(12);
  expect(plan.connections).toHaveLength(12);
  expect(plan.hardware.every(h => h.installation === 'head-washers-prevailing-torque-nut')).toBe(true);
  expect(checkFurnitureHardware(result.document, result.parts, plan, 3.175).filter(c => !c.passed)).toEqual([]);
  expect(checkFurnitureHardware(result.document, result.parts, plan, 6).some(c => c.check.includes('selected cutter') && !c.passed)).toBe(
    true
  );

  const shortBolt = setCadVariable(reloaded, {
    id: plan.hardware[0]!.lengthVariableId,
    name: reloaded.variables!.find(v => v.id === plan.hardware[0]!.lengthVariableId)!.name,
    expression: '20mm',
  });
  if ('error' in shortBolt) throw new Error(shortBolt.error);
  expect(
    checkFurnitureHardware(shortBolt.document, result.parts, plan, 3.175).some(c => c.check.includes('Threads pass') && !c.passed)
  ).toBe(true);

  // Native No cut on one physical key must invalidate that key's actual bore,
  // despite the source circle and every stored anchor remaining unchanged.
  const copied = plan.members.find(m => m.copyId !== undefined)!;
  const source = reloaded.parts.find(p => p.id === copied.partId)!;
  const bore = plan.hardware.find(h => h.holes[0]!.role === copied.role)!;
  const region = cadSketchRegions(source, source.sketch.id).find(
    r => r.curveIds.length === 1 && r.curveIds.includes(bore.holes[0]!.entityIds[0]!)
  )!;
  const filled = setCopyCutDepth(reloaded, source.id, copied.copyId!, source.sketch.id, region.id, 0);
  const evaluated = evaluateCadDocument(filled);
  expect(
    checkFurnitureHardware(filled, evaluated.parts, plan, 3.175).some(
      c => c.hardwareId === bore.id && c.check.includes('opening passes through') && !c.passed
    )
  ).toBe(true);

  const alias = structuredClone(plan);
  alias.members.push({ ...alias.members[0]!, role: 'misleading-alias' });
  const originalHole = alias.hardware[0]!.holes[0]!;
  const originalMember = alias.members.find(m => m.role === originalHole.role)!;
  alias.members[alias.members.length - 1] = { ...originalMember, role: 'misleading-alias' };
  alias.hardware[0]!.holes.push({ ...originalHole, purpose: 'pilot', role: 'misleading-alias' });
  expect(
    checkFurnitureHardware(result.document, result.parts, alias, 3.175).some(c => c.check.includes('alias the same physical') && !c.passed)
  ).toBe(true);
  // A cutter wider than the joint relief leaves material in the mortise corners even when it fits the bolt holes.
  const wide = checkFurnitureHardware(result.document, result.parts, plan, 4);
  expect(wide.find(c => c.check.includes('relieved joint corners'))).toMatchObject({ passed: false, actual: 4, expected: 3.175 });
  expect(wide.filter(c => c.check.includes('smallest opening')).every(c => c.passed)).toBe(true);
  // Every keyed tenon needs its bolt, and a hole serves one item.
  const unbolted = { ...structuredClone(plan), hardware: [] };
  expect(checkFurnitureHardware(result.document, result.parts, unbolted, 3.175).filter(c => c.check.includes('retained by one'))).toSatisfy(
    (checks: { passed: boolean }[]) => checks.length === 12 && checks.every(c => !c.passed)
  );
  const shared = structuredClone(plan);
  shared.hardware[1]!.holes = structuredClone(shared.hardware[0]!.holes);
  expect(
    checkFurnitureHardware(result.document, result.parts, shared, 3.175).some(c => c.check.includes('No physical hole') && !c.passed)
  ).toBe(true);
  // Purchased bolts/nuts are deliberately absent from the wooden blank handoff: CAM gets the 18 wooden pieces only.
  const blanks = cadPartsToCut(result.document, result.parts).flatMap(entry => entry.names);
  expect(blanks).toHaveLength(18);
  expect(blanks.some(name => /bolt|nut|washer/i.test(name))).toBe(false);
  // Builds the whole chair, then re-evaluates it after several edits: about 23 s alone, more under a parallel run.
}, 90_000);

it('does not hide a functional-seat loss behind an outside-envelope check', async () => {
  const result = await editCad(null, panelChair({ width: '440mm', depth: '420mm', seatWidth: '404mm', seatDepth: '402mm' }));
  expect(result.scriptError).toContain('usable seat and outside envelope together');
  expect(result.document.parts).toEqual([]);
});

it('refuses a seat too shallow for its two side tenons', async () => {
  const result = await editCad(null, panelChair({ seatDepth: '200mm', depth: '400mm' }));
  expect(result.scriptError).toContain('This panel-chair pattern needs');
  expect(result.document.parts).toEqual([]);
});
