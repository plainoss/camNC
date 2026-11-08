import { describe, expect, it } from 'vitest';
import {
  createCadDocument,
  createPlateDocument,
  parseCadDocument,
  partFaceAt,
  placePoint,
  resolveDrawnPlacements,
  setCadVariable,
  solveCadDocument,
  type CadDimension,
  type CadDocument,
  type CadDrawnOn,
  type CadPart,
} from './index';

const close = (actual: readonly number[], expected: readonly number[]) => expected.forEach((v, i) => expect(actual[i]).toBeCloseTo(v, 6));
/** A plate whose width and height follow expressions, drawn on something. */
function plate(name: string, width: string, height: string, thickness: number, drawnOn: CadDrawnOn): CadPart {
  const part = { ...createPlateDocument({ width: 100, height: 100, thickness }).parts[0]!, name, drawnOn };
  const dimension = (label: string) => part.sketch.constraints.find((c): c is CadDimension => c.label === label && 'value' in c)!;
  dimension('Width').expression = width;
  dimension('Height').expression = height;
  return part;
}
/** The plate's left edge line, from (0, 0) up to (0, height). */
const leftEdge = (part: CadPart) => {
  const points = new Map(part.sketch.entities.flatMap(e => (e.type === 'point' ? [[e.id, e] as const] : [])));
  return part.sketch.entities.find(e => e.type === 'line' && points.get(e.startId)!.x === 0 && points.get(e.endId)!.x === 0)!.id;
};

describe('parts drawn on planes and faces', () => {
  it('stands a part drawn on the right plane up, its sketch x along y and its height up z', () => {
    const side = plate('Side', 'depth', 'height', 20, { on: { plane: 'right' }, offset: 0 });
    const { document } = resolveDrawnPlacements({ ...createCadDocument(), parts: [side] });
    const placed = document.parts[0]!.placement!;
    close(placePoint(placed, [130, 0, 0]), [0, 130, 0]);
    close(placePoint(placed, [0, 500, 0]), [0, 0, 500]);
    close(placePoint(placed, [0, 0, 20]), [20, 0, 0]);
  });

  it('puts a part drawn on another’s edge face against that edge, and inward by an offset', () => {
    const side = plate('Side', 'depth', 'height', 20, { on: { plane: 'right' }, offset: 0 });
    // The back, drawn on the side's left edge face (its sketch's x = 0 edge, the back edge once standing), set 10 mm in.
    const back: CadPart = plate('Back', 'height', 'width', 4, {
      on: { partId: side.id, face: { edge: leftEdge(side) } },
      offset: -10,
      inward: true,
    });
    const { document, diagnostics } = resolveDrawnPlacements({ ...createCadDocument(), parts: [side, back] });
    expect(diagnostics).toEqual([]);
    const placed = document.parts[1]!.placement!;
    // The side's sketch x = 0 edge is at y = 0 in the assembly; its outward face looks along -y.
    const corners = [placePoint(placed, [0, 0, 0]), placePoint(placed, [0, 0, 4])];
    expect(corners.map(c => Math.round(c[1]! * 1000) / 1000).sort((a, b) => a - b)).toEqual([10, 14]);
  });

  it('follows the part it’s drawn on as that part changes, through a solve', async () => {
    let document: CadDocument = {
      ...createCadDocument(),
      parts: [plate('Bottom', 'width', 'depth', 18, { on: { plane: 'top' }, offset: 0 })],
    };
    const bottom = document.parts[0]!;
    document.parts.push(
      plate('Top', 'width', 'depth', 18, { on: { partId: bottom.id, face: 'top' }, offset: 300, offsetExpression: 'height' })
    );
    for (const [name, expression] of [
      ['width', '600mm'],
      ['depth', '300mm'],
      ['height', '400mm'],
    ] as const) {
      const result = setCadVariable(document, { name, expression });
      if ('error' in result) throw new Error(result.error);
      document = result.document;
    }
    let solved = await solveCadDocument(document);
    close(solved.document.parts[1]!.placement!.position, [0, 0, 418]);
    const result = setCadVariable(solved.document, {
      id: solved.document.variables!.find(v => v.name === 'height')!.id,
      name: 'height',
      expression: '500mm',
    });
    if ('error' in result) throw new Error(result.error);
    solved = await solveCadDocument(result.document);
    close(solved.document.parts[1]!.placement!.position, [0, 0, 518]);
    expect(parseCadDocument(JSON.parse(JSON.stringify(solved.document))).parts[1]!.drawnOn).toEqual(solved.document.parts[1]!.drawnOn);
  });

  it('says when the part it’s drawn on is gone, and leaves it where it was', () => {
    const top = plate('Top', 'width', 'depth', 18, { on: { partId: 'gone', face: 'top' }, offset: 0 });
    const { diagnostics } = resolveDrawnPlacements({ ...createCadDocument(), parts: [top] });
    expect(diagnostics.map(d => d.message)).toEqual(['Top: The part it was drawn on is gone.']);
  });
});

describe('finding the face a click landed on', () => {
  it('tells the top, the underside and an edge face apart', () => {
    const side = plate('Side', 'depth', 'height', 20, { on: { plane: 'right' }, offset: 0 });
    const placed = resolveDrawnPlacements({ ...createCadDocument(), parts: [side] }).document.parts[0]!.placement!;
    // Standing on the right plane, the side's top looks along +x and its sketch x = 0 edge along -y.
    expect(partFaceAt(side, placed, [20, 50, 50], [1, 0, 0])).toBe('top');
    expect(partFaceAt(side, placed, [0, 50, 50], [-1, 0, 0])).toBe('underside');
    expect(partFaceAt(side, placed, [10, 0, 50], [0, -1, 0])).toEqual({ edge: leftEdge(side) });
    expect(partFaceAt(side, placed, [10, 0, 50], [0, -0.7, 0.7])).toBeNull();
  });
});
