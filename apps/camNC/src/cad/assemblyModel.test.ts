import { createCadDocument, createPlateDocument, evaluateCadDocument, setPartPlacements, type CadDocument, type CadPart } from '@wbcnc/cad';
import { Box3, Matrix4, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import type { BodyMesh } from '@/cam/camTypes';
import { designGeometryFingerprint } from '@/cam/designGeometry';
import { explodeAssembled } from '@/cam/model/layoutFlat';
import { assemblyModel } from './assemblyModel';

const panel = (name: string, width: number, height: number): CadPart => ({
  ...createPlateDocument({ width, height, thickness: 18 }).parts[0]!,
  name,
});
const bounds = (mesh: BodyMesh, matrix = new Matrix4()) => {
  const box = new Box3(),
    v = new Vector3();
  for (let i = 0; i < mesh.positions.length; i += 3) box.expandByPoint(v.fromArray(mesh.positions, i).applyMatrix4(matrix));
  return box;
};
/** A side standing on its edge, its top facing +x at x = 0, and a shelf not yet placed. */
function cupboard(): CadDocument {
  const document: CadDocument = { ...createCadDocument(), parts: [panel('Side', 300, 600), panel('Shelf', 564, 300)] };
  // A quarter turn about y puts the side's thickness along -x and its sketch x upward.
  return setPartPlacements(document, [
    { partId: document.parts[0]!.id, placement: { position: [0, 0, 0], rotation: [0, -Math.SQRT1_2, 0, Math.SQRT1_2] } },
  ]);
}

describe('the assembly', () => {
  it('puts placed parts where they were placed, and lays the rest in a row beside them', () => {
    const model = assemblyModel(cupboard());
    const [side, shelf] = model.meshes.map(mesh => bounds(mesh));
    expect(side!.min.toArray().map(v => Math.round(v) + 0)).toEqual([-18, 0, 0]);
    expect(side!.max.toArray().map(v => Math.round(v) + 0)).toEqual([0, 600, 300]);
    expect(shelf!.min.x).toBeCloseTo(40, 6);
    expect(shelf!.min.z).toBeCloseTo(0, 6);
    expect(model.placements.get(model.parts[1]!.id)).toEqual({ position: [40, 0, 0], rotation: [0, 0, 0, 1] });
  });

  it('can still lay each part flat on its underside, the way CAM sees it', () => {
    for (const mesh of assemblyModel(cupboard()).meshes) {
      const flat = bounds(mesh, new Matrix4().fromArray(mesh.flat));
      expect(flat.min.z).toBeCloseTo(0, 6);
      expect(flat.max.z).toBeCloseTo(18, 6);
    }
  });

  it('never changes what a cut sheet was made from', () => {
    const before = cupboard();
    const after = setPartPlacements(before, [
      { partId: before.parts[1]!.id, placement: { position: [0, 0, 282], rotation: [0, 0, 0, 1] } },
    ]);
    expect(evaluateCadDocument(after).parts.map(designGeometryFingerprint)).toEqual(
      evaluateCadDocument(before).parts.map(designGeometryFingerprint)
    );
  });

  it('pulls touching parts apart when exploded', () => {
    const document = cupboard();
    const touching = setPartPlacements(document, [
      { partId: document.parts[1]!.id, placement: { position: [0, 0, 282], rotation: [0, 0, 0, 1] } },
    ]);
    const { meshes } = assemblyModel(touching);
    const [side, shelf] = explodeAssembled(meshes).map((matrix, i) => bounds(meshes[i]!, matrix));
    expect(shelf!.min.x - side!.max.x).toBeGreaterThan(50);
  });
});
