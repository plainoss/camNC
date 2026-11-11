import { addLine, addRectangle, createCadPart, parseCadDocument, solveCadDocument, withUsedPoints } from '@wbcnc/cad';
import { expect, it } from 'vitest';
import { inheritedCopyFixture, orderedCopyFixture } from '@/test/orderedCopyFixture';
import { assemblyModel } from './assemblyModel';
import { partEdgesOnPlane } from './partEdges';
import { addUsedPartEdges } from './partEdgeUse';
import { partCornerInference } from './partCornerInference';
import { sketchBackdropView } from './sketchBackdropView';
import { straightOn } from './sketchOrbit';
import { physicalFaceFrame } from './studioGeometryReaders';
import { studioGeometry } from './studioGeometry';

const frame = {
  origin: [0, 0, 18] as [number, number, number],
  x: [1, 0, 0] as [number, number, number],
  y: [0, 1, 0] as [number, number, number],
  normal: [0, 0, 1] as [number, number, number],
};

function context(mirrored: boolean) {
  const f = orderedCopyFixture(mirrored),
    model = assemblyModel(f.document);
  const edges = partEdgesOnPlane(model.meshes, frame, model.instances);
  const edge = edges.find(edge => edge.copyId === f.copyId && edge.y1 === 60 && edge.y2 === 60)!;
  expect(edge).toBeDefined();
  const target = createCadPart('Reference sketch');
  target.extrude = false;
  target.drawnOn = { on: { plane: 'top' }, offset: 18 };
  return { ...f, edges, edge, target };
}

it.each([false, true])('refuses a final-pose corner link that cannot survive raw generation and reload, mirrored=%s', async mirrored => {
  const f = context(mirrored),
    before = JSON.stringify(f.document);
  const used = addUsedPartEdges(f.target.sketch, f.edges, [f.edge.key], f.document, frame, f.target.id);
  const candidate = { ...f.document, parts: [...f.document.parts, { ...f.target, sketch: used.sketch }] };
  const solved = await solveCadDocument(candidate);
  expect(solved.status).toBe('solved');
  const reloaded = await solveCadDocument(parseCadDocument(JSON.parse(JSON.stringify(solved.document))));
  expect(reloaded.status).toBe('solved');
  // Neither a cached final-pose point nor a replacement generation-pose link may be published by this refusal.
  expect(reloaded.document.parts.find(part => part.id === f.target.id)!.sketch.entities).toEqual(f.target.sketch.entities);
  expect(used.problem).toBe('Use: this geometry cannot be linked to its source corners yet.');
  expect(used.sketch).toBe(f.target.sketch);
  expect(JSON.stringify(f.document)).toBe(before);
});

it.each([false, true])(
  'does not infer a persistent corner from a later pose or a coincident different creation corner, mirrored=%s',
  mirrored => {
    const f = context(mirrored),
      before = JSON.stringify(f.document);
    const inference = { point: { x: 300, y: 60 }, snap: null, alignments: [], guides: [] };
    const hint = partCornerInference(f.document, f.target, f.edges, { x: 300.1, y: 60.1 }, inference, p => p);
    expect(hint).toBe(inference);
    expect(JSON.stringify(f.document)).toBe(before);
  }
);

it('keeps a generation sketch backdrop before the later spatial stream', () => {
  const f = orderedCopyFixture(),
    target = createCadPart('Reference sketch');
  target.extrude = false;
  target.drawnOn = { on: { plane: 'top' }, offset: 18 };
  target.sketch = addLine(target.sketch, { x1: -50, y1: -40, x2: 550, y2: -40 });
  const source = { ...f.document, parts: [...f.document.parts, target] },
    bytes = JSON.stringify(source);
  const backdrop = sketchBackdropView(source, target, { x: 0, y: 0, w: 600, h: 200 }, straightOn, { width: 600, height: 200 })!;
  expect(backdrop.document.operationOrder).toEqual([]);
  const model = assemblyModel(backdrop.document);
  expect(model.placements.get(`${f.partId}/${f.copyId}`)!.position).toEqual([200, 0, 0]);
  expect(JSON.stringify(source)).toBe(bytes);
});

it('reads a physical face frame without writing the source creation pose', () => {
  const f = context(false),
    bytes = JSON.stringify(f.document);
  expect(physicalFaceFrame(f.document, { partId: f.partId, copyId: f.copyId, face: 'top' })).toMatchObject({
    origin: [300, 0, 18],
    normal: [0, 0, 1],
  });
  expect(JSON.stringify(f.document)).toBe(bytes);
});

it('keeps an existing generated Used body at its cached coordinates when the support moves later', () => {
  const f = orderedCopyFixture(),
    dependent = createCadPart('Generated reference body', 3);
  const corner = f.document.parts[0]!.sketch.entities.find(entity => entity.type === 'point' && entity.x === 100 && entity.y === 60)!;
  dependent.placement = { position: [0, 0, 0], rotation: [0, 0, 0, 1] };
  dependent.sketch = addRectangle(dependent.sketch, { x: 300, y: 60, width: 20, height: 10 });
  const point = dependent.sketch.entities.find(entity => entity.type === 'point' && entity.x === 300 && entity.y === 60)!;
  if (point.type !== 'point') throw Error('Missing generated point.');
  point.used = { partId: f.partId, copyId: f.copyId, pointId: corner.id, side: 'top' };
  const source = { ...f.document, parts: [...f.document.parts, dependent] },
    bytes = JSON.stringify(source);
  const geometry = studioGeometry(source),
    frozen = geometry.document.parts.find(part => part.id === dependent.id)!;
  expect(geometry.document.parts[0]!.copies![0]!.placement!.position).toEqual([300, 0, 0]);
  expect(withUsedPoints(geometry.document, frozen).entities.find(entity => entity.id === point.id)).toMatchObject({ x: 300, y: 60 });
  expect(frozen.sketch.entities.find(entity => entity.id === point.id)).not.toHaveProperty('used');
  expect(point.used.pointId).toBe(corner.id);
  expect(JSON.stringify(source)).toBe(bytes);
});

it('refuses a virtual Add-body corner association that raw generation cannot persist, without hiding its geometry', () => {
  const f = inheritedCopyFixture(),
    model = assemblyModel(f.document),
    bytes = JSON.stringify(f.document);
  const plane = { ...frame, origin: [0, 0, 28] as [number, number, number] };
  const edges = partEdgesOnPlane(model.meshes, plane, model.instances);
  const edge = edges.find(edge => edge.partId === f.childId && edge.copyId === f.copyId && edge.onPlane)!;
  expect(edge).toBeDefined();
  const target = createCadPart('Unlinked reference');
  const used = addUsedPartEdges(target.sketch, edges, [edge.key], f.document, plane, target.id);
  expect(used.problem).toBe('Use: this geometry cannot be linked to its source corners yet.');
  expect(used.sketch).toBe(target.sketch);
  expect(model.instances.some(instance => instance.partId === f.childId && instance.copyId === f.copyId)).toBe(true);
  expect(JSON.stringify(f.document)).toBe(bytes);
});
