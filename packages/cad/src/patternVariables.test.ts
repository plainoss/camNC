import { describe, expect, it } from 'vitest';
import {
  addCircle,
  cadVariableProblems,
  createPlateDocument,
  linearPatternSketchEntities,
  parseCadDocument,
  setCadVariable,
  solveCadDocument,
  type CadDocument,
  type CadLinearPattern,
} from './index';

const variable = (document: CadDocument, name: string, expression: string) => {
  const result = setCadVariable(document, { id: document.variables?.find(v => v.name === name)?.id, name, expression });
  if ('error' in result) throw new Error(result.error);
  return result.document;
};
const circles = (document: CadDocument) => document.parts[0]!.sketch.entities.filter(entity => entity.type === 'circle').length;
const pattern = (document: CadDocument) =>
  document.parts[0]!.sketch.constraints.find((c): c is CadLinearPattern => c.type === 'linearPattern')!;

/** A cupboard side with a row of 5 mm shelf-pin holes every 32 mm up its height, as many as fit with 32 mm spare at each end. */
async function side() {
  let document = variable(variable(createPlateDocument({ width: 300, height: 720, thickness: 18 }), 'height', '720mm'), 'pitch', '32mm');
  const part = document.parts[0]!;
  part.sketch = addCircle(part.sketch, { x: 37, y: 32, radius: 2.5 });
  const pin = part.sketch.entities.filter(entity => entity.type === 'circle').at(-1)!;
  const result = linearPatternSketchEntities(part.sketch, {
    entityIds: [pin.id],
    countX: 3,
    stepX: { x: 0, y: 32 },
    expressions: { countX: '(height - 64)/pitch + 1', spacingX: 'pitch' },
  });
  if (!result.ok) throw new Error(result.message);
  part.sketch = result.sketch;
  document = variable(document, 'height', '720mm');
  return (await solveCadDocument(document)).document;
}

describe('patterns that follow variables', () => {
  it('fits as many pins as the height allows, and the pitch sets their spacing', async () => {
    let document = await side();
    expect(pattern(document)).toMatchObject({ countX: 21, stepX: { x: 0, y: 32 } });
    expect(circles(document)).toBe(21);
    document = (await solveCadDocument(variable(document, 'height', '400mm'))).document;
    expect(circles(document)).toBe(11);
    document = (await solveCadDocument(variable(document, 'pitch', '37mm'))).document;
    expect(pattern(document)).toMatchObject({ countX: 10, stepX: { x: 0, y: 37 } });
    expect(circles(document)).toBe(10);
    expect(parseCadDocument(JSON.parse(JSON.stringify(document)))).toEqual(document);
  });

  it('keeps the last good pattern when the variables leave too little room', async () => {
    const document = variable(await side(), 'height', '80mm');
    expect(pattern(document).countX).toBe(21);
    expect(cadVariableProblems(document).map(problem => problem.message)).toEqual([
      'Pattern (height - 64)/pitch + 1: A pattern needs two to 200 copies, counting the first.',
    ]);
  });

  it('renames carry into a pattern’s expressions', async () => {
    let document = await side();
    const pitch = document.variables!.find(v => v.name === 'pitch')!;
    const result = setCadVariable(document, { id: pitch.id, name: 'system', expression: pitch.expression });
    if ('error' in result) throw new Error(result.error);
    document = result.document;
    expect(pattern(document).expressions).toEqual({ countX: '(height - 64)/system + 1', spacingX: 'system' });
  });
});
