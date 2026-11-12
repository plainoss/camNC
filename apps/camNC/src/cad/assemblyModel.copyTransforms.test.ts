import { parseCadDocument } from '@wbcnc/cad';
import { expect, it } from 'vitest';
import type { BodyMesh } from '@/cam/camTypes';
import { inheritedCopyFixture, orderedCopyFixture } from '@/test/orderedCopyFixture';
import { assemblyModel, instanceKey } from './assemblyModel';
import { physicalFaceFrame } from './studioGeometryReaders';
import { nativeCadModel } from '@/cam/nativeCadModel';

function bounds(mesh: BodyMesh) {
  return {
    min: [0, 1, 2].map(axis => Math.min(...Array.from(mesh.positions).filter((_, index) => index % 3 === axis))),
    max: [0, 1, 2].map(axis => Math.max(...Array.from(mesh.positions).filter((_, index) => index % 3 === axis))),
  };
}

/** Integrate the rendered occupied boundary, independently of the CAD/CAM profile recipe. */
function volume(mesh: BodyMesh) {
  const p = mesh.positions,
    at = (index: number, axis: number) => p[3 * mesh.indices[index]! + axis]!;
  let sum = 0;
  for (let i = 0; i < mesh.indices.length; i += 3) {
    sum +=
      at(i, 0) * (at(i + 1, 1) * at(i + 2, 2) - at(i + 1, 2) * at(i + 2, 1)) +
      at(i, 1) * (at(i + 1, 2) * at(i + 2, 0) - at(i + 1, 0) * at(i + 2, 2)) +
      at(i, 2) * (at(i + 1, 0) * at(i + 2, 1) - at(i + 1, 1) * at(i + 2, 0));
  }
  return Math.abs(sum / 6);
}

it.each([false, true])('renders imported ordered material at its final pose without reevaluating its cuts, mirrored=%s', mirrored => {
  const f = orderedCopyFixture(mirrored),
    source = JSON.stringify(f.document);
  for (const document of [f.document, parseCadDocument(JSON.parse(source))]) {
    const model = assemblyModel(document);
    expect(model.problems).toEqual([]);
    expect(model.meshes).toHaveLength(5);
    const selected = model.instances.findIndex(instance => instance.partId === f.partId && instance.copyId === f.copyId);
    expect(model.placements.get(instanceKey(model.instances[selected]!))!.position).toEqual([300, 0, 0]);
    expect(bounds(model.meshes[selected]!)).toEqual({ min: [mirrored ? 200 : 300, 0, 0], max: [mirrored ? 300 : 400, 60, 18] });
    expect(volume(model.meshes[selected]!)).toBe(100 * 60 * 18 - 10 * 10 * 18 - 2 * 10 * 20 * 18);
    for (const copyId of [undefined, f.siblingId]) {
      const index = model.instances.findIndex(instance => instance.partId === f.partId && instance.copyId === copyId);
      expect(volume(model.meshes[index]!)).toBe(100 * 60 * 18);
    }
    expect(document.parts[0]!.copies![0]!.placement!.position).toEqual([200, 0, 0]);
    expect(JSON.stringify(document)).toBe(source);
  }
});

it.each([false, true])('carries inherited Add-body copies with their parent pose and chirality, mirrored=%s', mirrored => {
  const f = inheritedCopyFixture(mirrored),
    before = JSON.stringify(f.document),
    model = assemblyModel(f.document);
  expect(model.problems).toEqual([]);
  expect(model.instances).toHaveLength(4);
  const index = model.instances.findIndex(instance => instance.partId === f.childId && instance.copyId === f.copyId);
  expect(bounds(model.meshes[index]!)).toEqual({ min: [mirrored ? 280 : 380, 30, 18], max: [mirrored ? 300 : 400, 40, 28] });
  expect(volume(model.meshes[index]!)).toBe(20 * 10 * 10);
  expect(JSON.stringify(f.document)).toBe(before);
});

it.each([false, true])('lays out an unplaced host copy together with its joined body, mirrored=%s', async mirrored => {
  const f = inheritedCopyFixture(mirrored);
  const document = {
    ...f.document,
    operationOrder: [],
    copyTransforms: [],
    parts: f.document.parts.map(part =>
      part.id === f.partId
        ? { ...part, copies: [{ id: f.copyId, name: 'Virtual copy', ...(mirrored && { mirrored: true as const }) }] }
        : part
    ),
  };
  const bytes = JSON.stringify(document),
    model = assemblyModel(document);
  expect(model.problems).toEqual([]);
  expect(model.instances).toHaveLength(4);
  const parent = model.instances.findIndex(instance => instance.partId === f.partId && instance.copyId === f.copyId);
  const child = model.instances.findIndex(instance => instance.partId === f.childId && instance.copyId === f.copyId);
  expect(bounds(model.meshes[parent]!)).toEqual({ min: [140, 0, 0], max: [240, 100, 18] });
  expect(bounds(model.meshes[child]!)).toEqual({ min: [180, 30, 18], max: [200, 40, 28] });
  expect(model.placements.get(instanceKey(model.instances[child]!))!.position).toEqual([mirrored ? 200 : 180, 30, 18]);
  expect(physicalFaceFrame(document, { partId: f.childId, copyId: f.copyId, face: 'top' })).toMatchObject({
    origin: [mirrored ? 200 : 180, 30, 28],
    normal: [0, 0, 1],
  });
  const cam = await nativeCadModel(document);
  expect(cam.model.parts.flatMap(part => part.names ?? [part.name]).sort()).toEqual([
    'Base',
    'Boss',
    'Boss · Virtual copy',
    'Virtual copy',
  ]);
  expect(JSON.stringify(document)).toBe(bytes);
  expect(document.parts.find(part => part.id === f.childId)!.copies).toBeUndefined();
});
