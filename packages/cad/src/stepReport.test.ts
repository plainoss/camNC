import { describe, expect, it } from 'vitest';
import {
  addLine,
  addPartCut,
  cadFaceFacing,
  cadFaceFrame,
  cadFaceName,
  cadStepReport,
  createCadDocument,
  createCadPart,
  createPlateDocument,
  setPartPattern,
  solveCadDocument,
  type CadDrawnOn,
  type CadPart,
} from './index';

const plate = (name: string, width: number, height: number, drawnOn: CadDrawnOn): CadPart => ({
  ...createPlateDocument({ width, height, thickness: 18 }).parts[0]!,
  name,
  drawnOn,
});

describe('reading faces by the way they look', () => {
  // Standing on the right plane, the side's sketch x runs along +y, its y up +z, and its top looks along +x.
  const side = plate('Side', 300, 720, { on: { plane: 'right' }, offset: 0 });

  it('finds each face of a standing side by direction, and names it back', async () => {
    const { document } = await solveCadDocument({ ...createCadDocument(), parts: [side] });
    const facing = (direction: '+x' | '-x' | '+y' | '-y' | '+z' | '-z') => {
      const found = cadFaceFacing(document, side.id, direction);
      if ('error' in found) throw new Error(found.error);
      return cadFaceName(document, { partId: side.id, face: found.face });
    };
    expect(['+x', '-x', '+y', '-y', '+z', '-z'].map(d => facing(d as '+x'))).toEqual([
      "Side's top (+x)",
      "Side's underside (-x)",
      "Side's +y face",
      "Side's -y face",
      "Side's +z face",
      "Side's -z face",
    ]);
    const top = cadFaceFacing(document, side.id, '+z');
    expect(cadFaceFrame(document, { partId: side.id, ...(top as { face: { edge: string } }) })).toEqual({
      // The top edge, walked counterclockwise from the sketch's top right corner towards its top left.
      origin: [0, 300, 720],
      x: [0, -1, 0],
      y: [1, 0, 0],
      normal: [0, 0, 1],
      length: 300,
    });
    expect(cadFaceFrame(document, { plane: 'front' })).toEqual({ origin: [0, 0, 0], x: [1, 0, 0], y: [0, 0, 1], normal: [0, -1, 0] });
  });

  it('lists the ways a part’s faces do look when none looks the way asked', () => {
    let triangle = { ...createCadPart('Gusset', 18) };
    for (const [x1, y1, x2, y2] of [
      [0, 0, 100, 0],
      [100, 0, 0, 100],
      [0, 100, 0, 0],
    ] as const)
      triangle = { ...triangle, sketch: addLine(triangle.sketch, { x1, y1, x2, y2 }) };
    const document = { ...createCadDocument(), parts: [triangle] };
    expect(cadFaceFacing(document, triangle.id, '+y')).toEqual({
      error: 'Gusset has no face pointing +y. Its faces point +z (top), -z (underside), -y, -x, plus 1 slanted.',
    });
  });
});

