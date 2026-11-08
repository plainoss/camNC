import { describe, expect, it } from 'vitest';
import {
  addCircle,
  cadSketchRegions,
  evaluateCadDocument,
  setCutDepth,
  cadVariableProblems,
  createPlateDocument,
  linearPatternSketchEntities,
  parseCadDocument,
  setCadVariable,
  solveCadDocument,
  type CadDimension,
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
  part.sketch.constraints.find((c): c is CadDimension => c.label === 'Height' && 'value' in c)!.expression = 'height';
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
  it.each(['(width/3 - 3*board/2 - 10mm)/penPitch', 'floor((width/3 - 3*board/2 - 10mm)/penPitch)'])(
    'evaluates %s as a pattern count',
    async expression => {
      let document = await side();
      document = variable(variable(variable(document, 'width', '600mm'), 'board', '18mm'), 'penPitch', '32mm');
      pattern(document).expressions!.countX = expression;
      document = (await solveCadDocument(document)).document;
      expect(cadVariableProblems(document)).toEqual([]);
      expect(pattern(document).countX).toBe(5);
      expect(circles(document)).toBe(5);
    }
  );

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

  it('cuts every pin a pattern has, including the ones it gains or loses, unless a pin has its own cut', async () => {
    let document = await side();
    const part = document.parts[0]!;
    const original = pattern(document).instances.find(instance => instance.x === 0)!;
    const regionOf = (doc: CadDocument, curveId: string) =>
      cadSketchRegions(doc.parts[0]!, doc.parts[0]!.sketch.id).find(region => region.curveIds.includes(curveId))!;
    const pin = Object.values(original.idMap).find(id => document.parts[0]!.sketch.entities.find(e => e.id === id)?.type === 'circle')!;
    document = setCutDepth(document, part.id, part.sketch.id, regionOf(document, pin).id, 12);
    const pockets = (doc: CadDocument) => {
      const result = evaluateCadDocument(doc);
      if (!result.parts[0]) throw new Error(JSON.stringify(result.diagnostics));
      return result.parts[0].cuts!.map(cut => cut.to);
    };
    expect(pockets(document)).toEqual(Array(21).fill(12));
    expect(evaluateCadDocument(document).parts[0]!.holes).toEqual([]);
    document = (await solveCadDocument(variable(document, 'height', '900mm'))).document;
    expect(pockets(document)).toEqual(Array(27).fill(12));
    document = (await solveCadDocument(variable(document, 'height', '400mm'))).document;
    expect(pockets(document)).toEqual(Array(11).fill(12));
    expect(evaluateCadDocument(document).diagnostics).toEqual([]);
    // A pin given its own depth keeps it.
    const third = pattern(document).instances.find(instance => instance.x === 2)!;
    const thirdPin = Object.values(third.idMap).find(id => document.parts[0]!.sketch.entities.find(e => e.id === id)?.type === 'circle')!;
    document = setCutDepth(document, part.id, part.sketch.id, regionOf(document, thirdPin).id, 6);
    expect(pockets(document).sort()).toEqual([...Array(10).fill(12), 6].sort());
  });

  it('leaves out a cut on a pin the pattern no longer has, with a warning instead of an error', async () => {
    let document = await side();
    const part = document.parts[0]!;
    const last = pattern(document).instances.find(instance => instance.x === 20)!;
    const pin = Object.values(last.idMap).find(id => part.sketch.entities.find(e => e.id === id)?.type === 'circle')!;
    const region = cadSketchRegions(part, part.sketch.id).find(r => r.curveIds.includes(pin))!;
    document = setCutDepth(document, part.id, part.sketch.id, region.id, 12);
    document = (await solveCadDocument(variable(document, 'height', '400mm'))).document;
    const { diagnostics } = evaluateCadDocument(document);
    expect(diagnostics.map(d => [d.code, d.severity])).toEqual([['cut-copy-gone', 'warning']]);
  });
});
