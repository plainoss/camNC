import { describe, expect, it } from 'vitest';
import { addCircle, addLine, addRectangle, createCadDocument, createCadPart, parseCadDocument } from './document';
import { designSteps } from './designSteps';
import { faceRims, rimAt, rimLoops } from './edgeRounds';
import { evaluateCadDocument } from './features';
import { filletProblems } from './filletProblems';
import type { CadDocument, CadEdgeFillet, CadPart, EvaluatedCadPart } from './types';

/** A cup: a Ø77.8 × 20 cylinder with a Ø67.2 pocket 16 deep from its top, leaving a 5.3 rim and a 4 mm floor. */
function plainCup(): CadDocument {
  const body: CadPart = { ...createCadPart('Part 1', 20), id: 'body' };
  body.sketch = addCircle(body.sketch, { x: 0, y: 0, radius: 38.9 });
  const pocket: CadPart = { ...createCadPart('Pocket', 20), id: 'pocket', drawnOn: { on: { partId: 'body', face: 'top' }, offset: 0 } };
  pocket.sketch = addCircle(pocket.sketch, { x: 0, y: 0, radius: 33.6 });
  return { ...createCadDocument(), parts: [body, { ...pocket, remove: { depth: 16 } }] };
}
const theCup = plainCup();
/** The same cup each time, so its cut keeps its ID, with these Fillet steps. */
const cup = (fillets?: CadEdgeFillet[]): CadDocument =>
  fillets ? { ...theCup, parts: [{ ...theCup.parts[0]!, fillets }, theCup.parts[1]!] } : theCup;

function made(document: CadDocument): EvaluatedCadPart {
  const evaluated = evaluateCadDocument(document);
  expect(evaluated.diagnostics.filter(d => d.severity === 'error')).toEqual([]);
  return evaluated.parts.find(part => part.partId === 'body')!;
}

const rimCut = (part: EvaluatedCadPart) => part.cuts![0]!.id;

describe('edges along a part’s faces', () => {
  it('are its outline and holes on both sides, and each cut’s opening, with the wall below each', () => {
    const part = made(cup());
    const loops = rimLoops(part).map(({ id, side, at, material, wall }) => ({ id, side, at, material, wall }));
    expect(loops).toEqual([
      { id: 'outline', side: 'top', at: 0, material: 'inside', wall: 20 },
      { id: 'outline', side: 'underside', at: 0, material: 'inside', wall: 20 },
      { id: rimCut(part), side: 'top', at: 0, material: 'outside', wall: 16 },
    ]);
  });

  it('a click on the rim face picks both of its edges, and one in the pocket is refused', () => {
    const part = made(cup());
    expect(faceRims(part, 'top', { x: -26, y: 26 })).toEqual({ side: 'top', loops: ['outline', rimCut(part)], face: true });
    expect(faceRims(part, 'top', { x: 0, y: 0 })).toHaveProperty('error');
    expect(faceRims(part, 'underside', { x: 0, y: 0 })).toEqual({ side: 'underside', loops: ['outline'], face: true });
  });

  it('a picked mesh edge is found on the loop it lies along, and an inside edge is refused', () => {
    const part = made(cup());
    const along = (radius: number, z: number) => {
      const a: [number, number, number] = [radius, 0, z],
        b: [number, number, number] = [radius * Math.cos(0.05), radius * Math.sin(0.05), z];
      return rimAt(part, a, b);
    };
    expect(along(33.6, 20)).toEqual({ loopId: rimCut(part), side: 'top' });
    expect(along(38.9, 20)).toEqual({ loopId: 'outline', side: 'top' });
    expect(along(38.9, 0)).toEqual({ loopId: 'outline', side: 'underside' });
    expect(along(33.6, 4)).toHaveProperty('error', expect.stringContaining('inside edge'));
    expect(rimAt(part, [38.9, 0, 0], [38.9, 0, 20])).toHaveProperty('error');
  });
});

describe('a Fillet step along a face', () => {
  const rim = (part: EvaluatedCadPart, radius: number): CadEdgeFillet => ({
    id: 'f',
    corners: [],
    rims: [{ side: 'top', loops: ['outline', rimCut(part)], face: true }],
    radius,
  });

  it('rounds both edges of a cup’s rim, and is saved with the design', () => {
    const document = cup([rim(made(cup()), 1)]);
    const part = made(document);
    expect(part.rounds?.map(({ loopId, side, at, radius, material }) => ({ loopId, side, at, radius, material }))).toEqual([
      { loopId: 'outline', side: 'top', at: 0, radius: 1, material: 'inside' },
      { loopId: rimCut(part), side: 'top', at: 0, radius: 1, material: 'outside' },
    ]);
    expect(filletProblems(document, document.parts[0]!)).toEqual([]);
    expect(designSteps(document).find(step => step.id === 'f')?.broken).toBeUndefined();
    expect(parseCadDocument(JSON.parse(JSON.stringify(document))).parts[0]!.fillets).toEqual(document.parts[0]!.fillets);
  });

  it('fits up to half the rim’s width on both edges, and is marked broken past it', () => {
    const fits = cup([rim(made(cup()), 2.6)]);
    expect(made(fits).rounds).toHaveLength(2);
    const over = cup([rim(made(cup()), 3)]);
    expect(made(over).rounds).toBeUndefined();
    expect(filletProblems(over, over.parts[0]!)[0]?.message).toMatch(/overlap on a 5\.3 mm wide face/);
    // Rounds running into each other say so on the row.
    expect(designSteps(over).find(step => step.id === 'f')?.broken).toBe('Overlapping fillets.');
  });

  it('on one edge of the rim fits the rim’s whole width, but not more than the wall below it', () => {
    const part = made(cup());
    const one = (radius: number): CadEdgeFillet => ({ id: 'f', corners: [], rims: [{ side: 'top', loops: [rimCut(part)] }], radius });
    expect(made(cup([one(5)])).rounds).toHaveLength(1);
    expect(made(cup([one(6)])).rounds).toBeUndefined();
    const deep = made(cup([{ id: 'f', corners: [], rims: [{ side: 'underside', loops: ['outline'] }], radius: 25 }]));
    expect(deep.rounds).toBeUndefined();
  });

  it('can’t overlap across a narrow part', () => {
    const strip: CadPart = { ...createCadPart('Strip', 18), id: 'strip' };
    strip.sketch = addRectangle(strip.sketch, { x: 0, y: 0, width: 100, height: 6 });
    const round = (radius: number) => ({
      ...createCadDocument(),
      parts: [{ ...strip, fillets: [{ id: 'f', corners: [], rims: [{ side: 'top' as const, loops: ['outline'] }], radius }] }],
    });
    expect(evaluateCadDocument(round(2.9)).parts[0]!.rounds).toHaveLength(1);
    expect(evaluateCadDocument(round(3.2)).parts[0]!.rounds).toBeUndefined();
  });

  it('leaves an edge that’s gone sharp, and says so', () => {
    const document = cup([{ id: 'f', corners: [], rims: [{ side: 'top', loops: ['gone'] }], radius: 1 }]);
    expect(filletProblems(document, document.parts[0]!)[0]?.message).toMatch(/is gone/);
  });
});

