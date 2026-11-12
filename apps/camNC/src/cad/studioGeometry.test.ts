import { parseCadDocument } from '@wbcnc/cad';
import { expect, it } from 'vitest';
import { nativeCadModel } from '@/cam/nativeCadModel';
import { boundaryVolume, inheritedCopyFixture, orderedCopyFixture } from '@/test/orderedCopyFixture';
import { partSolid } from './partSolid';
import { studioGeometry } from './studioGeometry';
import { physicalFaceFrame } from './studioGeometryReaders';
import { assemblyModel } from './assemblyModel';

it('shares an idempotent read-only physical context while retaining portable creation source', () => {
  const f = orderedCopyFixture(),
    bytes = JSON.stringify(f.document);
  const geometry = studioGeometry(f.document);
  expect(geometry.source).toBe(f.document);
  expect(geometry.document).not.toBe(f.document);
  expect(studioGeometry(f.document)).toBe(geometry);
  expect(studioGeometry(geometry.document)).toBe(geometry);
  expect(geometry.document.parts[0]!.copies![0]!.placement!.position).toEqual([300, 0, 0]);
  expect(f.document.parts[0]!.copies![0]!.placement!.position).toEqual([200, 0, 0]);
  const reload = parseCadDocument(JSON.parse(bytes));
  expect(studioGeometry(reload).document.parts[0]!.copies![0]!.placement!.position).toEqual([300, 0, 0]);
  expect(JSON.stringify(f.document)).toBe(bytes);
});

it.each([false, true])('uses the same staged copy material in its local face editor, mirrored=%s', mirrored => {
  const f = orderedCopyFixture(mirrored),
    bytes = JSON.stringify(f.document);
  const solid = partSolid(f.document.parts[0]!, f.document, f.copyId);
  expect(solid.problem).toBeUndefined();
  const geometry = solid.geometry!;
  const positions = geometry.getAttribute('position').array;
  const indices = geometry.index?.array ?? Uint32Array.from({ length: positions.length / 3 }, (_, index) => index);
  expect(boundaryVolume(positions, indices)).toBe(99000);
  geometry.dispose();
  expect(JSON.stringify(f.document)).toBe(bytes);
});

it.each([false, true])('hands the same imported local material to CAM without saving final poses, mirrored=%s', async mirrored => {
  const f = orderedCopyFixture(mirrored),
    bytes = JSON.stringify(f.document);
  const loaded = parseCadDocument(JSON.parse(bytes));
  const cam = await nativeCadModel(loaded);
  const selected = cam.model.parts.findIndex(part => part.names?.includes('Panel 2'));
  expect(selected).toBeGreaterThanOrEqual(0);
  const mesh = cam.model.meshes[selected]!;
  expect(boundaryVolume(mesh.positions, mesh.indices)).toBe(99000);
  expect(cam.model.parts.flatMap(part => part.names ?? [part.name]).sort()).toEqual(['Knife A', 'Knife B', 'Panel', 'Panel 2', 'Panel 3']);
  expect(JSON.stringify(loaded)).toBe(bytes);
  expect(JSON.stringify(f.document)).toBe(bytes);
});

it.each([false, true])('keeps inherited Add-body quantity in the CAM handoff, mirrored=%s', async mirrored => {
  const f = inheritedCopyFixture(mirrored),
    bytes = JSON.stringify(f.document);
  const cam = await nativeCadModel(f.document);
  expect(cam.model.parts.flatMap(part => part.names ?? [part.name]).sort()).toEqual(['Base', 'Base 2', 'Boss', 'Boss · Base 2']);
  expect(JSON.stringify(f.document)).toBe(bytes);
});

it.each(['suppressed', 'removed'] as const)('never resurrects an unavailable parent copy or its inherited body, %s', state => {
  const f = inheritedCopyFixture(true);
  const source = {
    ...f.document,
    parts: f.document.parts.map(part =>
      part.id !== f.partId
        ? part
        : {
            ...part,
            copies: state === 'removed' ? [] : part.copies!.map(copy => ({ ...copy, suppressed: true as const })),
          }
    ),
  };
  const bytes = JSON.stringify(source),
    model = assemblyModel(source),
    geometry = studioGeometry(source);
  expect(model.instances).toHaveLength(2);
  expect(model.instances.every(instance => instance.copyId === undefined)).toBe(true);
  expect(geometry.document.parts.find(part => part.id === f.childId)!.copies ?? []).toEqual([]);
  expect(physicalFaceFrame(source, { partId: f.childId, copyId: f.copyId, face: 'top' })).toHaveProperty('error');
  expect(partSolid(source.parts.find(part => part.id === f.childId)!, source, f.copyId)).toHaveProperty('problem');
  expect(source.copyTransforms![0]!.copyId).toBe(f.copyId);
  expect(JSON.stringify(source)).toBe(bytes);
});
