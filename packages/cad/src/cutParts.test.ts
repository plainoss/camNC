import { describe, expect, it } from 'vitest';
import { updatePartCut, withPartCuts } from './cutParts';
import {
  cadStepReport,
  cadVariableProblems,
  removeCadVariable,
  addCircle,
  addLine,
  createCadPart,
  addPartCut,
  assemblyReport,
  createCadDocument,
  createPlateDocument,
  evaluateCadPart,
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

  it('houses a mirrored side on its own inner face, in assembly and CAM', async () => {
    const document = carcass();
    const [left, right, shelf] = document.parts;
    left!.copies = [
      {
        id: 'right',
        name: 'Right',
        mirrored: true,
        placement: { ...right!.placement!, positionExpressions: ['width', null, 'height'] },
      },
    ];
    document.parts = [left!, shelf!];
    document.partCuts![0]!.targets = [left!.id];
    const solved = await variables(document, {
      height: '720mm',
      depth: '300mm',
      width: '600mm',
      board: '18mm',
      housing: '8mm',
      fit: '0.2mm',
    });
    const side = solved.parts[0]!;
    expect(side.cuts).toHaveLength(1);
    expect(side.cuts![0]!.side).toBe('underside');
    expect(side.cuts![0]!.opening!.x0).toBeCloseTo(359.8, 6);
    expect(side.cuts![0]!.opening!.x1).toBeCloseTo(378.2, 6);
    expect(side.copyCuts?.right).toHaveLength(1);
    expect(side.copyCuts!.right![0]!.side).toBe('top');
    expect(side.copyCuts!.right![0]!.opening!.x0).toBeCloseTo(341.8, 6);
    expect(side.copyCuts!.right![0]!.opening!.x1).toBeCloseTo(360.2, 6);
    expect(assemblyReport(solved.document, solved.parts)!.collisions).toEqual([]);
    expect(withPartCuts(solved.document, evaluateCadPart(solved.document.parts[0]!).part!)).toEqual(side);
    const pieces = cadPartsToCut(solved.document, solved.parts).filter(
      entry => entry.names.includes('Left') || entry.names.includes('Right')
    );
    expect(pieces.map(entry => entry.names)).toEqual([['Left'], ['Right']]);
    expect(pieces.map(entry => entry.part.cuts?.length)).toEqual([1, 1]);
    expect(pieces.map(entry => entry.part.cuts![0]!.side)).toEqual(['underside', 'top']);
    expect(pieces[1]!.part.cuts![0]!.opening!.x0).toBeCloseTo(-360.2, 6);
  });

  it('keeps own cuts on unreached copies and groups copies by their cuts', async () => {
    const document = carcass();
    const left = document.parts[0]!;
    left.copies = [
      { id: 'same', placement: { ...left.placement! } },
      { id: 'away', placement: { position: [2000, 0, 0], rotation: kStanding } },
      { id: 'away2', placement: { position: [3000, 0, 0], rotation: kStanding } },
    ];
    const solved = await variables(document, {
      height: '720mm',
      depth: '300mm',
      width: '600mm',
      board: '18mm',
      housing: '8mm',
      fit: '0.2mm',
    });
    const side = solved.parts[0]!;
    expect(side.copyCuts).toEqual({ away: [], away2: [] });
    const pieces = cadPartsToCut(solved.document, [side]);
    expect(pieces.map(entry => entry.names)).toEqual([
      ['Left', 'Left 2'],
      ['Left 3', 'Left 4'],
    ]);
    expect(pieces.map(entry => entry.part.cuts?.length ?? 0)).toEqual([1, 0]);
    const own: EvaluatedCadCut = { ...side.cuts![0]!, id: 'feature', regionId: 'feature' };
    const profile = { ...evaluateCadPart(solved.document.parts[0]!).part!, cuts: [own] };
    const cut = withPartCuts(solved.document, profile);
    expect(cut.copyCuts?.away).toEqual([own]);
    expect(cut.copyCuts?.away2).toEqual([own]);
  });

  it('cuts patterned targets at their placements even when the original is out of reach', async () => {
    let document = carcass();
    const left = document.parts[0]!;
    left.placement!.positionExpressions = ['board - 1000mm', null, '0'];
    document = setPartPattern(document, left.id, { axis: 'x', count: 3, spacing: 1000 });
    const solved = await variables(document, {
      height: '720mm',
      depth: '300mm',
      width: '600mm',
      board: '18mm',
      housing: '8mm',
      fit: '0.2mm',
    });
    const side = solved.parts[0]!;
    const [reached, away] = solved.document.parts[0]!.copies!;
    expect(side.cuts).toBeUndefined();
    expect(side.copyCuts?.[reached!.id]).toHaveLength(1);
    expect(side.copyCuts?.[away!.id]).toBeUndefined();
    expect(side.copyCuts![reached!.id]![0]!.id).toBe(`cut-parts:${document.partCuts![0]!.id}:${document.parts[2]!.id}`);
    expect(assemblyReport(solved.document, solved.parts)!.collisions).toEqual([]);
    expect(cadPartsToCut(solved.document, [side]).map(entry => entry.names)).toEqual([['Left', 'Left 3'], ['Left 2']]);
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
  it('uses only the named copy, keeps plain part tools, and warns when the copy is gone', async () => {
    let document = carcass();
    const shelf = document.parts[2]!.id;
    document.parts[2]!.placement!.positionExpressions = ['board - housing', null, 'height - 620mm'];
    document = setPartPattern(document, shelf, { axis: 'z', count: 3, spacing: 150 });
    const middle = document.parts[2]!.copies![0]!.id;
    document = renamePartCopy(document, shelf, middle, 'Middle shelf');
    const step = document.partCuts![0]!;
    step.tools = [`${shelf}:${middle}`];
    const solved = await variables(document, {
      height: '720mm',
      depth: '300mm',
      width: '600mm',
      board: '18mm',
      housing: '8mm',
      fit: '0.2mm',
    });
    expect(solved.document.partCuts![0]!.tools).toEqual(step.tools);
    expect(parseCadDocument(JSON.parse(JSON.stringify(solved.document)))).toEqual(solved.document);
    for (const side of solved.parts.slice(0, 2)) {
      expect(side.cuts).toHaveLength(1);
      const cut = side.cuts![0]!;
      expect(cut.id).toBe(`cut-parts:${step.id}:${shelf}:${middle}`);
      expect(cut.opening!.x0).toBeCloseTo(249.8, 6);
      expect(cut.opening!.x1).toBeCloseTo(268.2, 6);
      const source = solved.document.parts.find(part => part.id === side.partId)!;
      expect(withPartCuts(solved.document, evaluateCadPart(source).part!).cuts).toEqual(side.cuts);
    }
    const report = cadStepReport(solved.document, solved.parts).find(entry => entry.kind === 'partCut');
    expect(report?.kind === 'partCut' && report.tools).toEqual(['Middle shelf']);
    expect(report?.kind === 'partCut' && report.cuts.map(cut => cut.tool)).toEqual(['Middle shelf', 'Middle shelf']);
    expect(solved.diagnostics.filter(d => d.code === 'part-cut-unresolved')).toEqual([]);

    const plain = await solveCadDocument({ ...solved.document, partCuts: [{ ...step, tools: [shelf] }] });
    for (const side of plain.parts.slice(0, 2)) expect(side.cuts).toHaveLength(3);

    const removed = await solveCadDocument(setPartPattern(solved.document, shelf, null));
    const removedReport = cadStepReport(removed.document, removed.parts).find(entry => entry.kind === 'partCut');
    expect(removedReport?.kind === 'partCut' && removedReport.tools).toEqual(['a copy of Shelf that is gone']);
    for (const side of removed.parts.slice(0, 2)) expect(side.cuts ?? []).toEqual([]);
    expect(removed.diagnostics).toContainEqual({
      code: 'part-cut-unresolved',
      severity: 'warning',
      message: expect.stringContaining('Shelf'),
    });
  });

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

  it('uses the mirrored shape at the selected copy placement', async () => {
    const target = leg();
    const tool = outlined(
      'Rail',
      [
        [10, 20],
        [30, 20],
        [30, 40],
        [10, 40],
      ],
      10
    );
    tool.copies = [{ id: 'mirror', mirrored: true, placement: { position: [80, 0, 10], rotation: [0, 0, 0, 1] } }];
    const document = addPartCut({ ...createCadDocument(), parts: [target, tool] }, [`${tool.id}:mirror`], [target.id], {
      value: 0.5,
    }).document;
    const solved = await solveCadDocument(document);
    expect(boxes(solved.parts[0]!.cuts)).toEqual([{ x: [49.5, 70.5], y: [19.5, 40.5], depth: 8.5, side: 'top' }]);
    expect(withPartCuts(solved.document, evaluateCadPart(target).part!).cuts).toEqual(solved.parts[0]!.cuts);
    expect(solved.diagnostics.filter(d => d.code === 'part-cut-unresolved')).toEqual([]);
  });

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

  it('refuses a slanted tool whose area happens to match a box', async () => {
    const slanted = outlined(
      'Brace',
      [
        [10, 10],
        [50, 10],
        [70, 30],
        [30, 30],
      ],
      10
    );
    const { cuts, messages } = await cut(slanted);
    expect(cuts).toEqual([]);
    expect(messages).toEqual(["Brace isn't square-cornered and straight-sided where it reaches into Leg, so it can't be cut from it yet."]);
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

/** Standing boards sharing world z, either crossing in their middles or meeting at their ends. */
function joint(split: 'half' | { fingers: number }, corner = false): CadDocument {
  const a = outlined(
    'Across',
    [
      [0, 0],
      [100, 0],
      [100, 100],
      [0, 100],
    ],
    0
  );
  const b = outlined(
    'Along',
    [
      [0, 0],
      [100, 0],
      [100, 100],
      [0, 100],
    ],
    0
  );
  a.placement = { position: [0, corner ? 18 : 59, 0], rotation: [Math.SQRT1_2, 0, 0, Math.SQRT1_2] };
  b.placement = { position: [corner ? 82 : 41, 0, 0], rotation: [0.5, 0.5, 0.5, 0.5] };
  const document = addPartCut({ ...createCadDocument(), parts: [a, b] }, [b.id], [a.id], { value: 0.2 }).document;
  Object.assign(document.partCuts![0]!, { split });
  return document;
}

describe('half-lap and finger joints', () => {
  it('follows a finger count variable, preserves invalid counts, and tracks renamed expressions', async () => {
    let document = joint({ fingers: 5 }, true);
    Object.assign(document.partCuts![0]!.split!, { fingersExpression: '#n' });
    document = (await variables(document, { n: '5' })).document;
    expect((await solveCadDocument(document)).parts.map(part => part.cuts?.length)).toEqual([3, 2]);
    document = (await variables(document, { n: '7' })).document;
    expect(document.partCuts![0]!.split).toEqual({ fingers: 7, fingersExpression: '#n' });
    expect((await solveCadDocument(document)).parts.map(part => part.cuts?.length)).toEqual([4, 3]);
    for (const expression of ['2.5', '1', '3mm']) {
      document = (await variables(document, { n: expression })).document;
      expect(document.partCuts![0]!.split).toEqual({ fingers: 7, fingersExpression: '#n' });
      expect(cadVariableProblems(document)).toEqual([
        expect.objectContaining({ code: 'variable-value', severity: 'error', message: expect.stringContaining('Cut parts fingers #n:') }),
      ]);
    }
    const id = document.variables![0]!.id;
    const renamed = setCadVariable(document, { id, name: 'count', expression: '5' });
    if ('error' in renamed) throw new Error(renamed.error);
    document = renamed.document;
    expect(document.partCuts![0]!.split).toEqual({ fingers: 5, fingersExpression: '#count' });
    expect(removeCadVariable(document, id)).toEqual({ error: 'count is used in one place. Change those first.' });
    expect(parseCadDocument(JSON.parse(JSON.stringify(document)))).toEqual(document);
  });

  it('validates and replaces finger expressions on creation and update', () => {
    const document = joint('half');
    const created = addPartCut(document, [], [], { value: 0 }, { fingers: 5, fingersExpression: 'n' });
    expect(created.document.partCuts!.at(-1)!.split).toEqual({ fingers: 5, fingersExpression: 'n' });
    const updated = updatePartCut(created.document, created.id, { split: { fingers: 3 } });
    expect(updated.partCuts!.at(-1)!.split).toEqual({ fingers: 3 });
    const invalid = JSON.parse(JSON.stringify(created.document));
    invalid.partCuts.at(-1).split.fingersExpression = 5;
    expect(() => parseCadDocument(invalid)).toThrow('Invalid CAD part cut');
    expect(() => addPartCut(document, [], [], { value: 0 }, invalid.partCuts.at(-1).split)).toThrow('Invalid CAD part cut');
    expect(() => updatePartCut(document, document.partCuts![0]!.id, { split: invalid.partCuts.at(-1).split })).toThrow(
      'Invalid CAD part cut'
    );
  });

  it.each(['half', { fingers: 2 }] as const)('cuts opposite halves with clearance for %j and follows the overlap height', async split => {
    const document = joint(split);
    for (const height of [100, 140]) {
      document.parts = document.parts.map(part => ({
        ...outlined(
          part.name,
          [
            [0, 0],
            [100, 0],
            [100, height],
            [0, height],
          ],
          0
        ),
        id: part.id,
        placement: part.placement,
      }));
      const solved = await solveCadDocument(document);
      for (const [index, part] of solved.parts.entries()) {
        expect(part.cuts).toHaveLength(1);
        const cut = part.cuts![0]!;
        expect(cut.through).toBe(true);
        expect(cut.to).toBeCloseTo(18);
        expect(cut.opening!.x1 - cut.opening!.x0).toBeCloseTo(18.4);
        expect(cut.opening!.y1 - cut.opening!.y0).toBeCloseTo(height / 2 + 0.2);
        expect(cut.opening!.y0).toBeCloseTo(index === 0 ? height / 2 - 0.2 : 0);
        expect(withPartCuts(solved.document, evaluateCadPart(solved.document.parts[index]!).part!)).toEqual(part);
      }
      expect(assemblyReport(solved.document, solved.parts)!.collisions).toEqual([]);
      const report = cadStepReport(solved.document, solved.parts).find(step => step.kind === 'partCut');
      expect(report?.kind === 'partCut' && report.cuts.map(cut => [cut.target, cut.tool])).toEqual([
        ['Across', 'Along'],
        ['Along', 'Across'],
      ]);
      expect(solved.parts[1]!.cuts![0]!.id).toBe(`cut-parts:${document.partCuts![0]!.id}:${document.parts[0]!.id}:lap`);
    }
    expect(parseCadDocument(JSON.parse(JSON.stringify(document)))).toEqual(document);
  });

  it('alternates five corner fingers with clearance only at closed ends', async () => {
    const document = joint({ fingers: 5 }, true);
    const solved = await solveCadDocument(document);
    expect(solved.parts.map(part => part.cuts?.length)).toEqual([3, 2]);
    for (const [index, part] of solved.parts.entries()) {
      for (const [piece, cut] of part.cuts!.entries()) {
        const { y0, y1 } = cut.opening!;
        expect(y1 - y0).toBeCloseTo(index === 0 && piece !== 1 ? 20.2 : 20.4);
        expect(cut.through).toBe(true);
        expect(cut.id).toBe(
          `cut-parts:${document.partCuts![0]!.id}:${document.parts[1 - index]!.id}${index ? ':lap' : ''}${piece ? `#${piece}` : ''}`
        );
      }
    }
    expect(assemblyReport(solved.document, solved.parts)!.collisions).toEqual([]);
    expect(parseCadDocument(JSON.parse(JSON.stringify(document)))).toEqual(document);
  });

  it.each([false, true])('cuts each placed tool and target copy, including mirrors %s', async mirrored => {
    const document = joint('half');
    const [target, tool] = document.parts;
    target!.copies = [{ id: 'target-copy', placement: target!.placement }];
    tool!.copies = [
      {
        id: 'tool-copy',
        mirrored,
        placement: { ...tool!.placement!, position: [41, mirrored ? 100 : 0, 0] },
      },
    ];
    delete target!.placement;
    delete tool!.placement;
    document.partCuts![0]!.tools = [`${tool!.id}:tool-copy`];
    const solved = await solveCadDocument(document);
    expect(solved.parts.map(part => part.cuts)).toEqual([undefined, undefined]);
    const targetCut = solved.parts[0]!.copyCuts!['target-copy']![0]!;
    const toolCut = solved.parts[1]!.copyCuts!['tool-copy']![0]!;
    expect(targetCut.id).toBe(`cut-parts:${document.partCuts![0]!.id}:${tool!.id}:tool-copy`);
    expect(toolCut.id).toBe(`cut-parts:${document.partCuts![0]!.id}:${target!.id}:lap:target-copy`);
    expect(targetCut.opening!.y0).toBeCloseTo(49.8);
    expect(toolCut.opening!.y1).toBeCloseTo(50.2);
    expect(toolCut.opening!.x1 - toolCut.opening!.x0).toBeCloseTo(18.4);
    expect(assemblyReport(solved.document, solved.parts)!.collisions).toEqual([]);
    for (const [index, part] of solved.parts.entries())
      expect(withPartCuts(solved.document, evaluateCadPart(solved.document.parts[index]!).part!)).toEqual(part);
  });

  it('names the target copy that cuts the tool lap', async () => {
    const document = joint('half');
    const target = document.parts[0]!;
    target.copies = [{ id: 'target-copy', name: 'Crossing copy', placement: target.placement }];
    delete target.placement;
    const solved = await solveCadDocument(document);
    const report = cadStepReport(solved.document, solved.parts).find(step => step.kind === 'partCut');
    expect(report?.kind === 'partCut' && report.cuts.map(cut => cut.tool)).toEqual(['Crossing copy']);
  });

  it('uses world positive even when the shared sketch axis is reversed', async () => {
    const document = joint('half');
    document.parts[0]!.placement = { position: [0, 41, 100], rotation: [-Math.SQRT1_2, 0, 0, Math.SQRT1_2] };
    const solved = await solveCadDocument(document);
    expect(solved.parts[0]!.cuts![0]!.opening!.y0).toBeCloseTo(0);
    expect(solved.parts[0]!.cuts![0]!.opening!.y1).toBeCloseTo(50.2);
    expect(solved.parts[1]!.cuts![0]!.opening!.y0).toBeCloseTo(0);
    expect(solved.parts[1]!.cuts![0]!.opening!.y1).toBeCloseTo(50.2);
    expect(assemblyReport(solved.document, solved.parts)!.collisions).toEqual([]);
  });

  it('divides the shared overlap when the boards have different heights and elevations', async () => {
    const document = joint('half');
    document.parts[1]!.placement!.position[2] = 20;
    const solved = await solveCadDocument(document);
    expect(solved.parts[0]!.cuts![0]!.opening!.y0).toBeCloseTo(59.8);
    expect(solved.parts[0]!.cuts![0]!.opening!.y1).toBeCloseTo(100);
    expect(solved.parts[1]!.cuts![0]!.opening!.y0).toBeCloseTo(0);
    expect(solved.parts[1]!.cuts![0]!.opening!.y1).toBeCloseTo(40.2);
    expect(assemblyReport(solved.document, solved.parts)!.collisions).toEqual([]);
  });

  it('accepts a split when creating or editing a step and rejects unknown split forms', () => {
    const document = joint('half');
    const created = addPartCut(document, [], [], { value: 0.2 }, { fingers: 5 });
    expect(created.document.partCuts!.at(-1)!.split).toEqual({ fingers: 5 });
    expect(updatePartCut(document, document.partCuts![0]!.id, { split: { fingers: 3 } }).partCuts![0]!.split).toEqual({ fingers: 3 });
    for (const split of ['unknown', null, {}, { fingers: '5' }]) {
      const invalid = JSON.parse(JSON.stringify(document));
      invalid.partCuts[0].split = split;
      expect(() => parseCadDocument(invalid)).toThrow('Invalid CAD part cut');
    }
    expect(() => updatePartCut(document, document.partCuts![0]!.id, { split: { fingers: 1 } })).toThrow('Invalid CAD part cut');
  });

  it('splits the actual rectangular reach of a stepped board', async () => {
    const document = joint('half');
    const target = document.parts[0]!;
    document.parts[0] = {
      ...outlined(
        target.name,
        [
          [0, 0],
          [100, 0],
          [100, 60],
          [20, 60],
          [20, 100],
          [0, 100],
        ],
        0
      ),
      id: target.id,
      placement: target.placement,
    };
    const solved = await solveCadDocument(document);
    expect(solved.parts[0]!.cuts![0]!.opening!.y0).toBeCloseTo(29.8);
    expect(solved.parts[1]!.cuts![0]!.opening!.y1).toBeCloseTo(30.2);
    expect(assemblyReport(solved.document, solved.parts)!.collisions).toEqual([]);
  });

  it('uses the shapes from before all steps for both sides of the joint', async () => {
    const document = joint('half');
    const expected = await solveCadDocument(document);
    const normal = { ...document.partCuts![0]!, id: 'earlier-cut', split: undefined };
    document.partCuts!.unshift(normal);
    const solved = await solveCadDocument(document);
    for (const [index, part] of solved.parts.entries())
      expect(part.cuts!.filter(cut => !cut.id.startsWith('cut-parts:earlier-cut:'))).toEqual(expected.parts[index]!.cuts);
    expect(solved.diagnostics.filter(diagnostic => diagnostic.code === 'part-cut-unresolved')).toEqual([]);
  });

  it('relieves closed slot corners on both boards', async () => {
    const document = joint('half');
    for (const part of document.parts) part.cornerRelief = { diameter: 6 };
    const solved = await solveCadDocument(document);
    for (const part of solved.parts) {
      expect(part.cuts![0]!.outline.length).toBeGreaterThan(4);
      expect(part.cuts![0]!.opening!.y1 - part.cuts![0]!.opening!.y0).toBeCloseTo(50.2);
    }
    expect(assemblyReport(solved.document, solved.parts)!.collisions).toEqual([]);
  });

  it('refuses parts that are not square without cutting either one', async () => {
    const document = joint('half');
    document.parts[1]!.placement!.rotation = [Math.sin(Math.PI / 8), 0, 0, Math.cos(Math.PI / 8)];
    const solved = await solveCadDocument(document);
    expect(solved.parts.every(part => !part.cuts?.length)).toBe(true);
    expect(solved.diagnostics).toContainEqual(
      expect.objectContaining({
        code: 'part-cut-unresolved',
        message: expect.stringMatching(/Along.*Across/),
      })
    );
  });

  it('refuses parallel boards and names both', async () => {
    const document = joint('half');
    document.parts[1]!.placement = document.parts[0]!.placement;
    const solved = await solveCadDocument(document);
    expect(solved.parts.every(part => !part.cuts?.length)).toBe(true);
    expect(solved.diagnostics).toContainEqual(
      expect.objectContaining({
        code: 'part-cut-unresolved',
        message: expect.stringMatching(/Across.*Along|Along.*Across/),
      })
    );
  });

  it.each([1, 0, -2, 2.5, NaN])('rejects invalid fingers %s in parsing, creation and evaluation', async fingers => {
    const document = joint({ fingers });
    expect(() => parseCadDocument(JSON.parse(JSON.stringify(document)))).toThrow('Invalid CAD part cut');
    expect(() => addPartCut(document, [], [], { value: 0.2 }, { fingers })).toThrow('Invalid CAD part cut');
    const solved = await solveCadDocument(document);
    expect(solved.parts.every(part => !part.cuts?.length)).toBe(true);
    expect(solved.diagnostics).toContainEqual(expect.objectContaining({ code: 'part-cut-unresolved' }));
  });
});
