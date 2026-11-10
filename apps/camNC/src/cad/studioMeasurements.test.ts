import { readFileSync } from 'node:fs';
import { parseCadDocument, setCadVariable, solveCadDocument, type CadDocument } from '@wbcnc/cad';
import { describe, expect, it } from 'vitest';
import { planarMeasurementFace } from '@/cam/model/measurementPick';
import { assemblyModel, type AssemblyModel } from './assemblyModel';
import { measureEntities, type MeasureEntity } from './measureGeometry';

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
const value = (entities: MeasureEntity[], id: string): number => {
  const result = measureEntities(entities);
  expect(result.problem).toBeUndefined();
  const row = result.rows.find(candidate => candidate.id === id);
  expect(row, id).toBeDefined();
  return row!.value;
};

/** Select an actual finite rendered face on an independently specified recipe plane, never a candidate-derived bound. */
function faceOn(model: AssemblyModel, partId: string, copyId: string | undefined, axis: number, coordinate: number): MeasureEntity {
  const index = model.instances.findIndex(instance => instance.partId === partId && instance.copyId === copyId);
  expect(index, `${partId}/${copyId ?? 'source'}`).toBeGreaterThanOrEqual(0);
  const mesh = model.meshes[index]!;
  const triangle = Array.from({ length: mesh.indices.length / 3 }, (_, i) => i).find(i =>
    [0, 1, 2].every(k => Math.abs(mesh.positions[mesh.indices[i * 3 + k]! * 3 + axis]! - coordinate) < 0.001)
  );
  expect(triangle, `Actual face at axis ${axis} = ${coordinate}`).toBeDefined();
  const entity = planarMeasurementFace(mesh.positions, mesh.indices, triangle!);
  expect(entity).not.toBeNull();
  return entity!;
}

describe('assembled measurements on complete woodworking designs', () => {
  it('checks cabinet stock, inside span and uncut side area after parametric resizing and reload', async () => {
    let document = source('cupboard');
    const sideId = document.parts.find(part => part.name === 'Side')!.id;
    const mirrorId = document.parts.find(part => part.id === sideId)!.copies![0]!.id;
    const originalIds = document.parts.map(part => [part.id, ...(part.copies ?? []).map(copy => copy.id)]);
    // These are handwritten source-recipe expectations: width600→760 and stock18→21, with depth300 and height720.
    for (const state of [
      { width: 600, board: 18, inside: 564, reload: false },
      { width: 760, board: 21, inside: 718, reload: true },
    ]) {
      document = editVariable(editVariable(document, 'width', `${state.width}mm`), 'board', `${state.board}mm`);
      document = (await solveCadDocument(document)).document;
      if (state.reload) document = (await solveCadDocument(parseCadDocument(JSON.parse(JSON.stringify(document))))).document;
      expect(document.parts.map(part => [part.id, ...(part.copies ?? []).map(copy => copy.id)])).toEqual(originalIds);
      const model = assemblyModel(document);
      expect(model.problems).toEqual([]);
      expect(model.instances).toHaveLength(6);
      const outside = faceOn(model, sideId, undefined, 0, 0);
      const inside = faceOn(model, sideId, undefined, 0, state.board);
      const mirroredInside = faceOn(model, sideId, mirrorId, 0, state.width - state.board);
      expect(value([outside, inside], 'min-distance')).toBeCloseTo(state.board, 5);
      expect(value([inside, mirroredInside], 'min-distance')).toBeCloseTo(state.inside, 5);
      expect(value([outside], 'area')).toBeCloseTo(300 * 720, 4);
    }
  });

  it('measures the exact third divider rather than a sibling after movement, growth and reload', async () => {
    let document = source('divided-tray-copy-tools');
    const divider = document.parts.find(part => part.name === 'Divider')!;
    const owner = divider.id,
      patternId = divider.pattern!.id;
    const secondId = `${patternId}:1`,
      thirdId = `${patternId}:2`;
    // The authored pitch is (width - 2*board)/(count + 1). First state:78; edited state:74.
    for (const state of [
      { width: 420, board: 15, count: 4, shift: 0, first: 85.5, second: 163.5, third: 241.5, thirdGap: 141, siblingGap: 63 },
      { width: 480, board: 18, count: 5, shift: 10, first: 93, second: 167, third: 241, thirdGap: 130, siblingGap: 56 },
    ]) {
      for (const [name, expression] of [
        ['width', `${state.width}mm`],
        ['board', `${state.board}mm`],
        ['dividers', String(state.count)],
        ['shift', `${state.shift}mm`],
      ])
        document = editVariable(document, name!, expression!);
      document = (await solveCadDocument(document)).document;
      document = (await solveCadDocument(parseCadDocument(JSON.parse(JSON.stringify(document))))).document;
      const current = document.parts.find(part => part.id === owner)!;
      expect(current.copies!.map(copy => copy.id)).toEqual(Array.from({ length: state.count - 1 }, (_, i) => `${patternId}:${i + 1}`));
      const model = assemblyModel(document);
      expect(model.problems).toEqual([]);
      expect(model.instances).toHaveLength(5 + state.count);
      const firstRight = faceOn(model, owner, undefined, 0, state.first + state.board);
      const secondLeft = faceOn(model, owner, secondId, 0, state.second);
      const thirdLeft = faceOn(model, owner, thirdId, 0, state.third);
      expect(value([firstRight, thirdLeft], 'min-distance')).toBeCloseTo(state.thirdGap, 5);
      expect(value([firstRight, secondLeft], 'min-distance')).toBeCloseTo(state.siblingGap, 5);
      // Each uncut divider face spans the depth between the walls and reaches4mm into the floor.
      expect(value([thirdLeft], 'area')).toBeCloseTo((240 - 2 * state.board) * (80 - state.board + 4), 4);
    }
  });
});
