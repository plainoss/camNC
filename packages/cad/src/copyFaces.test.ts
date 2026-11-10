import { newExtrudeOnFace } from './faceExtrude';
import { evaluateCadPart } from './geometry';
import { extrudeStepProblem, removeSupport, resolveExtrudeSteps, isJoinedBody } from './extrudeSteps';
import { designSteps } from './designSteps';
import { parseCadDocument } from './parseCadDocument';
import { describe, expect, it } from 'vitest';
import { addLine, addArc, addCircle, createCadDocument, createCadPart, createPlateDocument } from './document';
import { cadFaceFrame, resolveDrawnPlacements } from './drawnOn';
import { setPartPattern } from './partPatterns';

function studio() {
  const source = createPlateDocument({ width: 300, height: 600, thickness: 19 }).parts[0]!;
  source.drawnOn = { on: { plane: 'top' }, offset: 0 };
  const patterned = setPartPattern({ ...createCadDocument(), parts: [source] }, source.id, { axis: 'z', count: 3, spacing: 300 });
  const copyId = patterned.parts[0]!.copies![1]!.id;
  const edge = source.sketch.entities.find(
    entity =>
      entity.type === 'line' &&
      source.sketch.entities.some(point => point.type === 'point' && point.id === entity.startId && point.x === 300 && point.y === 0)
  )!.id;
  const child = createCadPart('Back');
  child.drawnOn = { on: { partId: source.id, copyId, face: { edge } }, offset: 0 };
  return { source, copyId, child, document: { ...patterned, parts: [...patterned.parts, child] } };
}

describe('sketches attached to copy faces', () => {
  it('keeps the exact pattern instance through reload, movement and spacing edits in one placement pass', () => {
    const initial = studio();
    const loaded = parseCadDocument(JSON.parse(JSON.stringify(initial.document)));
    const first = resolveDrawnPlacements(loaded);
    expect(first.diagnostics).toEqual([]);
    expect(first.document.parts[1]!.placement!.position).toEqual([300, 0, 600]);
    const moved = {
      ...loaded,
      parts: loaded.parts.map(part =>
        part.id === initial.source.id
          ? { ...part, moved: { by: [40, 0, 0] as [number, number, number] }, pattern: { ...part.pattern!, spacing: 350 } }
          : part
      ),
    };
    const next = resolveDrawnPlacements(moved);
    expect(next.diagnostics).toEqual([]);
    expect(next.document.parts[1]!.placement!.position).toEqual([340, 0, 700]);
  });

  it('reports a removed copy rather than placing the sketch on the source face', () => {
    const initial = studio();
    const source = { ...initial.document.parts[0]!, pattern: { ...initial.document.parts[0]!.pattern!, count: 2 } };
    const result = resolveDrawnPlacements({ ...initial.document, parts: [source, initial.child] });
    expect(result.diagnostics).toEqual([expect.objectContaining({ code: 'drawn-on-unresolved', partId: initial.child.id })]);
    expect(
      cadFaceFrame({ ...initial.document, parts: [{ ...source, copies: [] }, initial.child] }, initial.child.drawnOn!.on)
    ).toHaveProperty('error');
  });

  it('uses a mirrored copy’s reflected edge and preserves outward orientation', () => {
    const initial = studio();
    const source = {
      ...initial.source,
      copies: [
        {
          id: initial.copyId,
          mirrored: true,
          placement: { position: [1000, 0, 0] as [number, number, number], rotation: [0, 0, 0, 1] as [number, number, number, number] },
        },
      ],
    };
    const document = { ...initial.document, parts: [source, initial.child] };
    const result = resolveDrawnPlacements(document);
    expect(result.diagnostics).toEqual([]);
    const frame = cadFaceFrame(document, initial.child.drawnOn!.on);
    expect(frame).toMatchObject({ origin: [700, 600, 0], normal: [-1, 0, 0], length: 600 });
    expect(result.document.parts[1]!.placement!.position).toEqual([700, 600, 0]);
  });
});

it('resolves a pattern direction from another part while attaching to its copy', () => {
  const initial = studio();
  const guide = createPlateDocument({ width: 40, height: 40, thickness: 10 }).parts[0]!;
  guide.drawnOn = { on: { plane: 'right' }, offset: 0 };
  const placedGuide = resolveDrawnPlacements({ ...createCadDocument(), parts: [guide] }).document.parts[0]!;
  const source = {
    ...initial.document.parts[0]!,
    pattern: {
      ...initial.document.parts[0]!.pattern!,
      axis: 'z' as const,
      direction: { along: { partId: guide.id, face: 'top' as const } },
    },
  };
  const result = resolveDrawnPlacements({ ...initial.document, parts: [placedGuide, source, initial.child] });
  expect(result.diagnostics).toEqual([]);
  expect(result.document.parts[2]!.placement!.position).toEqual([900, 0, 0]);
});