describe('the step report', () => {
  it('names the part, face and world direction for top and underside sketches', async () => {
    const side = plate('Side', 300, 720, { on: { plane: 'right' }, offset: 0 });
    const top = plate('Top cleat', 100, 20, { on: { partId: side.id, face: 'top' }, offset: 0 });
    const underside = plate('Underside cleat', 100, 20, { on: { partId: side.id, face: 'underside' }, offset: 0 });
    const solved = await solveCadDocument({ ...createCadDocument(), parts: [side, top, underside] });
    expect(cadStepReport(solved.document, solved.parts)).toMatchObject([
      { on: 'the right plane', frame: { normal: [1, 0, 0] } },
      { on: "Side's top (+x)", frame: { origin: [18, 0, 0], x: [0, 1, 0], y: [0, 0, 1], normal: [1, 0, 0] } },
      { on: "Side's underside (-x)", frame: { origin: [0, 0, 0], x: [0, -1, 0], y: [0, 0, 1], normal: [-1, 0, 0] } },
    ]);
  });

  it('rounds a placement with floating point error to three decimals only in the report', async () => {
    const part = plate('Panel', 100, 100, { on: { plane: 'top' }, offset: 1199.999998 });
    const solved = await solveCadDocument({ ...createCadDocument(), parts: [part] });
    expect(cadStepReport(solved.document, solved.parts)[0]).toMatchObject({
      offset: 1200,
      placement: { position: [0, 0, 1200] },
    });
    expect(solved.document.parts[0]!.placement!.position[2]).toBe(1199.999998);
    expect(solved.document.parts[0]!.drawnOn!.offset).toBe(1199.999998);
  });

  it('rounds frames, positions and pattern copies, keeping rotations exact, without changing their source values', () => {
    const base = {
      ...createPlateDocument({ width: 100.123456, height: 100, thickness: 18.123456 }).parts[0]!,
      name: 'Base',
      placement: {
        position: [1199.999998, -0.000001, 2.123456] as [number, number, number],
        rotation: [0, 0, 0.382683432, 0.923879533] as [number, number, number, number],
      },
    };
    const post = {
      ...plate('Post', 20, 20, {
        on: { partId: base.id, face: { edge: base.sketch.entities.find(entity => entity.type === 'line')!.id } },
        offset: 0.123456,
      }),
      placement: base.placement,
    };
    const document = setPartPattern({ ...createCadDocument(), parts: [base, post] }, post.id, { axis: 'x', count: 2, spacing: 150.123456 });
    document.parts[1]!.copies![0]!.placement = base.placement;
    const before = JSON.stringify(document);
    const report = cadStepReport(document, []);
    expect(report[0]).toMatchObject({
      offset: 0.123,
      placement: { position: [1200, 0, 2.123], rotation: [0, 0, 0.382683432, 0.923879533] },
      frame: { origin: [1200, 0, 2.123], x: [0.707, 0.707, 0], y: [0, 0, 1], normal: [0.707, -0.707, 0], length: 100.123 },
    });
    expect(report[1]).toMatchObject({ spacing: 150.123, copies: [{ position: [1200, 0, 2.123] }] });
    expect(JSON.stringify(document)).toBe(before);
  });

  it('reports the actual circular axis, angular mode and expressions without stale linear settings', () => {
    const source = createPlateDocument({ width: 20, height: 30, thickness: 18 });
    const part = source.parts[0]!;
    const document = setPartPattern(source, part.id, {
      axis: 'x',
      spacing: 999,
      count: 3,
      countExpression: '#legs',
      circular: {
        origin: [1.123456, -0.000001, 3.987654],
        axis: [0, 0.6, 0.8],
        angle: 123.456789,
        angleExpression: '#sweep',
        equalSpacing: false,
        opposite: true,
      },
    });
    const before = JSON.stringify(document);
    const report = cadStepReport(document, []);
    expect(report).toEqual([
      {
        kind: 'pattern',
        partId: part.id,
        part: 'Plate',
        count: 3,
        countExpression: '#legs',
        circular: {
          origin: [1.123, 0, 3.988],
          axis: [0, 0.6, 0.8],
          angle: 123.457,
          angleExpression: '#sweep',
          equalSpacing: false,
          opposite: true,
        },
        copies: [
          { name: 'Plate 2', position: expect.any(Array) },
          { name: 'Plate 3', position: expect.any(Array) },
        ],
      },
    ]);
    const entry = report[0];
    if (entry?.kind !== 'pattern' || !entry.circular) throw new Error('Missing circular diagnostic');
    entry.circular.origin[0] = 99;
    entry.circular.axis[0] = 99;
    expect(JSON.stringify(document)).toBe(before);
    const defaults = setPartPattern(source, part.id, {
      axis: 'x',
      spacing: 999,
      count: 4,
      circular: { origin: [0, 0, 0], axis: [0, 0, 1], angle: 360 },
    });
    expect(cadStepReport(defaults, [])[0]).toMatchObject({ circular: { equalSpacing: true, opposite: false } });
  });

  it('says what each step refers to and what it came to: the face, the copies and every opening', async () => {
    const side = plate('Side', 300, 720, { on: { plane: 'right' }, offset: 0 });
    // A shelf 250 deep on the top plane, raised to 300 mm, running through the side's thickness.
    const shelf = plate('Shelf', 500, 250, { on: { plane: 'top' }, offset: 300 });
    let document = { ...createCadDocument(), parts: [side, shelf] };
    document = addPartCut(document, [shelf.id], [side.id], { value: 0.2000004 }).document;
    document = setPartPattern(document, shelf.id, { axis: 'z', count: 2, spacing: 200 });
    const solved = await solveCadDocument(document);
    const report = cadStepReport(solved.document, solved.parts);
    expect(report.map(entry => (entry.kind === 'partCut' ? entry.kind : `${entry.kind} ${entry.part}`))).toEqual([
      'drawnOn Side',
      'drawnOn Shelf',
      'pattern Shelf',
      'partCut',
    ]);
    expect(report[1]).toMatchObject({ on: 'the top plane', offset: 300, placement: { position: [0, 0, 300] } });
    expect(report[2]).toMatchObject({ count: 2, spacing: 200, copies: [{ name: 'Shelf 2', position: [0, 0, 500] }] });
    // In the side's sketch, x runs along the shelf's depth from the open front, and y up across its thickness.
    expect(report[3]).toEqual({
      kind: 'partCut',
      stepId: solved.document.partCuts![0]!.id,
      tools: ['Shelf'],
      targets: ['Side'],
      clearance: 0.2,
      cuts: [
        { target: 'Side', tool: 'Shelf', side: 'top', width: 250.2, length: 18.4, depth: 18, through: true, at: { x: 0, y: 299.8 } },
        { target: 'Side', tool: 'Shelf 2', side: 'top', width: 250.2, length: 18.4, depth: 18, through: true, at: { x: 0, y: 499.8 } },
      ],
    });
  });

  it('lays a pattern out from an unplaced part that others are drawn on, as it sits at the origin', async () => {
    const base = { ...createPlateDocument({ width: 100, height: 100, thickness: 18 }).parts[0]!, name: 'Base' };
    const post = plate('Post', 20, 20, { on: { partId: base.id, face: 'top' }, offset: 0 });
    let document = { ...createCadDocument(), parts: [base, post] };
    document = setPartPattern(document, base.id, { axis: 'x', count: 2, spacing: 150 });
    const solved = await solveCadDocument(document);
    expect(solved.document.parts[0]!.placement).toBeUndefined();
    expect(solved.document.parts[0]!.copies![0]!.placement!.position).toEqual([150, 0, 0]);
  });
});
