import { describe, expect, it } from 'vitest';
import {
  assemblyReport,
  addLine,
  createCadDocument,
  createCadPart,
  createPlateDocument,
  evaluateCadDocument,
  setCadVariable,
  solveCadDocument,
  type CadDimension,
  type CadDocument,
  type CadPart,
  type CadPlacement,
  type EvaluatedCadCut,
  type EvaluatedCadPart,
} from './index';

const panel = (name: string, width: number, height: number, placement: CadPlacement, widthExpression?: string): CadPart => {
  const part = { ...createPlateDocument({ width, height, thickness: 18 }).parts[0]!, name, placement };
  if (widthExpression) part.sketch.constraints.find((c): c is CadDimension => c.label === 'Width')!.expression = widthExpression;
  return part;
};
const flat = (x: number, y: number, z: number): CadPlacement => ({ position: [x, y, z], rotation: [0, 0, 0, 1] });
// A quarter turn about y stands a panel up with its thickness along -x.
const standing = (x: number): CadPlacement => ({ position: [x, 0, 0], rotation: [0, -Math.SQRT1_2, 0, Math.SQRT1_2] });
const report = (document: CadDocument) => assemblyReport(document, evaluateCadDocument(document).parts)!;

describe('parts in the same place', () => {
  it('reports two panels that overlap, with the box and volume they share', () => {
    const document = {
      ...createCadDocument(),
      parts: [panel('Bottom', 300, 200, flat(0, 0, 0)), panel('Shelf', 300, 200, flat(100, 0, 10))],
    };
    expect(report(document).collisions).toEqual([
      {
        parts: ['Bottom', 'Shelf'],
        partIds: [document.parts[0]!.id, document.parts[1]!.id],
        at: [100, 0, 10],
        size: [200, 200, 8],
        volume: 320000,
      },
    ]);
  });

  it('lets parts touch face to face', () => {
    const document = { ...createCadDocument(), parts: [panel('Bottom', 300, 200, flat(0, 0, 0)), panel('Top', 300, 200, flat(0, 0, 18))] };
    expect(report(document).collisions).toEqual([]);
  });

  it('finds the side a width change pushed through a shelf it doesn’t follow', async () => {
    // The shelf grows with `width`, while the right side stays where it was put.
    let document: CadDocument = {
      ...createCadDocument(),
      parts: [panel('Shelf', 564, 280, flat(18, 0, 100), 'width - 36mm'), panel('Right side', 300, 280, standing(600))],
    };
    for (const expression of ['600mm', '700mm']) {
      const result = setCadVariable(document, { id: document.variables?.[0]?.id, name: 'width', expression });
      if ('error' in result) throw new Error(result.error);
      const solved = await solveCadDocument(result.document);
      document = solved.document;
      const clashes = assemblyReport(document, solved.parts)!.collisions.map(clash => clash.parts);
      expect(clashes).toEqual(expression === '600mm' ? [] : [['Shelf', 'Right side']]);
    }
  });

  it('finds an overlap along a slanted edge', () => {
    let triangle = { ...createCadPart('Triangle', 18) };
    for (const [x1, y1, x2, y2] of [
      [0, 0, 100, 0],
      [100, 0, 0, 100],
      [0, 100, 0, 0],
    ] as const)
      triangle = { ...triangle, sketch: addLine(triangle.sketch, { x1, y1, x2, y2 }) };
    const block = panel('Block', 20, 100, flat(80, 0, 0));
    const document = { ...createCadDocument(), parts: [{ ...triangle, placement: flat(0, 0, 0) }, block] };
    expect(report(document).collisions.map(clash => clash.parts)).toEqual([['Triangle', 'Block']]);
  });

  it('keeps exact pocket depths for a part with a slanted hole', () => {
    // Two coincident panels, one pocketed 8.9 mm from the top and one 9 mm from below, share a 0.1 mm layer. A small
    // diamond hole in one mustn't make the layer fall between the even samples.
    const square = [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 100, y: 100 },
      { x: 0, y: 100 },
    ];
    const pocket = (side: 'top' | 'underside', to: number): EvaluatedCadCut => ({
      id: side,
      regionId: side,
      side,
      from: 0,
      to,
      through: false,
      outline: square,
      islands: [],
    });
    const parts: EvaluatedCadPart[] = [
      {
        partId: 'a',
        name: 'A',
        thickness: 18,
        outline: square,
        holes: [
          [
            { x: 50, y: 48 },
            { x: 52, y: 50 },
            { x: 50, y: 52 },
            { x: 48, y: 50 },
          ],
        ],
        loops: [],
        cuts: [pocket('top', 8.9)],
      },
      { partId: 'b', name: 'B', thickness: 18, outline: square, holes: [], loops: [], cuts: [pocket('underside', 9)] },
    ];
    const document = {
      ...createCadDocument(),
      parts: [
        { ...createCadPart('A', 18), id: 'a', placement: flat(0, 0, 0) },
        { ...createCadPart('B', 18), id: 'b', placement: flat(0, 0, 0) },
      ],
    };
    const [clash] = assemblyReport(document, parts)!.collisions;
    expect(clash!.parts).toEqual(['A', 'B']);
    expect(clash!.volume).toBeGreaterThan(900);
  });
});
