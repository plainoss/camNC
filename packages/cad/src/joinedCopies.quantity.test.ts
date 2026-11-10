import { expect, it } from 'vitest';
import {
  addPartCopy,
  addPartCut,
  addRectangle,
  assemblyReport,
  cadPartReference,
  cadPartsToCut,
  cadStepReport,
  createCadPart,
  createPlateDocument,
  evaluateCadDocument,
  evaluatedPartCopy,
  evaluateCadPart,
  parseCadDocument,
  pointInPolygon,
  polygonArea,
  resolveDrawnPlacements,
  setPartPattern,
  updatePartCut,
  withPartCuts,
  type EvaluatedCadPart,
} from './index';

function fixture(mirrored = false) {
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

it.each([false, true])('cuts two parents and two joined bosses without changing the saved design (mirrored: %s)', mirrored => {
  const { document, bossId } = fixture(mirrored);
  const before = JSON.stringify(document);
  const evaluated = evaluateCadDocument(document);
  expect(evaluated.diagnostics.filter(item => item.severity === 'error')).toEqual([]);
  const groups = cadPartsToCut(document, evaluated.parts);
  const bosses = groups.filter(group => group.part.partId === bossId || group.part.partId.startsWith(`${bossId}:`));
  expect(bosses.flatMap(group => group.names)).toEqual(['Boss', 'Boss · Parent 2']);
  expect(groups.flatMap(group => group.names)).toHaveLength(4);
  const volume = groups.reduce(
    (total, { part, names }) =>
      total +
      names.length *
        part.thickness *
        (Math.abs(polygonArea(part.outline)) - part.holes.reduce((area, hole) => area + Math.abs(polygonArea(hole)), 0)),
    0
  );
  // Two 100×60×18 parents plus two 20×12×6 bosses with 4×3 through holes.
  expect(volume).toBe(218736);
  expect(JSON.stringify(document)).toBe(before);
  expect(document.parts.find(part => part.id === bossId)!.copies).toBeUndefined();
});

it.each([false, true])('reports every joined body in its host copy frame (mirrored: %s)', mirrored => {
  const { document } = fixture(mirrored);
  const before = JSON.stringify(document);
  const result = assemblyReport(document, evaluateCadDocument(document).parts)!;
  expect(result.parts.map(part => part.name)).toEqual(['Parent', 'Parent 2', 'Boss', 'Boss · Parent 2']);
  expect(result.parts.find(part => part.name === 'Boss · Parent 2')).toMatchObject({
    at: [mirrored ? 165 : 215, 10, 18],
    size: [20, 12, 6],
  });
  expect(result.collisions).toEqual([]);
  expect(JSON.stringify(document)).toBe(before);
});

const throughMaterial = (part: EvaluatedCadPart, point: { x: number; y: number }) =>
  pointInPolygon(point, part.outline) &&
  !part.holes.some(hole => pointInPolygon(point, hole)) &&
  !(part.cuts ?? []).some(
    cut => cut.through && pointInPolygon(point, cut.outline) && !cut.islands.some(island => pointInPolygon(point, island))
  );

it.each(['boss', 'host', 'host-copy', 'copy'] as const)('uses inherited joined material when the %s tool cuts another board', family => {
  const { document, parentId, bossId, copyId } = fixture();
  const target = createPlateDocument({ width: 50, height: 30, thickness: 6 }).parts[0]!;
  target.name = 'Target';
  target.placement = { position: [200, 0, 18], rotation: [0, 0, 0, 1] };
  const toolReference =
    family === 'host'
      ? parentId
      : family === 'host-copy'
        ? cadPartReference(parentId, copyId)
        : family === 'copy'
          ? cadPartReference(bossId, copyId)
          : bossId;
  const source = addPartCut({ ...document, parts: [...document.parts, target] }, [toolReference], [target.id], { value: 0 }).document;
  const before = JSON.stringify(source);
  const result = evaluateCadDocument(source);
  expect(result.diagnostics.filter(item => item.severity === 'error')).toEqual([]);
  const shape = result.parts.find(part => part.partId === target.id)!;
  const cuts = shape.cuts ?? [];
  // The existing cut kernel partitions a rectangular ring into nonoverlapping boxes.
  expect(cuts).toHaveLength(4);
  expect(cuts.every(cut => cut.through)).toBe(true);
  const removedArea = cuts.reduce(
    (total, cut) =>
      total + Math.abs(polygonArea(cut.outline)) - cut.islands.reduce((sum, island) => sum + Math.abs(polygonArea(island)), 0),
    0
  );
  expect(removedArea).toBe(228);
  expect(throughMaterial(shape, { x: 25, y: 18 })).toBe(false);
  expect(throughMaterial(shape, { x: 18, y: 13 })).toBe(true);
  expect(throughMaterial(shape, { x: 2, y: 2 })).toBe(true);
  expect(withPartCuts(source, evaluateCadPart(target).part!)).toEqual(shape);
  const report = cadStepReport(source, result.parts).find(step => step.kind === 'partCut')!;
  expect(report.kind).toBe('partCut');
  if (report.kind === 'partCut') expect(report.cuts.map(cut => cut.tool)).toEqual(Array(4).fill('Boss · Parent 2'));
  expect(JSON.stringify(source)).toBe(before);
});

it.each([
  ['host', false],
  ['host', true],
  ['host-copy', false],
  ['host-copy', true],
  ['copy', false],
  ['copy', true],
] as const)('cuts a joined component through its %s target reference (mirrored: %s)', (scope, mirrored) => {
  const { document, parentId, bossId, copyId } = fixture(mirrored);
  const tool = createPlateDocument({ width: 5, height: 4, thickness: 6 }).parts[0]!;
  tool.name = 'Tool';
  tool.placement = { position: [mirrored ? 171 : 225, 16, 18], rotation: [0, 0, 0, 1] };
  const reference = scope === 'host' ? parentId : cadPartReference(scope === 'host-copy' ? parentId : bossId, copyId);
  const source = addPartCut({ ...document, parts: [...document.parts, tool] }, [tool.id], [reference], { value: 0 }).document;
  const before = JSON.stringify(source);
  const result = evaluateCadDocument(source);
  expect(result.diagnostics.filter(item => item.severity === 'error')).toEqual([]);
  expect(result.diagnostics.filter(item => item.code === 'part-cut-target-missing')).toEqual([]);
  const boss = result.parts.find(part => part.partId === bossId)!;
  expect(boss.copyCuts?.[copyId]).toHaveLength(1);
  expect(throughMaterial(boss, { x: 27, y: 18 })).toBe(true);
  expect(throughMaterial(evaluatedPartCopy(boss, { id: copyId, mirrored }), { x: mirrored ? -27 : 27, y: 18 })).toBe(false);
  expect(result.parts.find(part => part.partId === parentId)!.cuts ?? []).toEqual([]);
  expect(withPartCuts(source, evaluateCadPart(source.parts.find(part => part.id === bossId)!).part!)).toEqual(boss);
  if (scope === 'copy') {
    const report = cadStepReport(source, result.parts).find(step => step.kind === 'partCut')!;
    expect(report.kind).toBe('partCut');
    if (report.kind === 'partCut')
      expect(report.cuts).toMatchObject([{ target: 'Boss · Parent 2', tool: 'Tool', width: 5, length: 4, depth: 6, through: true }]);
  }
  expect(JSON.stringify(source)).toBe(before);
});

it('retains legacy pre-step tool material rather than changing Cut parts into ordered Boolean batches', () => {
  const f = fixture();
  const cutter = createPlateDocument({ width: 5, height: 4, thickness: 6 }).parts[0]!;
  cutter.placement = { position: [225, 16, 18], rotation: [0, 0, 0, 1] };
  const target = createPlateDocument({ width: 50, height: 30, thickness: 6 }).parts[0]!;
  target.placement = { position: [200, 0, 18], rotation: [0, 0, 0, 1] };
  const first = addPartCut(
    { ...f.document, parts: [...f.document.parts, cutter, target] },
    [cutter.id],
    [cadPartReference(f.bossId, f.copyId)],
    { value: 0 }
  );
  const second = addPartCut(first.document, [f.bossId], [target.id], { value: 0 });
  const source = JSON.stringify(second.document);
  const result = evaluateCadDocument(second.document);
  const boss = result.parts.find(part => part.partId === f.bossId)!;
  expect(throughMaterial(evaluatedPartCopy(boss, { id: f.copyId }), { x: 27, y: 18 })).toBe(false);
  // Its earlier cut does not erase the original tool material from the later legacy batch.
  expect(throughMaterial(result.parts.find(part => part.partId === target.id)!, { x: 27, y: 18 })).toBe(false);
  expect(second.document.partCuts!.map(step => step.id)).toEqual([first.id, second.id]);
  expect(JSON.stringify(second.document)).toBe(source);
});

it('refuses an unsupported inherited relative angle instead of cutting its bounding stock', () => {
  const f = fixture();
  const angled = {
    ...f.document,
    parts: f.document.parts.map(part =>
      part.id === f.bossId
        ? {
            ...part,
            placement: {
              position: [0, 0, 18] as [number, number, number],
              rotation: [0, 0, Math.sin(Math.PI / 8), Math.cos(Math.PI / 8)] as [number, number, number, number],
            },
          }
        : part
    ),
  };
  const target = createPlateDocument({ width: 50, height: 50, thickness: 6 }).parts[0]!;
  target.placement = { position: [190, 0, 18], rotation: [0, 0, 0, 1] };
  const document = addPartCut({ ...angled, parts: [...angled.parts, target] }, [cadPartReference(f.bossId, f.copyId)], [target.id], {
    value: 0,
  }).document;
  const before = JSON.stringify(document);
  const result = evaluateCadDocument(document);
  expect(result.parts.find(part => part.partId === target.id)!.cuts ?? []).toEqual([]);
  expect(result.diagnostics).toMatchObject([{ severity: 'warning', message: expect.stringMatching(/isn't square.*can't be cut/) }]);
  expect(JSON.stringify(document)).toBe(before);
});

it('does not let expanded host material erase an explicit inherited-copy split refusal', () => {
  const f = fixture();
  const tool = createPlateDocument({ width: 5, height: 4, thickness: 6 }).parts[0]!;
  tool.placement = { position: [225, 16, 18], rotation: [0, 0, 0, 1] };
  const document = addPartCut(
    { ...f.document, parts: [...f.document.parts, tool] },
    [tool.id],
    [f.parentId, cadPartReference(f.bossId, f.copyId)],
    { value: 0 },
    'half'
  ).document;
  const result = evaluateCadDocument(document);
  expect(result.diagnostics).toMatchObject([{ code: 'part-cut-copy-target-split', severity: 'warning' }]);
  for (const part of result.parts) {
    expect(part.cuts ?? []).toEqual([]);
    expect(part.copyCuts ?? {}).toEqual({});
  }
});

const names = (document: ReturnType<typeof fixture>['document']) =>
  cadPartsToCut(document, evaluateCadDocument(document).parts).flatMap(group => group.names);

it('keeps unavailable poses out of assembly without discarding their machining quantities', () => {
  const f = fixture();
  const document = {
    ...f.document,
    parts: f.document.parts.map(part => {
      const { placement: _placement, ...rest } = part;
      return { ...rest, ...(part.copies && { copies: part.copies.map(copy => ({ id: copy.id })) }) };
    }),
  };
  expect(names(document)).toEqual(['Parent', 'Parent 2', 'Boss', 'Boss · Parent 2']);
  expect(assemblyReport(document, evaluateCadDocument(document).parts)?.parts.map(part => part.name)).toEqual(['Parent']);
});

it('filters suppressed hosts, Add bodies, patterns and copy slots before inheriting quantities', () => {
  const f = fixture();
  const source = JSON.stringify(f.document);
  const change = (id: string, values: object) => ({
    ...f.document,
    parts: f.document.parts.map(part => (part.id === id ? { ...part, ...values } : part)),
  });
  expect(names(change(f.parentId, { copies: [{ ...f.document.parts[0]!.copies![0], suppressed: true }] }))).toEqual(['Parent', 'Boss']);
  expect(names(change(f.bossId, { suppressed: true }))).toEqual(['Parent', 'Parent 2']);
  expect(names(change(f.parentId, { suppressed: true }))).toEqual([]);
  const patterned = setPartPattern(f.document, f.parentId, { count: 3, axis: 'x', spacing: 100 });
  expect(names(patterned)).toHaveLength(8); // The original manual transform plus two patterned copies of each body.
  const suppressed = {
    ...patterned,
    parts: patterned.parts.map(part =>
      part.id === f.parentId ? { ...part, pattern: { ...part.pattern!, suppressed: true as const } } : part
    ),
  };
  expect(names(suppressed)).toEqual(['Parent', 'Parent 2', 'Boss', 'Boss · Parent 2']);
  expect(JSON.stringify(f.document)).toBe(source);
});

it('uses the established implicit support frame for an otherwise unplaced host', () => {
  const f = fixture();
  const document = {
    ...f.document,
    parts: f.document.parts.map(part => {
      if (part.id !== f.parentId) return part;
      const { placement: _placement, ...source } = part;
      return source;
    }),
  };
  const before = JSON.stringify(document);
  const report = assemblyReport(document, evaluateCadDocument(document).parts)!;
  expect(report.parts.map(part => part.name)).toEqual(['Parent', 'Parent 2', 'Boss', 'Boss · Parent 2']);
  expect(report.parts.find(part => part.name === 'Boss · Parent 2')).toMatchObject({ at: [215, 10, 18], size: [20, 12, 6] });
  expect(JSON.stringify(document)).toBe(before);
});

it('retains independently authored Add copies alongside inherited host copies through reload', () => {
  const f = fixture();
  const authored = addPartCopy(f.document, f.bossId, { offset: { position: [0, 100, 0], rotation: [0, 0, 0, 1] } }).document;
  const source = JSON.stringify(authored);
  expect(names(parseCadDocument(JSON.parse(source)))).toEqual(['Parent', 'Parent 2', 'Boss', 'Boss 2', 'Boss · Parent 2']);
  expect(authored.parts.find(part => part.id === f.bossId)!.copies).toHaveLength(1);
  expect(JSON.stringify(authored)).toBe(source);
});

it('preserves physical slots through pattern count edits, reload and absent inherited target diagnostics', () => {
  const f = fixture();
  const withoutManual = { ...f.document, parts: f.document.parts.map(part => (part.id === f.parentId ? { ...part, copies: [] } : part)) };
  const patterned = setPartPattern(withoutManual, f.parentId, { count: 3, axis: 'x', spacing: 100 });
  const [second, third] = patterned.parts[0]!.copies!;
  const tool = createPlateDocument({ width: 5, height: 4, thickness: 6 }).parts[0]!;
  tool.placement = { position: [225, 16, 18], rotation: [0, 0, 0, 1] };
  const reference = cadPartReference(f.bossId, third!.id);
  let document = addPartCut({ ...patterned, parts: [...patterned.parts, tool] }, [tool.id], [reference], { value: 0 }).document;
  for (const count of [3, 2, 3]) {
    document = parseCadDocument(JSON.parse(JSON.stringify(setPartPattern(document, f.parentId, { count, axis: 'x', spacing: 100 }))));
    const before = JSON.stringify(document);
    const result = evaluateCadDocument(document);
    expect(document.parts[0]!.copies!.map(copy => copy.id)).toEqual([second!.id, third!.id].slice(0, count - 1));
    expect(document.partCuts![0]!.targets).toEqual([reference]);
    const boss = result.parts.find(part => part.partId === f.bossId)!;
    if (count === 2) {
      expect(result.diagnostics).toMatchObject([{ code: 'part-cut-target-missing', severity: 'warning' }]);
      expect(boss.copyCuts).toBeUndefined();
    } else {
      expect(result.diagnostics).toEqual([]);
      expect(boss.copyCuts?.[third!.id]).toHaveLength(1);
    }
    expect(document.parts.find(part => part.id === f.bossId)!.copies).toBeUndefined();
    expect(JSON.stringify(document)).toBe(before);
  }
});

it('retains the original whole-host self-cut refusal when its Add material overlaps the host', () => {
  const f = fixture();
  const document = resolveDrawnPlacements({
    ...f.document,
    parts: f.document.parts.map(part => (part.id === f.bossId ? { ...part, drawnOn: { ...part.drawnOn!, offset: -2 } } : part)),
  }).document;
  const source = addPartCut(document, [f.parentId], [f.parentId], { value: 0 }).document;
  const result = evaluateCadDocument(source);
  expect(result.diagnostics.filter(item => item.severity === 'error')).toEqual([]);
  for (const part of result.parts) {
    expect(part.cuts ?? []).toEqual([]);
    expect(part.copyCuts ?? {}).toEqual({});
  }
});

it.each(['host', 'boss', 'copy', 'suppressed', 'split'] as const)(
  'keeps consumption membership and cutting material consistent (%s)',
  mode => {
    const f = fixture();
    const target = createPlateDocument({ width: 50, height: 30, thickness: 6 }).parts[0]!;
    target.name = 'Target';
    target.placement = { position: [200, 0, 18], rotation: [0, 0, 0, 1] };
    const tool = mode === 'boss' ? f.bossId : mode === 'copy' ? cadPartReference(f.parentId, f.copyId) : f.parentId;
    const added = addPartCut({ ...f.document, parts: [...f.document.parts, target] }, [tool], [target.id], { value: 0 });
    const document = updatePartCut(added.document, added.id, {
      consumeTools: true,
      ...(mode === 'suppressed' && { suppressed: true }),
      ...(mode === 'split' && { split: 'half' }),
    });
    const before = JSON.stringify(document);
    const result = evaluateCadDocument(document);
    const expected =
      mode === 'host'
        ? ['Target']
        : mode === 'boss'
          ? ['Parent', 'Parent 2', 'Target']
          : ['Parent', 'Parent 2', 'Boss', 'Boss · Parent 2', 'Target'];
    expect(cadPartsToCut(document, result.parts).flatMap(group => group.names)).toEqual(expected);
    expect(assemblyReport(document, result.parts)?.parts.map(part => part.name)).toEqual(expected);
    if (mode === 'host' || mode === 'boss' || mode === 'copy') {
      const shape = result.parts.find(part => part.partId === target.id)!;
      expect(throughMaterial(shape, { x: 25, y: 18 })).toBe(false);
      expect(throughMaterial(shape, { x: 18, y: 13 })).toBe(true);
    }
    expect(JSON.stringify(document)).toBe(before);
  }
);

it('does not widen an explicit child-copy selection while preserving the host self-cut guard', () => {
  const f = fixture();
  const overlapping = resolveDrawnPlacements({
    ...f.document,
    parts: f.document.parts.map(part => (part.id === f.bossId ? { ...part, drawnOn: { ...part.drawnOn!, offset: -2 } } : part)),
  }).document;
  const source = addPartCut(overlapping, [f.parentId], [f.parentId, cadPartReference(f.bossId, f.copyId)], { value: 0 }).document;
  const result = evaluateCadDocument(source);
  const boss = result.parts.find(part => part.partId === f.bossId)!;
  expect(boss.cuts ?? []).toEqual([]);
  expect(boss.copyCuts?.[f.copyId]).toHaveLength(1);
  expect(result.parts.find(part => part.partId === f.parentId)!.cuts ?? []).toEqual([]);
});
