import { describe, expect, it } from 'vitest';
import {
  cadStepReport,
  addCircle,
  addLine,
  createCadPart,
  addPartCut,
  assemblyReport,
  createCadDocument,
  createPlateDocument,
  parseCadDocument,
  removePartCut,
  renamePartCopy,
  setPartPattern,
  cadPartsToCut,
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

  it('leaves out a shelf with a hole where it reaches in, rather than cutting it as a block', async () => {
    const values = { height: '720mm', depth: '300mm', width: '600mm', board: '18mm', housing: '8mm', fit: '0.2mm' };
    const holed = (x: number) => {
      const document = carcass();
      const shelf = document.parts[2]!;
      shelf.sketch = addCircle(shelf.sketch, { x, y: 140, radius: 2 });
      return variables(document, values);
    };
    // A hole in the middle of the shelf is nowhere near either side, so both are housed.
    const middle = await holed(290);
    expect(middle.parts.slice(0, 2).map(part => part.cuts?.length)).toEqual([1, 1]);
    // One in the 8 mm that reaches into the left side leaves that side uncut, and says why.
    const end = await holed(4);
    expect(end.parts.slice(0, 2).map(part => part.cuts?.length)).toEqual([undefined, 1]);
    expect(end.diagnostics.map(d => d.message)).toContain(
      "Shelf isn't square-cornered and straight-sided where it reaches into Left, so it can't be cut from it yet."
    );
  });
});

describe('shelves patterned up the carcass', () => {
  it('lays out as many shelves as the count says, each housed in both sides, and follows the count and spacing', async () => {
    let document = carcass();
    const shelf = document.parts[2]!.id;
    document.parts[2]!.placement!.positionExpressions = ['board - housing', null, 'height - 620mm'];
    document = setPartPattern(document, shelf, { axis: 'z', count: 2, countExpression: 'shelves', spacing: 0, spacingExpression: 'gap' });
    const values = { height: '720mm', depth: '300mm', width: '600mm', board: '18mm', housing: '8mm', fit: '0.2mm' };
    for (const [shelves, gap] of [
      [3, 150],
      [4, 120],
    ] as const) {
      const solved = await variables(document, { ...values, shelves: `${shelves}`, gap: `${gap}mm` });
      document = solved.document;
      const copies = document.parts[2]!.copies!;
      expect(copies).toHaveLength(shelves - 1);
      expect(copies.map(copy => copy.placement!.position[2])).toEqual(Array.from({ length: shelves - 1 }, (_, i) => 100 + (i + 1) * gap));
      for (const side of solved.parts.slice(0, 2)) expect(side.cuts).toHaveLength(shelves);
      expect(solved.diagnostics.filter(d => d.severity === 'error')).toEqual([]);
    }
    // A copy can have a name of its own, which CAM cuts it by, and it keeps it as the pattern lays it out again.
    const second = document.parts[2]!.copies![0]!.id;
    document = renamePartCopy(document, shelf, second, 'Middle shelf');
    const solved = await variables(document, { gap: '110mm' });
    const names = cadPartsToCut(solved.document, solved.parts).find(entry => entry.part.partId === shelf)!.names;
    expect(names).toEqual(['Shelf', 'Middle shelf', 'Shelf 3', 'Shelf 4']);
    expect(parseCadDocument(JSON.parse(JSON.stringify(solved.document)))).toEqual(solved.document);
  });
});

/** A flat part with this outline, its underside `z` up. */
function outlined(name: string, outline: [number, number][], z: number): CadPart {
  const part = {
    ...createCadPart(name, 18),
    placement: { position: [0, 0, z] as [number, number, number], rotation: [0, 0, 0, 1] as [number, number, number, number] },
  };
  outline.forEach(([x1, y1], i) => {
    const [x2, y2] = outline[(i + 1) % outline.length]!;
    part.sketch = addLine(part.sketch, { x1, y1, x2, y2 });
  });
  return part;
}
const boxes = (cuts: EvaluatedCadCut[] | undefined) =>
  (cuts ?? []).map(cut => {
    const xs = cut.outline.map(p => p.x),
      ys = cut.outline.map(p => p.y);
    return { x: [Math.min(...xs), Math.max(...xs)], y: [Math.min(...ys), Math.max(...ys)], depth: cut.to - cut.from, side: cut.side };
  });

