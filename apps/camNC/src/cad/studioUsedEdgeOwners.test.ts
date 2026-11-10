import { readFileSync } from 'node:fs';
import {
  cadPartsToCut,
  cadSketchFrame,
  createCadPart,
  evaluateCadDocument,
  parseCadDocument,
  setCadVariable,
  solveCadDocument,
  type CadDocument,
  type CadPointEntity,
} from '@wbcnc/cad';
import { expect, it } from 'vitest';
import { assemblyModel } from './assemblyModel';
import { addUsedPartEdges } from './partEdgeUse';
import { partEdgesOnPlane } from './partEdges';

const load = (name: string) =>
  parseCadDocument(
    JSON.parse(readFileSync(new URL(`../../../../packages/cad-script/fixtures/designs/${name}.json`, import.meta.url), 'utf8'))
  );
function variable(document: CadDocument, name: string, expression: string) {
  const source = document.variables!.find(variable => variable.name === name)!;
  const changed = setCadVariable(document, { ...source, expression });
  if ('error' in changed) throw new Error(changed.error);
  return changed.document;
}

it.each([
  {
    name: 'cupboard',
    owner: 'Side',
    copy: 0,
    depth: 300,
    states: [
      { board: 18, width: 600, count: 0, pieces: 6 },
      { board: 21, width: 720, count: 0, pieces: 6 },
    ],
    edits: { board: '21mm', width: '720mm' },
  },
  {
    name: 'divided-tray',
    owner: 'Divider',
    copy: 1,
    depth: 240,
    states: [
      { board: 12, width: 360, count: 3, pieces: 8 },
      { board: 15, width: 420, count: 4, pieces: 9 },
    ],
    edits: { board: '15mm', width: '420mm', dividers: '4' },
  },
])('keeps an existing Use link on its exact copy through complete $name edits and reload', async recipe => {
  let document = load(recipe.name);
  const partIds = document.parts.map(part => part.id);
  let identity:
    | {
        partId: string;
        sketchId: string;
        entityIds: string[];
        copyId: string;
        bindings: { id: string; reference: NonNullable<CadPointEntity['used']>; far: boolean }[];
      }
    | undefined;
  for (let step = 0; step < 2; step++) {
    if (step) for (const [name, expression] of Object.entries(recipe.edits)) document = variable(document, name, expression!);
    const solved = await solveCadDocument(parseCadDocument(JSON.parse(JSON.stringify(document))));
    expect(solved.status).toBe('solved');
    document = solved.document;
    const source = document.parts.find(part => part.name === recipe.owner)!,
      copyId = source.copies![recipe.copy]!.id,
      bodyDocument = { ...document, parts: document.parts.filter(part => part.id !== identity?.partId) },
      originalBody = JSON.stringify(bodyDocument),
      model = assemblyModel(bodyDocument),
      baseline = cadPartsToCut(bodyDocument, evaluateCadDocument(bodyDocument).parts),
      state = recipe.states[step]!;
    expect(model.problems).toEqual([]);
    expect(baseline.flatMap(part => part.names)).toHaveLength(state.pieces);
    expect(bodyDocument.parts.map(part => part.id)).toEqual(partIds);
    if (!identity) {
      const target = createCadPart('Reference sketch');
      target.extrude = false;
      target.drawnOn = { on: { plane: 'top' }, offset: 0 };
      const frame = cadSketchFrame(document, target)!;
      // The floor housing edges project onto the divider. Hide only the floor in the view; retain it in source/CAM.
      const projected =
        recipe.name === 'divided-tray' ? assemblyModel(document, new Set([document.parts.find(part => part.name === 'Base')!.id])) : model;
      const edges = partEdgesOnPlane(projected.meshes, frame, projected.instances);
      const used = edges
        .filter(edge => edge.partId === source.id && edge.copyId === copyId && !edge.ambiguous)
        .map(edge => addUsedPartEdges(target.sketch, [edge], [edge.key], document, frame, target.id))
        .find(result => !result.problem);
      expect(used, `An authored edge of ${recipe.owner}'s exact copy must remain usable.`).toBeDefined();
      target.sketch = { ...used!.sketch, entities: used!.sketch.entities.map(entity => ({ ...entity, construction: true })) };
      const bindings = target.sketch.entities.flatMap(entity => {
        if (entity.type !== 'point' || !entity.used) return [];
        const point = source.sketch.entities.find(point => point.id === entity.used!.pointId);
        if (point?.type !== 'point') throw new Error('The picked corner must belong to the authored source sketch.');
        const far = point.x > recipe.depth / 2;
        expect(point.x).toBeCloseTo(
          recipe.name === 'cupboard' ? (far ? recipe.depth : 0) : far ? recipe.depth - state.board : state.board,
          6
        );
        return [{ id: entity.id, reference: entity.used, far }];
      });
      expect(bindings).toHaveLength(2);
      identity = {
        partId: target.id,
        sketchId: target.sketch.id,
        entityIds: target.sketch.entities.map(entity => entity.id),
        copyId,
        bindings,
      };
      document = { ...document, revision: document.revision + 1, parts: [...document.parts, target] };
    }
    const kept = identity,
      saved = parseCadDocument(JSON.parse(JSON.stringify(document))),
      target = saved.parts.find(part => part.id === kept.partId)!;
    expect(target.sketch.id).toBe(identity.sketchId);
    expect(target.sketch.entities.map(entity => entity.id)).toEqual(identity.entityIds);
    expect(copyId).toBe(identity.copyId);
    for (const binding of identity.bindings) {
      const point = target.sketch.entities.find(point => point.id === binding.id) as CadPointEntity;
      expect(point.used).toEqual(binding.reference);
      expect(point.used).toMatchObject({ partId: source.id, copyId });
      // Independent recipe arithmetic in the Top plane: mirrored cabinet side at width, or the third tray divider.
      const top = binding.reference.side === 'top' ? state.board : 0;
      const x =
        recipe.name === 'cupboard' ? state.width - top : state.board / 2 + (3 * (state.width - 2 * state.board)) / (state.count + 1) + top;
      const y = recipe.name === 'cupboard' ? (binding.far ? recipe.depth : 0) : binding.far ? recipe.depth - state.board : state.board;
      expect(point.x).toBeCloseTo(x, 6);
      expect(point.y).toBeCloseTo(y, 6);
    }
    const evaluated = evaluateCadDocument(saved),
      shown = assemblyModel(saved);
    expect(evaluated.diagnostics.filter(diagnostic => diagnostic.severity === 'error')).toEqual([]);
    // Construction references must not alter any existing outline, stock dimension, pocket or physical cutting quantity.
    expect(cadPartsToCut(saved, evaluated.parts)).toEqual(baseline);
    expect(shown.instances).toEqual(model.instances);
    shown.meshes.forEach((mesh, at) => {
      expect(mesh.positions).toEqual(model.meshes[at]!.positions);
      expect(mesh.indices).toEqual(model.meshes[at]!.indices);
    });
    expect(saved.parts.slice(0, -1)).toEqual(bodyDocument.parts);
    expect(JSON.stringify(bodyDocument)).toBe(originalBody);
    document = saved;
  }
});
