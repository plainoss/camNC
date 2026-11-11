import {
  addPartCopy,
  addPartCut,
  addRectangle,
  cadPartReference,
  cadPartsToCut,
  createCadPart,
  createPlateDocument,
  resolveDrawnPlacements,
  updatePartCut,
  type CadDocument,
} from '@wbcnc/cad';
import { expect, it } from 'vitest';
import { inspectCadDocument } from '../inspect';
import { cadViewBodies } from '../views/geometry';
import { axisMaterial } from './axisMaterial';

function fixture(mirrored: boolean, hole = false) {
  const initial = createPlateDocument({ width: 100, height: 60, thickness: 18 });
  const parent = initial.parts[0]!;
  parent.name = 'Parent';
  parent.placement = { position: [0, 0, 0], rotation: [0, 0, 0, 1] };
  const copied = addPartCopy(initial, parent.id, {
    mirrored,
    offset: { position: [200, 0, 0], rotation: [0, 0, 0, 1] },
  });
  const boss = createCadPart('Boss', 6);
  boss.sketch = addRectangle(boss.sketch, { x: 15, y: 10, width: 20, height: 12, dimensioned: true, positioned: true });
  if (hole) boss.sketch = addRectangle(boss.sketch, { x: 17, y: 12, width: 4, height: 3, dimensioned: true, positioned: true });
  boss.addTo = parent.id;
  boss.drawnOn = { on: { partId: parent.id, face: 'top' }, offset: 0 };
  // Legacy authoring stores the host copy only; physical Add membership must remain derived.
  const document = resolveDrawnPlacements({ ...copied.document, parts: [...copied.document.parts, boss] }).document;
  return { document, parentId: parent.id, bossId: boss.id, copyId: copied.id };
}

async function inspect(document: CadDocument) {
  const before = JSON.stringify(document);
  const result = await inspectCadDocument(document, new Map(), { toolpaths: false });
  expect(result.report.status).toBe('solved');
  expect(result.report.errors).toEqual([]);
  expect(JSON.stringify(document)).toBe(before);
  expect(result.document.parts.find(part => part.name === 'Boss')!.copies).toBeUndefined();
  return result;
}

it.each([false, true])('names inherited copy-specific cuts and exposes their actual visible material (mirrored: %s)', async mirrored => {
  const f = fixture(mirrored, true);
  const tool = createPlateDocument({ width: 5, height: 4, thickness: 6 }).parts[0]!;
  tool.name = 'Tool';
  tool.placement = { position: [mirrored ? 171 : 225, 16, 18], rotation: [0, 0, 0, 1] };
  const reference = cadPartReference(f.bossId, f.copyId);
  const source = addPartCut({ ...f.document, parts: [...f.document.parts, tool] }, [tool.id], [reference], { value: 0 }).document;
  const before = JSON.stringify(source);
  const result = await inspect(source);
  const report = result.report.parts.find(part => part.name === 'Boss')!;
  expect(report.cuts).toEqual([]);
  expect(report.copyFeatures).toEqual([
    {
      ref: reference,
      name: 'Boss · Parent 2',
      cuts: [{ ref: 'Tool', side: 'top', from: 0, to: 6, through: true, at: [mirrored ? 24 : 25, 16], size: [5, 4] }],
    },
  ]);
  expect(report.pieces).toEqual(
    mirrored ? { names: ['Boss'], mirrored: ['Boss · Parent 2'] } : { names: ['Boss', 'Boss · Parent 2'], mirrored: [] }
  );
  expect(result.report.steps!.find(step => step.kind === 'partCut')).toMatchObject({
    tools: ['Tool'],
    targets: ['Boss · Parent 2'],
    cuts: [{ target: 'Boss · Parent 2', tool: 'Tool', width: 5, length: 4, depth: 6, through: true }],
  });

  const bodies = cadViewBodies(result.document, result.parts);
  expect(bodies.map(body => body.name)).toEqual(['Parent', 'Parent 2', 'Boss', 'Boss · Parent 2', 'Tool']);
  const seed = bodies.find(body => body.name === 'Boss')!;
  const copy = bodies.find(body => body.name === 'Boss · Parent 2')!;
  const seedMaterial = axisMaterial(seed.shape, seed.placement!);
  const copyMaterial = axisMaterial(copy.shape, copy.placement!);
  // 20×12 stock, a 4×3 authored hole, and a 5×4 cut on the inherited copy alone.
  expect(seedMaterial.volume).toBe(1368);
  expect(copyMaterial.volume).toBe(1248);
  expect(seedMaterial.containsWorld([27.5, 18, 21])).toBe(true);
  expect(copyMaterial.containsWorld([mirrored ? 173.5 : 227.5, 18, 21])).toBe(false);
  expect(copyMaterial.containsWorld([mirrored ? 168 : 232, 18, 21])).toBe(true);
  expect(copyMaterial.containsWorld([mirrored ? 182 : 218, 13, 21])).toBe(false);
  expect(cadPartsToCut(result.document, result.parts).flatMap(piece => piece.names)).toEqual([
    'Parent',
    'Parent 2',
    'Boss',
    'Boss · Parent 2',
    'Tool',
  ]);
  expect(JSON.stringify(source)).toBe(before);
});