it('moves along the normal of a rotated copy rather than its source', () => {
  const initial = studio();
  const source = {
    ...initial.source,
    copies: [
      {
        id: initial.copyId,
        placement: {
          position: [1000, 0, 0] as [number, number, number],
          rotation: [0, Math.SQRT1_2, 0, Math.SQRT1_2] as [number, number, number, number],
        },
      },
    ],
  };
  const moved = {
    ...createCadPart('Moved'),
    drawnOn: { on: { plane: 'top' as const }, offset: 0 },
    moved: { along: { partId: source.id, copyId: initial.copyId, face: 'top' as const }, distance: 25 },
  };
  const result = resolveDrawnPlacements({ ...initial.document, parts: [source, moved] });
  expect(result.document.parts[1]!.placement!.position).toEqual([25, 0, 0]);
});

it('keeps straight edge frames correct on a mirrored panel with a curved outline', () => {
  const source = createCadPart('Rounded');
  source.drawnOn = { on: { plane: 'top' }, offset: 0 };
  source.sketch = addLine(source.sketch, { x1: 0, y1: 0, x2: 60, y2: 0 });
  const edge = source.sketch.entities.at(-1)!.id;
  source.sketch = addArc(source.sketch, { cx: 60, cy: 20, radius: 20, startAngle: -Math.PI / 2, endAngle: Math.PI / 2 });
  source.sketch = addLine(source.sketch, { x1: 60, y1: 40, x2: 0, y2: 40 });
  source.sketch = addLine(source.sketch, { x1: 0, y1: 40, x2: 0, y2: 0 });
  source.copies = [{ id: 'mirror', mirrored: true, placement: { position: [200, 0, 0], rotation: [0, 0, 0, 1] } }];
  const document = { ...createCadDocument(), parts: [source] };
  expect(cadFaceFrame(document, { partId: source.id, copyId: 'mirror', face: { edge } })).toMatchObject({
    origin: [140, 0, 0],
    normal: [0, -1, 0],
    length: 60,
  });
});

it('marks attached sketches and extrudes broken while their chosen copy is removed or suppressed', () => {
  const initial = studio();
  for (const source of [
    { ...initial.document.parts[0]!, copies: [] },
    { ...initial.document.parts[0]!, pattern: { ...initial.document.parts[0]!.pattern!, count: 2 } },
    { ...initial.document.parts[0]!, pattern: { ...initial.document.parts[0]!.pattern!, suppressed: true as const } },
    { ...initial.document.parts[0]!, copies: initial.document.parts[0]!.copies!.map(copy => ({ ...copy, suppressed: true as const })) },
  ]) {
    const steps = designSteps({ ...initial.document, parts: [source, initial.child] }).filter(step => step.partId === initial.child.id);
    expect(steps).toHaveLength(2);
    expect(steps.every(step => step.broken?.includes('copy'))).toBe(true);
  }
  expect(
    designSteps(initial.document)
      .filter(step => step.partId === initial.child.id)
      .every(step => !step.broken)
  ).toBe(true);
});

it('refuses copy-face Add, Remove and Hole instead of modifying the source family', () => {
  const initial = studio();
  for (const operation of [{ addTo: initial.source.id }, { remove: { depth: 6 } }, { remove: { depth: 6 }, hole: { diameter: 5 } }]) {
    const child = { ...initial.child, ...operation };
    const document = { ...initial.document, parts: [initial.document.parts[0]!, child] };
    expect(extrudeStepProblem(document, child)).toContain('on a copy');
    expect(removeSupport(document, child)).toHaveProperty('error');
    expect(isJoinedBody(document, child)).toBe(false);
    expect(resolveExtrudeSteps(document).parts[0]!.features).toBeUndefined();
  }
});

it('preserves the reflected holes when a mirrored copy face is extruded as New', () => {
  const source = createPlateDocument({ width: 100, height: 80, thickness: 19 }).parts[0]!;
  source.sketch = addCircle(source.sketch, { x: 20, y: 30, radius: 4 });
  source.drawnOn = { on: { plane: 'top' }, offset: 0 };
  source.copies = [{ id: 'mirror', mirrored: true, placement: { position: [300, 0, 0], rotation: [0, 0, 0, 1] } }];
  const document = { ...createCadDocument(), parts: [source] };
  const made = newExtrudeOnFace(document, { partId: source.id, copyId: 'mirror', face: 'top' }, 'New');
  const result = evaluateCadPart(made);
  expect(result.part).toBeDefined();
  expect(result.part!.holes).toHaveLength(1);
  expect(Math.min(...result.part!.holes[0]!.map(point => point.x))).toBeCloseTo(-24, 1);
  expect(Math.max(...result.part!.holes[0]!.map(point => point.x))).toBeCloseTo(-16, 1);
});
