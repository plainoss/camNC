import { beforeAll, describe, expect, it } from 'vitest';
import {
  addRectangle,
  createCadPart,
  parseCadDocument,
  setCadVariable,
  solveCadDocumentNow,
  type CadConstructionAssemblyStep,
  type CadDocument,
} from '@wbcnc/cad';
import { editCad, type CadEditResult } from './edit';
import { checkFurnitureAssembly } from './furnitureAssembly';
import { checkFurnitureConstruction } from './furnitureJoints';
import { frameStool } from './frameStool';
import { panelChair } from './panelChair';

const assembly = (document: CadDocument) => {
  const solved = solveCadDocumentNow(document);
  return checkFurnitureAssembly(solved.document, solved.parts, solved.document.constructions![0]!);
};
const failing = (document: CadDocument) => assembly(document).filter(check => !check.passed);
const withVariable = (document: CadDocument, name: string, expression: string) => {
  const variable = document.variables!.find(v => v.name === name)!;
  const changed = setCadVariable(document, { id: variable.id, name, expression });
  if ('error' in changed) throw new Error(changed.error);
  return changed.document;
};
const withAssembly = (document: CadDocument, change: (steps: CadDocument['constructions'] & object) => void) => {
  const next = structuredClone(document);
  change(next.constructions!);
  return next;
};

describe.each([
  { name: 'frame stool', build: () => frameStool(), edit: ['board', '22mm'] },
  { name: 'panel chair', build: () => panelChair(), edit: ['board', '20mm'] },
] as const)('$name assembly order', ({ build, edit }) => {
  let result: CadEditResult, reloaded: CadDocument;
  beforeAll(async () => {
    result = await editCad(null, build());
    reloaded = parseCadDocument(JSON.parse(JSON.stringify(result.document)));
  }, 180_000);

  it('inserts every piece along its stated direction, also after reload and a stock edit', () => {
    expect(result.scriptError).toBeUndefined();
    const checks = assembly(reloaded);
    expect(checks.filter(c => !c.passed)).toEqual([]);
    // Every step that brings pieces together was swept, not skipped.
    const plan = reloaded.constructions![0]!;
    expect(checks.filter(c => c.check.includes('travel into place'))).toHaveLength(plan.assembly.filter(s => s.moving).length);
    const [name, expression] = edit;
    expect(failing(withVariable(reloaded, name, expression))).toEqual([]);
  });

  it('refuses an impossible order: the second side fitted before the crosspieces go in', () => {
    const swapped = withAssembly(reloaded, ([plan]) => {
      const fit = plan!.assembly.findIndex(s => s.action === 'fit-second-side');
      const [step] = plan!.assembly.splice(fit, 1);
      plan!.assembly.unshift(step!);
    });
    expect(failing(swapped).some(c => c.check.includes('travel into place'))).toBe(true);
  });

  it('refuses a piece pushed in the wrong way, and a step that names no moving piece', () => {
    const reversed = withAssembly(reloaded, ([plan]) => {
      const fit = plan!.assembly.find(s => s.action === 'fit-second-side')!;
      fit.axis = fit.axis === '-x' ? '+x' : '-x';
    });
    expect(failing(reversed).some(c => c.check.includes('travel into place') && c.id.includes('meets'))).toBe(true);
    const unstated = withAssembly(reloaded, ([plan]) => {
      delete plan!.assembly.find(s => s.action === 'fit-second-side')!.moving;
    });
    expect(failing(unstated).some(c => c.check.includes('says which members move'))).toBe(true);
  });
});

it('refuses a seat screw a block below the cleat hides from the driver', async () => {
  const result = await editCad(null, frameStool());
  const solved = solveCadDocumentNow(result.document);
  const plan = solved.document.constructions![0]!;
  expect(checkFurnitureConstruction(solved.document, solved.parts, plan).filter(c => !c.passed)).toEqual([]);
  // A block inside the frame, not part of the plan, right where the screws are driven up from.
  const block = createCadPart('Shelf block', 18);
  block.sketch = addRectangle(block.sketch, { x: 70, y: 100, width: 200, height: 140, dimensioned: true, positioned: true });
  block.placement = { position: [0, 0, 570], rotation: [0, 0, 0, 1] };
  const blocked = solveCadDocumentNow({ ...result.document, parts: [...result.document.parts, block] });
  const failures = checkFurnitureConstruction(blocked.document, blocked.parts, plan).filter(c => !c.passed);
  expect(failures.some(c => c.check.includes('access below the attachment'))).toBe(true);
}, 180_000);

it("refuses the chair's seat keys going in before the front apron's once 20 mm stock makes them meet", async () => {
  const result = await editCad(null, panelChair({ board: '20mm' }));
  expect(failing(result.document)).toEqual([]);
  const seatFirst = withAssembly(result.document, ([plan]) => {
    const seatKey = (step: CadConstructionAssemblyStep) => step.action === 'install-keys' && step.roles[0]!.startsWith('Seat-');
    const keys = plan!.assembly.filter(seatKey);
    plan!.assembly = plan!.assembly.filter(step => !seatKey(step));
    plan!.assembly.splice(
      plan!.assembly.findIndex(step => step.action === 'install-keys'),
      0,
      ...keys
    );
  });
  expect(failing(seatFirst).find(c => c.check.includes('travel into place'))?.id).toMatch(/Front apron-.*-key-1 meets Seat-/);
}, 180_000);
