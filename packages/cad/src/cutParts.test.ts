import { describe, expect, it } from 'vitest';
import {
  addPartCut,
  assemblyReport,
  createCadDocument,
  createPlateDocument,
  parseCadDocument,
  removePartCut,
  setCadVariable,
  solveCadDocument,
  type CadDimension,
  type CadDocument,
  type CadPart,
  type EvaluatedCadCut,
} from './index';

const kStanding = [0, -Math.SQRT1_2, 0, Math.SQRT1_2] as [number, number, number, number];
/** A panel whose sketch width and height follow expressions, placed with a typed x and z. */
function panel(name: string, width: string, height: string, x: string, z: string, standing: boolean): CadPart {
  const part = { ...createPlateDocument({ width: 100, height: 100, thickness: 18 }).parts[0]!, name, thicknessExpression: 'board' };
  const dimension = (label: string) => part.sketch.constraints.find((c): c is CadDimension => c.label === label && 'value' in c)!;
  dimension('Width').expression = width;
  dimension('Height').expression = height;
  part.placement = {
    position: [0, 0, 0],
    rotation: standing ? kStanding : [0, 0, 0, 1],
    positionExpressions: [x, null, z],
  };
  return part;
}
const variables = async (document: CadDocument, values: Record<string, string>) => {
  for (const [name, expression] of Object.entries(values)) {
    const result = setCadVariable(document, { id: document.variables?.find(v => v.name === name)?.id, name, expression });
    if ('error' in result) throw new Error(result.error);
    document = result.document;
  }
  return solveCadDocument(document);
};
/** Two sides `height` high and `depth` deep, and a shelf 20 mm shallower reaching `housing` into each, housed with `fit` to spare. */
function carcass(): CadDocument {
  let document: CadDocument = {
    ...createCadDocument(),
    parts: [
      panel('Left', 'height', 'depth', 'board', '0', true),
      panel('Right', 'height', 'depth', 'width', '0', true),
      panel('Shelf', 'width - 2*board + 2*housing', 'depth - 20', 'board - housing', 'height/2', false),
    ],
  };
  const [left, right, shelf] = document.parts.map(part => part.id);
  return addPartCut(document, [shelf!], [left!, right!], { value: 0.2, expression: 'fit' }).document;
}
const housing = (parts: { partId: string; cuts?: EvaluatedCadCut[] }[], partId: string) => {
  const cut = parts.find(part => part.partId === partId)!.cuts![0]!;
  const xs = cut.outline.map(p => p.x),
    ys = cut.outline.map(p => p.y);
  return { depth: cut.to - cut.from, across: Math.max(...xs) - Math.min(...xs), along: Math.max(...ys) - Math.min(...ys), side: cut.side };
};

describe('a shelf housed in two sides', () => {
  it('cuts each side where the shelf reaches in, with the clearance around it, and stays right as width and board change', async () => {
    let document = carcass();
    const changes: Record<string, string>[] = [
      { height: '720mm', depth: '300mm', width: '600mm', board: '18mm', housing: '8mm', fit: '0.2mm' },
      { width: '900mm', board: '19mm', fit: '0.3mm' },
    ];
    for (const values of changes) {
      const solved = await variables(document, values);
      document = solved.document;
      const [left, right] = document.parts.map(part => part.id);
      const board = values.board === '19mm' ? 19 : 18,
        fit = values.fit === '0.3mm' ? 0.3 : 0.2;
      for (const side of [left!, right!]) {
        const cut = housing(solved.parts, side);
        // As deep as the shelf reaches in plus the fit. Across the shelf's thickness, the fit on both sides; along its
        // depth, open at the front and the fit at the back.
        expect(cut.depth).toBeCloseTo(8 + fit, 6);
        expect(cut.across).toBeCloseTo(board + 2 * fit, 6);
        expect(cut.along).toBeCloseTo(280 + fit, 6);
      }
      expect(solved.diagnostics.filter(d => d.severity === 'error')).toEqual([]);
      expect(assemblyReport(document, solved.parts)!.collisions).toEqual([]);
    }
    expect(parseCadDocument(JSON.parse(JSON.stringify(document)))).toEqual(document);
  });

  it('cuts nothing where the shelf doesn’t reach, and says so when it reaches nowhere', async () => {
    let document = carcass();
    // A shelf narrower than the gap, set 1 mm in from the left side, reaches neither side.
    document.parts[2]!.placement!.positionExpressions = ['board + 1mm', null, 'height/2'];
    document.parts[2]!.sketch.constraints.find((c): c is CadDimension => c.label === 'Width' && 'value' in c)!.expression =
      'width - 2*board - 2mm';
    const solved = await variables(document, {
      height: '720mm',
      depth: '300mm',
      width: '600mm',
      board: '18mm',
      housing: '8mm',
      fit: '0.2mm',
    });
    expect(solved.parts.find(part => part.partId === solved.document.parts[0]!.id)!.cuts).toBeUndefined();
    expect(solved.diagnostics.map(d => d.message)).toContain('A "cut parts" step cuts nothing: none of its tools reach into its targets.');
    document = removePartCut(solved.document, solved.document.partCuts![0]!.id);
    expect(document.partCuts).toBeUndefined();
  });
});
