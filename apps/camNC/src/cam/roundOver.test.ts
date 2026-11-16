import {
  addCircle,
  addRectangle,
  createCadDocument,
  createCadPart,
  evaluateCadDocument,
  type CadDocument,
  type CadEdgeFillet,
  type CadPart,
} from '@wbcnc/cad';
import { describe, expect, it } from 'vitest';
import { nativePart } from './nativeCadModel';

/** The solid's volume from its surface: only a closed mesh with outward faces gets this right. */
function volume(positions: ArrayLike<number>) {
  let sum = 0;
  for (let i = 0; i < positions.length; i += 9) {
    const [ax, ay, az, bx, by, bz, cx, cy, cz] = Array.from({ length: 9 }, (_, k) => positions[i + k]!);
    sum += ax! * (by! * cz! - bz! * cy!) - ay! * (bx! * cz! - bz! * cx!) + az! * (bx! * cy! - by! * cx!);
  }
  return sum / 6;
}

/** A cup: a Ø77.8 × 20 cylinder with a Ø67.2 pocket 16 deep from its top, leaving a 5.3 rim and a 4 mm floor. */
const body: CadPart = { ...createCadPart('Part 1', 20), id: 'body' };
body.sketch = addCircle(body.sketch, { x: 0, y: 0, radius: 38.9 });
const pocket: CadPart = { ...createCadPart('Pocket', 20), id: 'pocket', drawnOn: { on: { partId: 'body', face: 'top' }, offset: 0 } };
pocket.sketch = addCircle(pocket.sketch, { x: 0, y: 0, radius: 33.6 });
const cup = (fillets?: CadEdgeFillet[]): CadDocument => ({
  ...createCadDocument(),
  parts: [
    { ...body, ...(fillets && { fillets }) },
    { ...pocket, remove: { depth: 16 } },
  ],
});
const made = (document: CadDocument) => evaluateCadDocument(document).parts.find(part => part.partId === 'body')!;
const rimCut = made(cup()).cuts![0]!.id;

/** What rounding over an edge of a circle of radius `at` takes away (Pappus): the corner less a quarter circle, turned. */
const removed = (at: number, r: number, inside: boolean) => {
  const area = r * r * (1 - Math.PI / 4),
    centroid = (r * (10 - 3 * Math.PI)) / (3 * (4 - Math.PI));
  return area * 2 * Math.PI * (inside ? at - centroid : at + centroid);
};

describe('a part with edges rounded over', () => {
  it('curves both edges of a cup’s rim into its face, taking away what the rounds do', () => {
    const plain = volume(nativePart(made(cup())).entry.part.mesh.positions);
    const fillet: CadEdgeFillet = { id: 'f', corners: [], rims: [{ side: 'top', loops: ['outline', rimCut], face: true }], radius: 1 };
    const rounded = nativePart(made(cup([fillet]))).entry.part.mesh;
    const taken = removed(38.9, 1, true) + removed(33.6, 1, false);
    expect(taken).toBeCloseTo(97.8, 1);
    expect((plain - volume(rounded.positions)) / taken).toBeCloseTo(1, 1);
    // The rim's face is narrower by both rounds, and the walls meet it nowhere outside the rounds.
    const zs = Array.from({ length: rounded.positions.length / 3 }, (_, i) => rounded.positions[i * 3 + 2]!);
    expect(Math.max(...zs)).toBeCloseTo(20, 6);
    for (let i = 0; i < rounded.positions.length; i += 3) {
      const reach = Math.hypot(rounded.positions[i]! - 38.9, rounded.positions[i + 1]! - 38.9);
      if (Math.abs(rounded.positions[i + 2]! - 20) > 1e-9) continue;
      expect(reach).toBeGreaterThan(33.6 + 1 - 0.02);
      expect(reach).toBeLessThan(38.9 - 1 + 0.02);
    }
  });

  it('rounds a plain board’s top edge, corners and all, as a closed solid', () => {
    const board: CadPart = { ...createCadPart('Board', 18), id: 'board' };
    board.sketch = addRectangle(board.sketch, { x: 0, y: 0, width: 100, height: 60 });
    const document = (fillets?: CadEdgeFillet[]) => ({ ...createCadDocument(), parts: [{ ...board, ...(fillets && { fillets }) }] });
    const rounded = evaluateCadDocument(document([{ id: 'f', corners: [], rims: [{ side: 'underside', loops: ['outline'] }], radius: 3 }]));
    const mesh = nativePart(rounded.parts[0]!).entry.part.mesh;
    // The sides take away the corner's area along their length; a mitered corner takes the same again over its width.
    const corner = 9 * (1 - Math.PI / 4);
    expect((100 * 60 * 18 - volume(mesh.positions)) / (corner * 320)).toBeCloseTo(1, 1);
    const zs = Array.from({ length: mesh.positions.length / 3 }, (_, i) => mesh.positions[i * 3 + 2]!);
    expect(Math.min(...zs)).toBeCloseTo(0, 6);
  });
});
