import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { parseCadDocument, setCadVariable, solveCadDocument, type CadDocument } from '@wbcnc/cad';
import { describe, expect, it } from 'vitest';
import type { BodyMesh } from '@/cam/camTypes';
import { planarMeasurementFace } from '@/cam/model/measurementPick';
import { assemblyModel, type AssemblyModel } from './assemblyModel';
import { measureEntities, type MeasureEntity } from './measureGeometry';
import { sectionModel } from './sectionModel';

type SectionModel = ReturnType<typeof sectionModel>;
const source = (name: string): CadDocument =>
  parseCadDocument(
    JSON.parse(readFileSync(new URL(`../../../../packages/cad-script/fixtures/designs/${name}.json`, import.meta.url), 'utf8'))
  );
const editVariable = (document: CadDocument, name: string, expression: string): CadDocument => {
  const variable = document.variables!.find(candidate => candidate.name === name)!;
  const result = setCadVariable(document, { id: variable.id, name, expression });
  if ('error' in result) throw new Error(result.error);
  return result.document;
};
const identity = (document: CadDocument) => document.parts.map(part => [part.id, ...(part.copies ?? []).map(copy => copy.id)]);
const meshHash = (model: AssemblyModel) => {
  const hash = createHash('sha256');
  for (const mesh of model.meshes) {
    hash.update(new Uint8Array(mesh.positions.buffer, mesh.positions.byteOffset, mesh.positions.byteLength));
    hash.update(new Uint8Array(mesh.indices.buffer, mesh.indices.byteOffset, mesh.indices.byteLength));
    hash.update(JSON.stringify([mesh.partId, mesh.name, mesh.flat]));
  }
  return hash.digest('hex');
};
const indexOf = (model: AssemblyModel, name: string) => {
  const index = model.instances.findIndex(instance => instance.name === name);
  expect(index, name).toBeGreaterThanOrEqual(0);
  return index;
};
function capOf(section: SectionModel, name: string): BodyMesh {
  const index = indexOf(section, name),
    mesh = section.meshes[index]!,
    range = section.sectionCaps[index];
  expect(range, `Section cap of ${name}`).not.toBeNull();
  expect(range!.start % 3).toBe(0);
  expect(range!.count % 3).toBe(0);
  expect(range!.count).toBeGreaterThan(0);
  return { ...mesh, indices: mesh.indices.slice(range!.start, range!.start + range!.count) };
}
function area(mesh: BodyMesh) {
  let area = 0;
  for (let i = 0; i < mesh.indices.length; i += 3) {
    const points = [0, 1, 2].map(k => {
      const at = mesh.indices[i + k]! * 3;
      return [mesh.positions[at]!, mesh.positions[at + 1]!, mesh.positions[at + 2]!];
    });
    const a = points[0]!,
      b = points[1]!.map((value, axis) => value - a[axis]!),
      c = points[2]!.map((value, axis) => value - a[axis]!);
    area += Math.hypot(b[1]! * c[2]! - b[2]! * c[1]!, b[2]! * c[0]! - b[0]! * c[2]!, b[0]! * c[1]! - b[1]! * c[0]!) / 2;
  }
  return area;
}
/** An independent occupied-triangle probe in a coordinate-plane section, including the space inside holes. */
function materialAt(cap: BodyMesh, x: number, y: number, axes = [0, 1]) {
  for (let i = 0; i < cap.indices.length; i += 3) {
    const points = [0, 1, 2].map(k => {
      const at = cap.indices[i + k]! * 3;
      return [cap.positions[at + axes[0]!]!, cap.positions[at + axes[1]!]!] as const;
    });
    const sides = points.map((a, k) => {
      const b = points[(k + 1) % 3]!;
      return (b[0] - a[0]) * (y - a[1]) - (b[1] - a[1]) * (x - a[0]);
    });
    if (sides.every(value => value >= -1e-6) || sides.every(value => value <= 1e-6)) return true;
  }
  return false;
}
function capFace(section: SectionModel, name: string): MeasureEntity {
  const index = indexOf(section, name),
    mesh = section.meshes[index]!,
    range = section.sectionCaps[index]!;
  expect(range).not.toBeNull();
  const face = planarMeasurementFace(mesh.positions, mesh.indices, range.start / 3);
  expect(face).not.toBeNull();
  return face!;
}
const distance = (first: MeasureEntity, second: MeasureEntity) => {
  const result = measureEntities([first, second]);
  expect(result.problem).toBeUndefined();
  return result.rows.find(row => row.id === 'min-distance')!.value;
};
function retained(section: SectionModel, height: number, sign: 1 | -1, axis = 2) {
  const axes = [(axis + 1) % 3, (axis + 2) % 3];
  for (let i = 0; i < section.meshes.length; i++) {
    const mesh = section.meshes[i]!,
      range = section.sectionCaps[i];
    let greatestViolation = -Infinity;
    for (const index of mesh.indices) greatestViolation = Math.max(greatestViolation, sign * (mesh.positions[index * 3 + axis]! - height));
    expect(greatestViolation, `${mesh.name} remains in the retained halfspace`).toBeLessThanOrEqual(0.001);
    let smallestArea = Infinity;
    for (let j = 0; j < mesh.indices.length; j += 3) {
      const [a, b, c] = [0, 1, 2].map(k => mesh.indices[j + k]! * 3);
      const bx = mesh.positions[b!]! - mesh.positions[a!]!,
        by = mesh.positions[b! + 1]! - mesh.positions[a! + 1]!,
        bz = mesh.positions[b! + 2]! - mesh.positions[a! + 2]!;
      const cx = mesh.positions[c!]! - mesh.positions[a!]!,
        cy = mesh.positions[c! + 1]! - mesh.positions[a! + 1]!,
        cz = mesh.positions[c! + 2]! - mesh.positions[a! + 2]!;
      smallestArea = Math.min(smallestArea, Math.hypot(by * cz - bz * cy, bz * cx - bx * cz, bx * cy - by * cx) / 2);
    }
    expect(smallestArea, `${mesh.name} has no degenerate retained or cap triangles`).toBeGreaterThan(0);
    if (!range) continue;
    let greatestPlaneError = 0,
      smallestWinding = Infinity;
    for (let j = range.start; j < range.start + range.count; j += 3) {
      const p = [0, 1, 2].map(k => {
        const at = mesh.indices[j + k]! * 3;
        greatestPlaneError = Math.max(greatestPlaneError, Math.abs(mesh.positions[at + axis]! - height));
        return [mesh.positions[at + axes[0]!]!, mesh.positions[at + axes[1]!]!] as const;
      });
      const a = p[0]!,
        b = p[1]!,
        c = p[2]!;
      smallestWinding = Math.min(smallestWinding, sign * ((b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])));
    }
    expect(greatestPlaneError, `${mesh.name} cap vertices lie on the section plane`).toBeCloseTo(0, 4);
    expect(smallestWinding, `${mesh.name} cap triangles face the retained-side boundary normal`).toBeGreaterThan(0);
  }
}

