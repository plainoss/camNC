import { expect, it } from 'vitest';
import {
  copyOperationPrefix,
  evaluateCadDocument,
  evaluatedPartCopy,
  parseCadDocument,
  physicalCadView,
  polygonArea,
  resolveDrawnPlacements,
  type CadDocument,
  type EvaluatedCadPart,
} from './index';
import { notchedSeedSource } from './physicalSeedTransforms.testFixtures';

const volume = (shape: EvaluatedCadPart) => {
  const area = (loop: typeof shape.outline) => Math.abs(polygonArea(loop));
  return (
    (area(shape.outline) - shape.holes.reduce((sum, hole) => sum + area(hole), 0)) * shape.thickness -
    (shape.cuts ?? []).reduce(
      (sum, cut) => sum + (area(cut.outline) - cut.islands.reduce((sum, island) => sum + area(island), 0)) * (cut.to - cut.from),
      0
    )
  );
};
const reload = (source: CadDocument) => parseCadDocument(JSON.parse(JSON.stringify(source)));

it('loads an explicitly seed-only operation while preserving raw creation poses and old flat copy records', () => {
  const f = notchedSeedSource(),
    bytes = JSON.stringify(f.source);
  expect(() => reload(f.source)).not.toThrow();
  expect(JSON.stringify(reload(f.source))).toBe(bytes);
  expect(reload(f.source).copyTransforms![0]).toMatchObject({ seed: true, partId: f.partId });
  const legacy = structuredClone(f.source),
    copyId = legacy.parts[0]!.copies![0]!.id;
  legacy.copyTransforms = [{ id: f.moveId, partId: f.partId, copyId, by: [0, 25, 0] }];
  const oldBytes = JSON.stringify(legacy);
  expect(JSON.stringify(reload(legacy))).toBe(oldBytes);
  expect(legacy.copyTransforms[0]).not.toHaveProperty('seed');
  expect(() => reload({ ...f.source, version: 3 })).toThrow();
  expect(JSON.stringify(f.source)).toBe(bytes);
});

it('moves only the notched original and lets a later world knife cut its new pose without changing either sibling', () => {
  const f = notchedSeedSource(),
    bytes = JSON.stringify(f.source),
    result = evaluateCadDocument(f.source);
  expect(result.diagnostics).toEqual([]);
  expect(result.placements?.[f.partId]!.position).toEqual([0, 25, 0]);
  const family = f.source.parts[0]!,
    shape = result.parts.find(part => part.partId === f.partId)!;
  expect(volume(shape)).toBe(103500);
  for (const [index, copy] of family.copies!.entries()) {
    expect(result.placements?.[`${f.partId}:${copy.id}`]!.position).toEqual([(index + 1) * 200, 0, 0]);
    expect(volume(evaluatedPartCopy(shape, copy))).toBe(104400);
  }
  const prefix = copyOperationPrefix(f.source, f.moveId),
    earlier = evaluateCadDocument(reload(prefix));
  expect(volume(earlier.parts.find(part => part.partId === f.partId)!)).toBe(104400);
  expect(earlier.placements?.[f.partId]!.position).toEqual([0, 25, 0]);
  expect(evaluateCadDocument(reload(f.source))).toEqual(result);
  expect(f.source.partCuts![0]!.targets).toEqual([f.partId]);
  expect(f.source.parts[0]!.placement!.position).toEqual([0, 0, 0]);
  expect(JSON.stringify(f.source)).toBe(bytes);
});

it('carries direct Add seed material by the same rigid delta and keeps copies and earlier face-generated bodies fixed', () => {
  const f = notchedSeedSource();
  let source = copyOperationPrefix(f.source, f.moveId);
  source = { ...source, copyTransforms: [{ ...source.copyTransforms![0]!, turn: { about: [0, 0, 0], axis: [0, 0, 1], degrees: 90 } }] };
  const bytes = JSON.stringify(source),
    result = evaluateCadDocument(source);
  expect(result.diagnostics).toEqual([]);
  expect(result.placements?.[f.partId]!.position).toEqual([0, 25, 0]);
  expect(result.placements?.[f.childId]!.position).toEqual([-30, 45, 18]);
  expect(result.placements?.[f.childId]!.rotation).toEqual([0, 0, Math.SQRT1_2, Math.SQRT1_2]);
  expect(result.placements?.[f.dependentId]!.position).toEqual([0, 0, 18]);
  const view = physicalCadView(source, result),
    child = view.document.parts.find(part => part.id === f.childId)!;
  for (const [index, copy] of child.copies!.entries()) {
    [(index + 1) * 200 + 20, 30, 18].forEach((expected, axis) => expect(copy.placement!.position[axis]).toBeCloseTo(expected, 8));
    expect(copy.placement!.rotation).toEqual([0, 0, 0, 1]);
  }
  const queried = resolveDrawnPlacements(view.document).document;
  expect(queried.parts.find(part => part.id === f.dependentId)!.placement!.position).toEqual([0, 0, 18]);
  expect(f.source.parts.find(part => part.id === f.dependentId)!.drawnOn).toEqual({ on: { partId: f.partId, face: 'top' }, offset: 0 });
  expect(JSON.stringify(source)).toBe(bytes);
});

it('keeps an inherited copy frame unchanged when the original cached rotation has finite source rounding', () => {
  const f = notchedSeedSource(),
    q = 0.707106781;
  let source = copyOperationPrefix(f.source, f.moveId);
  source = {
    ...source,
    parts: source.parts.map(part =>
      part.id === f.partId
        ? {
            ...part,
            pattern: undefined,
            placement: { position: [100, 200, 0], rotation: [0, 0, q, q] },
            copies: [{ id: 'fixed-copy', placement: { position: [500, 600, 10], rotation: [0, 0, -Math.SQRT1_2, Math.SQRT1_2] } }],
          }
        : part.id === f.childId
          ? { ...part, placement: { position: [-40, 260, 18], rotation: [0, 0, 1, 0] } }
          : part
    ),
    copyTransforms: [{ ...source.copyTransforms![0]!, by: [100, -50, 7], turn: { about: [0, 0, 0], axis: [0, 0, 1], degrees: 90 } }],
  };
  const before = physicalCadView(copyOperationPrefix(source), evaluateCadDocument(copyOperationPrefix(source)));
  const after = physicalCadView(source, evaluateCadDocument(source));
  const child = (view: typeof before) => view.document.parts.find(part => part.id === f.childId)!.copies![0]!.placement!;
  const earlier = child(before),
    later = child(after);
  earlier.position.forEach((value, axis) => expect(later.position[axis]).toBeCloseTo(value, 8));
  earlier.rotation.forEach((value, axis) => expect(later.rotation[axis]).toBeCloseTo(value, 8));
  expect(after.document.parts[0]!.copies![0]!.placement).toEqual(before.document.parts[0]!.copies![0]!.placement);
});

it.each([
  ['absent both', {}],
  ['copy missing', { copyId: null }],
  ['seed false', { seed: false }],
  ['seed text', { seed: 'true' }],
  ['ambiguous', { seed: true, copyId: 'some-copy' }],
  ['seed null', { seed: null }],
] as const)('rejects an ambiguous or absent physical target discriminator: %s', (_name, target) => {
  const f = notchedSeedSource(),
    move = { id: f.moveId, partId: f.partId, by: [0, 25, 0], ...target };
  expect(() => reload({ ...f.source, copyTransforms: [move] } as unknown as CadDocument)).toThrow();
});