describe('edges along faces with other cuts', () => {
  const plate = (draw: (sketch: CadPart['sketch']) => CadPart['sketch'], depth: number | 'through', more?: CadPart) => {
    const board: CadPart = { ...createCadPart('Plate', 18), id: 'board' };
    board.sketch = addRectangle(board.sketch, { x: 0, y: 0, width: 100, height: 60 });
    const cut: CadPart = { ...createCadPart('Cut', 18), id: 'cut', drawnOn: { on: { partId: 'board', face: 'top' }, offset: 0 } };
    cut.sketch = draw(cut.sketch);
    const document = { ...createCadDocument(), parts: [board, { ...cut, remove: { depth } }, ...(more ? [more] : [])] };
    const evaluated = evaluateCadDocument(document);
    expect(evaluated.diagnostics.filter(d => d.severity === 'error')).toEqual([]);
    return evaluated.parts.find(part => part.partId === 'board')!;
  };
  const summary = (part: EvaluatedCadPart) => rimLoops(part).map(({ id, side, at, wall }) => [id.split(':')[0], side, at, wall]);

  it('leave out a rabbet running off the edge, and the outline’s edge it cuts away', () => {
    const part = plate(sketch => addRectangle(sketch, { x: 90, y: -10, width: 20, height: 80 }), 6);
    expect(summary(part)).toEqual([['outline', 'underside', 0, 18]]);
    expect(faceRims(part, 'top', { x: 50, y: 30 })).toHaveProperty('error');
  });

  it('put a counterbore’s hole on the floor of its bore', () => {
    const bore: CadPart = { ...createCadPart('Hole', 18), id: 'small', drawnOn: { on: { partId: 'board', face: 'top' }, offset: 0 } };
    bore.sketch = addCircle(bore.sketch, { x: 50, y: 30, radius: 5 });
    const part = plate(sketch => addCircle(sketch, { x: 50, y: 30, radius: 10 }), 5, { ...bore, remove: { depth: 15 } });
    expect(summary(part)).toEqual([
      ['outline', 'top', 0, 18],
      ['outline', 'underside', 0, 18],
      ['cut', 'top', 0, 5],
      ['small', 'top', 5, 10],
    ]);
    expect(faceRims(part, 'top', { x: 5, y: 5 })).toMatchObject({ loops: ['outline', expect.stringMatching(/^cut:/)] });
  });

  it('give a through cut an opening on both faces', () => {
    const part = plate(sketch => addRectangle(sketch, { x: 20, y: 20, width: 30, height: 20 }), 'through');
    expect(summary(part)).toEqual([
      ['outline', 'top', 0, 18],
      ['outline', 'underside', 0, 18],
      ['cut', 'top', 0, 18],
      ['cut', 'underside', 0, 18],
    ]);
  });

  it('round a sharp-cornered part, its rounds meeting in a miter at each corner', () => {
    const tri: CadPart = { ...createCadPart('Triangle', 18), id: 'tri' };
    let sketch = addLine(tri.sketch, { x1: 0, y1: 0, x2: 100, y2: 0 });
    sketch = addLine(sketch, { x1: 100, y1: 0, x2: 50, y2: 86.6 });
    tri.sketch = addLine(sketch, { x1: 50, y1: 86.6, x2: 0, y2: 0 });
    const round = (radius: number) =>
      evaluateCadDocument({
        ...createCadDocument(),
        parts: [{ ...tri, fillets: [{ id: 'f', corners: [], rims: [{ side: 'top', loops: ['outline'] }], radius }] }],
      }).parts[0]!.rounds;
    expect(round(1)).toHaveLength(1);
    // Past the biggest circle inside it, 28.9, a round leaves no top face.
    expect(round(15)).toHaveLength(1);
    expect(
      evaluateCadDocument({
        ...createCadDocument(),
        parts: [{ ...tri, thickness: 40, fillets: [{ id: 'f', corners: [], rims: [{ side: 'top', loops: ['outline'] }], radius: 30 }] }],
      }).parts[0]!.rounds
    ).toBeUndefined();
  });
});