describe('section inspection of complete woodworking designs', () => {
  it('keeps cabinet rebates open, caps the correct occupied material, and measures section faces through resize, flip and reload', async () => {
    let document = source('cupboard');
    const ids = identity(document);
    // The recipe is a 300 mm deep cabinet with 18→21 mm sides and a 6 mm back in 8 mm rebates.
    // Z360 avoids the 5 mm pin pockets and the top/bottom/shelf panels, so its material cross-section is handwritten.
    for (const state of [
      { width: 600, board: 18, gap: 564 },
      { width: 760, board: 21, gap: 718 },
    ]) {
      document = editVariable(editVariable(document, 'width', `${state.width}mm`), 'board', `${state.board}mm`);
      document = (await solveCadDocument(document)).document;
      document = (await solveCadDocument(parseCadDocument(JSON.parse(JSON.stringify(document))))).document;
      expect(identity(document)).toEqual(ids);
      const model = assemblyModel(document),
        before = meshHash(model),
        content = JSON.stringify(document);
      expect(model.problems).toEqual([]);
      expect(model.instances).toHaveLength(6);
      for (const sign of [1, -1] as const) {
        const section = sectionModel(model, { origin: [0, 0, 360], normal: [0, 0, sign] });
        expect(section.sectionProblems).toEqual([]);
        expect(section.instances).toEqual(model.instances);
        expect(section.meshes).toHaveLength(model.meshes.length);
        expect(section.sectionCaps.flatMap((range, i) => (range ? [section.instances[i]!.name] : []))).toEqual([
          'Side',
          'Right side',
          'Back',
        ]);
        retained(section, 360, sign);
        const left = capOf(section, 'Side'),
          right = capOf(section, 'Right side'),
          back = capOf(section, 'Back');
        expect(area(left)).toBeCloseTo(300 * state.board - 8 * 6, 2);
        expect(area(right)).toBeCloseTo(300 * state.board - 8 * 6, 2);
        expect(area(back)).toBeCloseTo((state.width - 2 * state.board + 16) * 6, 2);
        // The side has a real rebate void where the back's separate material is retained.
        expect(materialAt(left, state.board - 4, 297)).toBe(false);
        expect(materialAt(left, state.board / 4, 297)).toBe(true);
        expect(materialAt(back, state.board - 4, 297)).toBe(true);
        expect(distance(capFace(section, 'Side'), capFace(section, 'Right side'))).toBeCloseTo(state.gap, 4);
        const removed = sign === 1 ? 'Top' : 'Bottom';
        expect(section.meshes[indexOf(section, removed)]!.indices).toHaveLength(0);
        expect(meshHash(model)).toBe(before);
        expect(JSON.stringify(document)).toBe(content);
      }
      // A vertical section through the inner 12 mm pin pockets retains all 34 openings rather than capping them solid.
      // The other three panels fill the side's rebates, but remain separate physical cap instances.
      const throughPins = sectionModel(model, { origin: [state.board - 4, 0, 0], normal: [1, 0, 0] });
      expect(throughPins.sectionProblems).toEqual([]);
      expect(throughPins.instances).toEqual(model.instances);
      retained(throughPins, state.board - 4, 1, 0);
      const perforated = capOf(throughPins, 'Side');
      const rectangleArea = 294 * (720 - 2 * state.board),
        radius = 2.5;
      // The established 0.01 mm chord-error contract bounds an inscribed circular approximation independently of its
      // facet count. The 0.1 mm² allowance covers coordinate welding, not an unexplained missing opening.
      expect(area(perforated)).toBeGreaterThan(rectangleArea - 34 * Math.PI * radius ** 2 - 0.1);
      expect(area(perforated)).toBeLessThan(rectangleArea - 34 * Math.PI * (radius - 0.01) ** 2 + 0.1);
      // The rear pin column is 37 mm from the back's inner face: the authored pattern pitch is depth-back-74 mm.
      for (const y of [37, 300 - 6 - 37])
        for (let row = 0; row < 17; row++) {
          const z = state.board + 80 + row * 32;
          expect(materialAt(perforated, y, z, [1, 2]), `Pin opening at stock ${state.board}, Y${y}, Z${z}`).toBe(false);
          expect(materialAt(perforated, y + 3, z, [1, 2])).toBe(true);
        }
      expect(materialAt(perforated, 297, 360, [1, 2])).toBe(false);
      const measured = measureEntities([capFace(throughPins, 'Side')]);
      expect(measured.problem).toBeUndefined();
      expect(measured.rows.find(row => row.id === 'area')!.value).toBeCloseTo(area(perforated), 3);
      expect(meshHash(model)).toBe(before);
      expect(JSON.stringify(document)).toBe(content);
      const restored = sectionModel(model, null);
      expect(restored.meshes).toBe(model.meshes);
      expect(restored.sectionCaps.every(range => range === null)).toBe(true);
    }
  });

  it('preserves exact tray-copy housings and their cap holes through pattern growth, movement and reload', async () => {
    let document = source('divided-tray-copy-tools');
    const divider = document.parts.find(part => part.name === 'Divider')!,
      owner = divider.id,
      patternId = divider.pattern!.id;
    const sourceIds = document.parts.map(part => part.id);
    for (const state of [
      { width: 420, board: 15, count: 4, shift: 0, pitch: 78, gap: 141 },
      { width: 480, board: 18, count: 5, shift: 10, pitch: 74, gap: 130 },
    ]) {
      for (const [name, expression] of [
        ['width', `${state.width}mm`],
        ['board', `${state.board}mm`],
        ['dividers', String(state.count)],
        ['shift', `${state.shift}mm`],
      ])
        document = editVariable(document, name!, expression!);
      for (const tools of ['family', 'third'] as const) {
        const candidate = structuredClone(document);
        candidate.partCuts![0]!.tools = [tools === 'family' ? owner : `${owner}:${patternId}:2`];
        candidate.revision++;
        let solved = (await solveCadDocument(candidate)).document;
        solved = (await solveCadDocument(parseCadDocument(JSON.parse(JSON.stringify(solved))))).document;
        expect(solved.parts.map(part => part.id)).toEqual(sourceIds);
        expect(solved.parts.find(part => part.id === owner)!.copies!.map(copy => copy.id)).toEqual(
          Array.from({ length: state.count - 1 }, (_, i) => `${patternId}:${i + 1}`)
        );
        const model = assemblyModel(solved),
          before = meshHash(model),
          content = JSON.stringify(solved),
          z = state.board - 2;
        expect(model.problems).toEqual([]);
        expect(model.instances).toHaveLength(5 + state.count);
        const section = sectionModel(model, { origin: [0, 0, z], normal: [0, 0, 1] });
        expect(section.sectionProblems).toEqual([]);
        expect(section.instances).toEqual(model.instances);
        retained(section, z, 1);
        const caps = section.sectionCaps.flatMap((range, i) => (range ? [section.instances[i]!.name] : []));
        expect(caps).toEqual(['Base', ...Array.from({ length: state.count }, (_, i) => (i ? `Divider ${i + 1}` : 'Divider'))]);
        const base = capOf(section, 'Base'),
          stripArea = state.board * (240 - 2 * state.board);
        expect(area(base)).toBeCloseTo(state.width * 240 - (tools === 'family' ? state.count : 1) * stripArea, 2);
        for (let slot = 1; slot <= state.count; slot++) {
          const name = slot === 1 ? 'Divider' : `Divider ${slot}`,
            cap = capOf(section, name),
            center = state.board + slot * state.pitch + state.shift;
          expect(area(cap)).toBeCloseTo(stripArea, 2);
          expect(materialAt(cap, center, 120)).toBe(true);
          expect(materialAt(base, center, 120)).toBe(tools !== 'family' && slot !== 3);
          expect(materialAt(base, center, state.board / 2)).toBe(true);
        }
        expect(distance(capFace(section, 'Divider'), capFace(section, 'Divider 3'))).toBeCloseTo(state.gap, 4);
        expect(meshHash(model)).toBe(before);
        expect(JSON.stringify(solved)).toBe(content);
      }
    }
  });
});