describe('tools that only fill part of where they reach', () => {
  const leg = () =>
    outlined(
      'Leg',
      [
        [0, 0],
        [100, 0],
        [100, 100],
        [0, 100],
      ],
      0
    );
  const cut = async (tool: CadPart) => {
    const target = leg();
    const document = addPartCut({ ...createCadDocument(), parts: [target, tool] }, [tool.id], [target.id], { value: 0.5 }).document;
    const solved = await solveCadDocument(document);
    const report = cadStepReport(solved.document, solved.parts).find(step => step.kind === 'partCut');
    const named = report?.kind === 'partCut' ? report.cuts.map(c => c.tool) : [];
    return {
      named,
      cuts: boxes(solved.parts.find(part => part.partId === target.id)!.cuts),
      messages: solved.diagnostics.filter(d => d.code === 'part-cut-unresolved').map(d => d.message),
    };
  };

  it('cuts only the tenon of a shouldered rail, with the clearance round it', async () => {
    // A rail lying across the leg's edge, 8 mm down into it, with a 30 mm tenon 20 mm wide; its shoulders stay outside.
    const rail = outlined(
      'Rail',
      [
        [100, 20],
        [200, 20],
        [200, 80],
        [100, 80],
        [100, 60],
        [70, 60],
        [70, 40],
        [100, 40],
      ],
      10
    );
    const { cuts, messages } = await cut(rail);
    expect(messages).toEqual([]);
    expect(cuts).toEqual([{ x: [69.5, 100], y: [39.5, 60.5], depth: 8.5, side: 'top' }]);
  });

  it('cuts one slot per finger of a comb', async () => {
    const comb = outlined(
      'Comb',
      [
        [100, 0],
        [200, 0],
        [200, 100],
        [100, 100],
        [100, 80],
        [80, 80],
        [80, 60],
        [100, 60],
        [100, 30],
        [80, 30],
        [80, 10],
        [100, 10],
      ],
      10
    );
    const { cuts, messages, named } = await cut(comb);
    expect(messages).toEqual([]);
    expect(named).toEqual(['Comb', 'Comb']);
    expect(cuts).toEqual([
      { x: [79.5, 100], y: [9.5, 30.5], depth: 8.5, side: 'top' },
      { x: [79.5, 100], y: [59.5, 80.5], depth: 8.5, side: 'top' },
    ]);
  });

  it('keeps an L-shaped reach in one piece, not widened where its rectangles meet', async () => {
    // The rail's body reaches 20 mm over the leg too, and its tenon 30 mm.
    const rail = outlined(
      'Rail',
      [
        [80, 20],
        [200, 20],
        [200, 80],
        [80, 80],
        [80, 60],
        [70, 60],
        [70, 40],
        [80, 40],
      ],
      10
    );
    const { cuts } = await cut(rail);
    expect(cuts).toEqual([
      { x: [79.5, 100], y: [19.5, 40], depth: 8.5, side: 'top' },
      { x: [69.5, 100], y: [40, 60], depth: 8.5, side: 'top' },
      { x: [79.5, 100], y: [60, 80.5], depth: 8.5, side: 'top' },
    ]);
  });

  it('says only why a refused tool can’t cut, not that the step cuts nothing', async () => {
    const round = createCadPart('Dowel', 18);
    round.placement = { position: [0, 0, 10], rotation: [0, 0, 0, 1] };
    round.sketch = addCircle(round.sketch, { x: 100, y: 50, radius: 10 });
    const { cuts, messages } = await cut(round);
    expect(cuts).toEqual([]);
    expect(messages).toEqual(["Dowel isn't square-cornered and straight-sided where it reaches into Leg, so it can't be cut from it yet."]);
  });
});