it.each([false, true])('names an inherited Add copy used as a tool and reports its visible target cut (mirrored: %s)', async mirrored => {
  const f = fixture(mirrored);
  const target = createPlateDocument({ width: 50, height: 30, thickness: 6 }).parts[0]!;
  target.name = 'Target';
  target.placement = { position: [mirrored ? 150 : 200, 0, 18], rotation: [0, 0, 0, 1] };
  const reference = cadPartReference(f.bossId, f.copyId);
  const source = addPartCut({ ...f.document, parts: [...f.document.parts, target] }, [reference], [target.id], { value: 0 }).document;
  const before = JSON.stringify(source);
  const result = await inspect(source);
  expect(result.report.parts.find(part => part.name === 'Target')!.cuts).toEqual([
    { ref: 'Boss · Parent 2', side: 'top', from: 0, to: 6, through: true, at: [15, 10], size: [20, 12] },
  ]);
  expect(result.report.steps!.find(step => step.kind === 'partCut')).toMatchObject({
    tools: ['Boss · Parent 2'],
    targets: ['Target'],
    cuts: [{ target: 'Target', tool: 'Boss · Parent 2', width: 20, length: 12, depth: 6, through: true, at: { x: 15, y: 10 } }],
  });
  const bodies = cadViewBodies(result.document, result.parts);
  expect(bodies.map(body => body.name)).toEqual(['Parent', 'Parent 2', 'Boss', 'Boss · Parent 2', 'Target']);
  const visible = bodies.find(body => body.name === 'Target')!;
  const material = axisMaterial(visible.shape, visible.placement!);
  expect(material.volume).toBe((50 * 30 - 20 * 12) * 6);
  expect(material.containsWorld([mirrored ? 175 : 225, 18, 21])).toBe(false);
  expect(material.containsWorld([mirrored ? 155 : 205, 5, 21])).toBe(true);
  expect(cadPartsToCut(result.document, result.parts).flatMap(piece => piece.names)).toEqual([
    'Parent',
    'Parent 2',
    'Boss',
    'Boss · Parent 2',
    'Target',
  ]);
  expect(JSON.stringify(source)).toBe(before);
});

it.each([false, true])(
  'filters a consumed host and all inherited Add bodies from physical views without losing their cut (mirrored: %s)',
  async mirrored => {
    const f = fixture(mirrored);
    const target = createPlateDocument({ width: 50, height: 30, thickness: 6 }).parts[0]!;
    target.name = 'Target';
    target.placement = { position: [mirrored ? 150 : 200, 0, 18], rotation: [0, 0, 0, 1] };
    const cut = addPartCut({ ...f.document, parts: [...f.document.parts, target] }, [f.parentId], [target.id], { value: 0 });
    const source = updatePartCut(cut.document, cut.id, { consumeTools: true });
    const before = JSON.stringify(source);
    const result = await inspect(source);
    const bodies = cadViewBodies(result.document, result.parts);
    expect(bodies.map(body => body.name)).toEqual(['Target']);
    expect(result.report.assembly!.parts.map(part => part.name)).toEqual(['Target']);
    expect(cadPartsToCut(result.document, result.parts).flatMap(piece => piece.names)).toEqual(['Target']);
    expect(result.report.steps!.find(step => step.kind === 'partCut')).toMatchObject({
      tools: ['Parent'],
      targets: ['Target'],
      cuts: [{ target: 'Target', tool: 'Boss · Parent 2', width: 20, length: 12, depth: 6, through: true }],
    });
    const material = axisMaterial(bodies[0]!.shape, bodies[0]!.placement!);
    expect(material.volume).toBe((50 * 30 - 20 * 12) * 6);
    expect(material.containsWorld([mirrored ? 175 : 225, 18, 21])).toBe(false);
    expect(material.containsWorld([mirrored ? 155 : 205, 5, 21])).toBe(true);
    expect(JSON.stringify(source)).toBe(before);
  }
);

it.each([
  ['body', false, false],
  ['body', true, false],
  ['Add', false, false],
  ['Add', true, false],
  ['body', false, true],
  ['body', true, true],
  ['Add', false, true],
  ['Add', true, true],
] as const)('retains a suppressed %s authoring row without physical pieces (copies: %s, folder mask: %s)', async (kind, copies, folder) => {
  const f = fixture(false);
  const maskedId = kind === 'body' ? f.parentId : f.bossId;
  const root = createPlateDocument({ width: 40, height: 30, thickness: 18 }).parts[0]!;
  root.name = 'Root';
  root.placement = { position: [500, 0, 0], rotation: [0, 0, 0, 1] };
  const parts = f.document.parts.map(part => {
    const { copies: _copies, ...withoutCopies } = part;
    const source = copies ? part : withoutCopies;
    return part.id === maskedId && !folder ? { ...source, suppressed: true as const } : source;
  });
  const source: CadDocument = {
    ...f.document,
    parts: [...parts, root],
    ...(folder && {
      version: 3,
      folders: [{ id: 'masked-folder', name: 'Masked', partIds: [maskedId], suppressed: true }],
    }),
  };
  const before = JSON.stringify(source);
  // Suppression must preserve the raw report row even when that row has no physical copies.
  const result = await inspect(source);
  expect(result.report.parts.map(part => part.name)).toEqual(['Parent', 'Boss', 'Root']);
  expect(result.document.parts.map(part => part.id)).toEqual(source.parts.map(part => part.id));
  const retained = result.report.parts.find(part => part.name === (kind === 'body' ? 'Parent' : 'Boss'))!;
  expect(retained.thickness).toBe(kind === 'body' ? 18 : 6);
  expect(retained.sketches[0]!.entities.length).toBeGreaterThan(0);
  expect(retained.pieces?.names ?? []).toEqual([]);
  expect(retained.pieces?.mirrored ?? []).toEqual([]);
  const expected = kind === 'body' ? ['Root'] : ['Parent', ...(copies ? ['Parent 2'] : []), 'Root'];
  expect(cadViewBodies(result.document, result.parts).map(body => body.name)).toEqual(expected);
  expect(result.report.assembly!.parts.map(part => part.name)).toEqual(expected);
  expect(cadPartsToCut(result.document, result.parts).flatMap(piece => piece.names)).toEqual(expected);
  expect(JSON.stringify(source)).toBe(before);
});
