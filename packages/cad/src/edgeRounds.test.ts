import { describe, expect, it } from 'vitest';
import { addCircle, addRectangle, createCadDocument, createCadPart, parseCadDocument } from './document';
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
    expect(designSteps(over).find(step => step.id === 'f')?.broken).toBe('Failed to fillet selections.');
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
