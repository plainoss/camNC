import { expect, it } from 'vitest';
import { addRectangle, applyPartCuts, createCadDocument, createCadPart, evaluateCadDocument, pointInPolygon, type CadPoint } from './index';

const rectangle = (x: number, y: number, width: number, height: number): CadPoint[] => [
  { x, y },
  { x: x + width, y },
  { x: x + width, y: y + height },
  { x, y: y + height },
];

it('widens the exposed upper pocket wall even when an adjacent lower tool layer covers the same XY edge', () => {
  const document = createCadDocument(),
    tool = createCadPart('Pocketed tool', 18),
    receiver = createCadPart('Receiver', 18);
  tool.sketch = addRectangle(tool.sketch, { x: 20, y: 20, width: 20, height: 20 });
  receiver.sketch = addRectangle(receiver.sketch, { x: 0, y: 0, width: 60, height: 60 });
  for (const part of [tool, receiver]) part.placement = { position: [0, 0, 0], rotation: [0, 0, 0, 1] };
  document.parts = [tool, receiver];
  const generated = evaluateCadDocument(document);
  generated.parts[0]!.cuts = [
    {
      id: 'right-upper-pocket',
      regionId: 'top-pocket',
      side: 'top',
      from: 0,
      to: 9,
      through: false,
      outline: rectangle(30, 20, 10, 15),
      islands: [],
    },
    {
      id: 'left-lower-pocket',
      regionId: 'bottom-pocket',
      side: 'underside',
      from: 0,
      to: 9,
      through: false,
      outline: rectangle(20, 20, 10, 15),
      islands: [],
    },
  ];
  document.partCuts = [{ id: 'cut-with-current-material', tools: [tool.id], targets: [receiver.id], clearance: 2 }];
  const result = applyPartCuts(document, generated.parts, { occupiedTools: true }),
    shape = result.parts[1]!;
  const material = (x: number, y: number, z: number) =>
    !shape.cuts?.some(cut => {
      const bottom = cut.side === 'top' ? 18 - cut.to : cut.from,
        top = cut.side === 'top' ? 18 - cut.from : cut.to;
      return (
        z > bottom && z < top && pointInPolygon({ x, y }, cut.outline) && !cut.islands.some(island => pointInPolygon({ x, y }, island))
      );
    });
  expect(result.diagnostics).toEqual([]);
  // A 5 mm back strip keeps the tool connected. At Y25 its upper-left and lower-right lobes meet only diagonally.
  // The upper lobe reaches from 9 to 18; its 2 mm clearance must clear X31 at Z15.
  expect(material(31, 25, 15)).toBe(false);
  expect(material(33, 25, 15)).toBe(true);
  // The right lobe at X30..40 reaches from below to 9, deepened 2 mm and widened 2 mm.
  expect(material(41, 25, 10)).toBe(false);
  expect(material(41, 25, 12)).toBe(true);
  expect(material(17, 25, 5)).toBe(true);
});
