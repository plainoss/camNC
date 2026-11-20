import { expect, it } from 'vitest';
import { createPlateDocument } from './document';
import { designSteps } from './designSteps';
import { evaluateCadDocument } from './features';
import { parseCadDocument } from './parseCadDocument';
import { cadVariableScope, setCadVariable, setCadVariableSuppressed } from './variables';
import type { CadDocument } from './types';

/** A plate as thick as `#thick`, 10 mm. */
function plate(): { document: CadDocument; id: string } {
  const made = setCadVariable(createPlateDocument({ width: 100, height: 40, thickness: 10 }), { name: 'thick', expression: '10 mm' });
  if ('error' in made) throw new Error(made.error);
  const document = { ...made.document, parts: made.document.parts.map(part => ({ ...part, thicknessExpression: 'thick' })) };
  return { document, id: made.id };
}

it('fails what uses a suppressed variable, as if it were gone, and brings it back on Unsuppress', () => {
  const { document, id } = plate();
  const off = setCadVariableSuppressed(document, id, true);
  expect(off.variables![0]).toMatchObject({ name: 'thick', suppressed: true });
  expect(cadVariableScope(off)).not.toHaveProperty('thick');
  const extrude = designSteps(off).find(step => step.kind === 'extrude')!;
  expect(extrude.broken).toMatch(/Variable not found, is suppressed, or has not been set/);
  const on = setCadVariableSuppressed(off, id, false);
  expect(on.variables![0]).not.toHaveProperty('suppressed');
  expect(designSteps(on).find(step => step.kind === 'extrude')!.broken).toBeFalsy();
  expect(evaluateCadDocument(on).parts[0]!.thickness).toBe(10);
});

it('keeps a variable suppressed when it is renamed, and reads it back saved', () => {
  const { document, id } = plate();
  const off = setCadVariableSuppressed(document, id, true);
  const renamed = setCadVariable(off, { id, name: 'thk', expression: '10 mm' });
  if ('error' in renamed) throw new Error(renamed.error);
  expect(renamed.document.variables![0]).toMatchObject({ name: 'thk', suppressed: true });
  expect(renamed.document.parts[0]!.thicknessExpression).toBe('thk');
  expect(parseCadDocument(JSON.parse(JSON.stringify(renamed.document))).variables![0]!.suppressed).toBe(true);
});
