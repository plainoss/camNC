import {
  addPartCopy,
  addPartCut,
  addRectangle,
  cadPartReference,
  createCadPart,
  createPlateDocument,
  resolveDrawnPlacements,
  type CadDocument,
} from '@wbcnc/cad';
import { expect, it } from 'vitest';
import type { BodyMesh } from '@/cam/camTypes';
import { nativeCadModel } from '@/cam/nativeCadModel';
import { assemblyModel, instanceKey } from './assemblyModel';

function fixture(mirrored: boolean) {
  const initial = createPlateDocument({ width: 100, height: 60, thickness: 18 });
  const parent = initial.parts[0]!;
  parent.name = 'Parent';
  parent.placement = { position: [0, 0, 0], rotation: [0, 0, 0, 1] };
  const copied = addPartCopy(initial, parent.id, { mirrored, offset: { position: [200, 0, 0], rotation: [0, 0, 0, 1] } });
  const boss = createCadPart('Boss', 6);
  boss.sketch = addRectangle(boss.sketch, { x: 15, y: 10, width: 20, height: 12, dimensioned: true, positioned: true });
  boss.sketch = addRectangle(boss.sketch, { x: 17, y: 12, width: 4, height: 3, dimensioned: true, positioned: true });
  boss.addTo = parent.id;
  boss.drawnOn = { on: { partId: parent.id, face: 'top' }, offset: 0 };
  const document = resolveDrawnPlacements({ ...copied.document, parts: [...copied.document.parts, boss] }).document;
  return { document, parentId: parent.id, bossId: boss.id, copyId: copied.id };
}

/** Independent signed tetrahedral integration of the actual assembled triangle positions. */
function meshVolume(mesh: BodyMesh) {
  let total = 0;
  for (let i = 0; i < mesh.indices.length; i += 3) {
    const a = mesh.indices[i]! * 3,
      b = mesh.indices[i + 1]! * 3,
      c = mesh.indices[i + 2]! * 3;
    const p = mesh.positions;
    total +=
      p[a]! * (p[b + 1]! * p[c + 2]! - p[b + 2]! * p[c + 1]!) +
      p[a + 1]! * (p[b + 2]! * p[c]! - p[b]! * p[c + 2]!) +
      p[a + 2]! * (p[b]! * p[c + 1]! - p[b + 1]! * p[c]!);
  }
  return Math.abs(total / 6);
}

const minimum = (mesh: BodyMesh) =>
  [0, 1, 2].map(axis => {
    let result = Infinity;
    for (let i = axis; i < mesh.positions.length; i += 3) result = Math.min(result, mesh.positions[i]!);
    return result;
  });

it.each([false, true])(
  'renders inherited copy material once with the same physical identity as machining (mirrored: %s)',
  async mirrored => {
    const f = fixture(mirrored);
    const fourNames = ['Parent', 'Parent 2', 'Boss', 'Boss · Parent 2'];
    expect(assemblyModel(f.document).instances.map(instance => instance.name)).toEqual(fourNames);
    const baselineMachining = await nativeCadModel(f.document);
    expect(baselineMachining.model.parts.flatMap(part => part.names ?? [part.name])).toEqual(fourNames);
    const tool = createPlateDocument({ width: 5, height: 4, thickness: 6 }).parts[0]!;
    tool.name = 'Tool';
    tool.placement = { position: [mirrored ? 171 : 225, 16, 18], rotation: [0, 0, 0, 1] };
    const document = addPartCut({ ...f.document, parts: [...f.document.parts, tool] }, [tool.id], [cadPartReference(f.bossId, f.copyId)], {
      value: 0,
    }).document;
    const before = JSON.stringify(document);
    const model = assemblyModel(document);
    expect(model.problems).toEqual([]);
    expect(model.instances.map(instance => instance.name)).toEqual(['Parent', 'Parent 2', 'Boss', 'Boss · Parent 2', 'Tool']);
    const seed = model.instances.findIndex(instance => instance.partId === f.bossId && !instance.copyId);
    const copy = model.instances.findIndex(instance => instance.partId === f.bossId && instance.copyId === f.copyId);
    expect(meshVolume(model.meshes[seed]!)).toBeCloseTo((20 * 12 - 4 * 3) * 6, 6);
    expect(meshVolume(model.meshes[copy]!)).toBeCloseTo((20 * 12 - 4 * 3 - 5 * 4) * 6, 6);
    expect(minimum(model.meshes[copy]!)).toEqual([mirrored ? 165 : 215, 10, 18]);
    expect(model.placements.has(instanceKey({ partId: f.bossId, copyId: f.copyId }))).toBe(true);
    const hidden = assemblyModel(document, new Set([instanceKey({ partId: f.parentId, copyId: f.copyId })]));
    expect(hidden.instances.map(instance => instance.name)).toEqual(['Parent', 'Boss', 'Tool']);
    const machining = await nativeCadModel(document);
    expect(machining.model.parts.flatMap(part => part.names ?? [part.name])).toEqual([
      'Parent',
      'Parent 2',
      'Boss',
      'Boss · Parent 2',
      'Tool',
    ]);
    expect(JSON.stringify(document)).toBe(before);
    expect(document.parts.find(part => part.id === f.bossId)!.copies).toBeUndefined();
  }
);

it.each([
  [false, false],
  [false, true],
  [true, false],
  [true, true],
] as const)(
  'keeps an unplaced host copy and its joined material together in the display row (mirrored: %s, implicit seed: %s)',
  (mirrored, implicit) => {
    const f = fixture(mirrored);
    const document: CadDocument = {
      ...f.document,
      parts: f.document.parts.map(part => {
        if (part.id !== f.parentId) return part;
        const { placement, ...rest } = part;
        return {
          ...rest,
          ...(!implicit && { placement }),
          copies: part.copies!.map(copy => ({ id: copy.id, ...(copy.mirrored && { mirrored: true as const }) })),
        };
      }),
    };
    const before = JSON.stringify(document);
    const model = assemblyModel(document);
    expect(model.problems).toEqual([]);
    expect(model.instances.map(instance => instance.name)).toEqual(['Parent', 'Parent 2', 'Boss', 'Boss · Parent 2']);
    const host = model.instances.findIndex(instance => instance.partId === f.parentId && instance.copyId === f.copyId);
    const joined = model.instances.findIndex(instance => instance.partId === f.bossId && instance.copyId === f.copyId);
    expect(minimum(model.meshes[host]!)).toEqual([140, 0, 0]);
    expect(minimum(model.meshes[joined]!)).toEqual([mirrored ? 205 : 155, 10, 18]);
    const hostAt = model.placements.get(instanceKey(model.instances[host]!))!;
    expect(model.placements.get(instanceKey(model.instances[joined]!))?.position).toEqual([hostAt.position[0], 0, 18]);
    expect(meshVolume(model.meshes[joined]!)).toBeCloseTo((20 * 12 - 4 * 3) * 6, 6);
    const hidden = assemblyModel(document, new Set([instanceKey({ partId: f.parentId, copyId: f.copyId })]));
    expect(hidden.instances.map(instance => instance.name)).toEqual(['Parent', 'Boss']);
    expect(JSON.stringify(document)).toBe(before);
    expect(document.parts[0]!.copies![0]!.placement).toBeUndefined();
    expect(document.parts.find(part => part.id === f.bossId)!.copies).toBeUndefined();
  }
);
