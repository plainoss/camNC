import { createPlateDocument } from '@wbcnc/cad';
import { expect, it } from 'vitest';
import type { BodyMesh } from '@/cam/camTypes';
import { assemblyModel } from './assemblyModel';
import { sectionModel } from './sectionModel';

const heights = (mesh: BodyMesh) => {
  const values = Array.from(mesh.indices, index => mesh.positions[index * 3 + 2]!);
  return [Math.min(...values), Math.max(...values)];
};

it('leaves the whole assembly intact when one instance cannot be capped, then sections correctly after that instance is hidden', () => {
  const document = createPlateDocument({ width: 100, height: 60, thickness: 18 });
  document.parts[0]!.name = 'Sound panel';
  document.parts.push({
    ...createPlateDocument({ width: 80, height: 40, thickness: 18 }).parts[0]!,
    id: 'damaged',
    name: 'Imported panel',
  });
  const content = JSON.stringify(document),
    actual = assemblyModel(document);
  expect(actual.problems).toEqual([]);
  expect(actual.instances.map(instance => instance.name)).toEqual(['Sound panel', 'Imported panel']);
  const original = actual.meshes.map(mesh => ({ positions: mesh.positions.slice(), indices: mesh.indices.slice() }));
  // An incomplete imported surface can share an assembly with a valid native solid.
  const missingFace = { ...actual.meshes[1]!, indices: actual.meshes[1]!.indices.slice(3) };
  const assembly = { ...actual, meshes: [actual.meshes[0]!, missingFace] };
  const beforeBad = missingFace.indices.slice();
  const plane = { origin: [0, 0, 9] as [number, number, number], normal: [0, 0, 1] as [number, number, number] };
  const fallback = sectionModel(assembly, plane);
  expect(fallback.sectionProblems).toHaveLength(1);
  expect(fallback.sectionProblems[0]).toMatchObject({ instanceKey: 'damaged', name: 'Imported panel' });
  expect(fallback.sectionProblems[0]!.message).toMatch(/closed|boundary|open/i);
  expect(fallback.meshes).toBe(assembly.meshes);
  expect(fallback.meshes[0]).toBe(actual.meshes[0]);
  expect(heights(fallback.meshes[0]!)).toEqual([0, 18]);
  expect(fallback.sectionCaps).toEqual([null, null]);
  expect(fallback.instances).toBe(assembly.instances);
  expect(fallback.placements).toBe(assembly.placements);

  // The normal assembly visibility path removes only the bad instance; the source design stays intact.
  const shown = assemblyModel(document, new Set(['damaged']));
  const section = sectionModel(shown, plane),
    cap = section.sectionCaps[0]!;
  expect(section.sectionProblems).toEqual([]);
  expect(section.instances).toEqual([actual.instances[0]]);
  expect(section.placements.get(document.parts[0]!.id)).toEqual(actual.placements.get(document.parts[0]!.id));
  expect(heights(section.meshes[0]!)).toEqual([0, 9]);
  expect(cap).toBeDefined();
  expect(cap.count).toBeGreaterThan(0);
  expect(cap.start % 3).toBe(0);
  expect(cap.start + cap.count).toBe(section.meshes[0]!.indices.length);
  const capMesh = section.meshes[0]!;
  let capArea = 0;
  for (let i = cap.start; i < cap.start + cap.count; i += 3) {
    const points = [0, 1, 2].map(k => {
      const index = capMesh.indices[i + k]! * 3;
      expect(capMesh.positions[index + 2]).toBe(9);
      return [capMesh.positions[index]!, capMesh.positions[index + 1]!] as const;
    });
    const [a, b, c] = points as [(typeof points)[number], (typeof points)[number], (typeof points)[number]];
    const signed = ((b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])) / 2;
    expect(signed).toBeGreaterThan(0);
    capArea += signed;
  }
  expect(capArea).toBeCloseTo(100 * 60, 6);
  const restored = sectionModel(shown, null);
  expect(restored.meshes).toBe(shown.meshes);
  expect(heights(restored.meshes[0]!)).toEqual([0, 18]);
  expect(restored.sectionCaps).toEqual([null]);
  expect(JSON.stringify(document)).toBe(content);
  actual.meshes.forEach((mesh, index) => {
    expect(mesh.positions).toEqual(original[index]!.positions);
    expect(mesh.indices).toEqual(original[index]!.indices);
  });
  expect(missingFace.indices).toEqual(beforeBad);
});
