import { describe, expect, it } from 'vitest';
import {
  activeDesign,
  addRectangle,
  assemblyReport,
  cadPartsToCut,
  cadPartReference,
  cadVariableProblems,
  cadVariableUses,
  createPlateDocument,
  designSteps,
  evaluateCadDocument,
  parseCadDocument,
  placePoint,
  polygonArea,
  renamePartCopy,
  resolvePartPatterns,
  setCadVariable,
  setPartPattern,
  solveCadDocument,
  type CadDocument,
  type CadPartPattern,
} from './index';

type Circular = NonNullable<CadPartPattern['circular']>;
const ring: Circular = { origin: [0, 0, 0], axis: [0, 0, 1], angle: 360 };
const source = () => {
  const document = createPlateDocument({ name: 'Leg', width: 20, height: 30, thickness: 18 });
  document.parts[0]!.name = 'Leg';
  document.parts[0]!.placement = { position: [100, 0, 0], rotation: [0, 0, 0, 1] };
  return document;
};
const pattern = (document: CadDocument, count = 4, circular = ring) =>
  setPartPattern(document, document.parts[0]!.id, { axis: 'x', spacing: 100, count, circular });
const positions = (document: CadDocument) => document.parts[0]!.copies!.map(copy => copy.placement!.position);
const variable = (document: CadDocument, name: string, expression: string, id?: string) => {
  const result = setCadVariable(document, { name, expression, id });
  if ('error' in result) throw new Error(result.error);
  return resolvePartPatterns(result.document);
};

describe('circular part patterns', () => {
  it('makes a closed four-leg ring without duplicating the seed and preserves its cutting shape', async () => {
    const document = pattern(source());
    expect(positions(document)).toEqual([
      [0, 100, 0],
      [-100, 0, 0],
      [0, -100, 0],
    ]);
    const solved = await solveCadDocument(document);
    const report = assemblyReport(solved.document, solved.parts)!;
    expect(JSON.parse(JSON.stringify(report.parts))).toEqual([
      { name: 'Leg', at: [100, 0, 0], size: [20, 30, 18] },
      { name: 'Leg 2', at: [-30, 100, 0], size: [30, 20, 18] },
      { name: 'Leg 3', at: [-120, -30, 0], size: [20, 30, 18] },
      { name: 'Leg 4', at: [0, -120, 0], size: [30, 20, 18] },
    ]);
    expect(report.collisions).toEqual([]);
    const pieces = cadPartsToCut(solved.document, solved.parts);
    expect(pieces).toHaveLength(1);
    expect(pieces[0]!.names).toEqual(['Leg', 'Leg 2', 'Leg 3', 'Leg 4']);
    expect(polygonArea(pieces[0]!.part.outline)).toBeCloseTo(600, 9);
    expect(pieces[0]!.part.thickness).toBe(18);
    expect(parseCadDocument(JSON.parse(JSON.stringify(solved.document)))).toEqual(solved.document);
    expect(designSteps(document).find(step => step.kind === 'pattern')).toMatchObject({
      label: 'Circular pattern · Leg × 4',
      detail: 'angle 360°',
    });
  });

  it('distinguishes total sweep, per-instance angle, opposite direction and one instance', () => {
    let document = pattern(source(), 3, { ...ring, angle: 180 });
    expect(positions(document)).toEqual([
      [0, 100, 0],
      [-100, 0, 0],
    ]);
    document = pattern(document, 3, { ...ring, angle: 180, equalSpacing: false });
    expect(positions(document)).toEqual([
      [-100, 0, 0],
      [100, 0, 0],
    ]);
    document = pattern(document, 3, { ...ring, angle: 90, equalSpacing: false });
    expect(positions(document)).toEqual([
      [0, 100, 0],
      [-100, 0, 0],
    ]);
    document = pattern(document, 3, { ...ring, angle: 180, opposite: true });
    expect(positions(document)).toEqual([
      [0, -100, 0],
      [-100, 0, 0],
    ]);
    document = pattern(document, 1);
    expect(document.parts[0]!.copies).toBeUndefined();
  });

  it('turns about an arbitrary line, including the source orientation', () => {
    const document = source();
    document.parts[0]!.placement = { position: [11, 22, 33], rotation: [0, 0, Math.SQRT1_2, Math.SQRT1_2] };
    const changed = pattern(document, 2, { origin: [10, 20, 30], axis: [2, 2, 0], angle: 180 });
    const copy = changed.parts[0]!.copies![0]!;
    expect(copy.placement!.position).toEqual([12, 21, 27]);
    // A half turn around x=y exchanges x/y and reverses z, independently of the seed's quarter-turn.
    placePoint(copy.placement, [1, 2, 3]).forEach((value, axis) => expect(value).toBeCloseTo([13, 19, 24][axis]!, 9));
  });

  it('anchors an unplaced seed at the origin for the circular copies and refuses invalid programmatic axes', () => {
    const document = source();
    delete document.parts[0]!.placement;
    const changed = pattern(document, 2, { origin: [10, 0, 0], axis: [0, 0, 1], angle: 180 });
    expect(positions(changed)).toEqual([[20, 0, 0]]);
    expect(assemblyReport(changed, evaluateCadDocument(changed).parts)!.parts).toHaveLength(2);
    for (const axis of [
      [0, 0, 0],
      [0, Infinity, 1],
    ] as [number, number, number][]) {
      expect(() => pattern(document, 2, { ...ring, axis })).toThrow(/circular part pattern/);
    }
  });

  it('retains an unplaced circular seed while its pattern is suppressed, restored, saved or removed', async () => {
    const document = source();
    delete document.parts[0]!.placement;
    const patterned = pattern(document, 4, { ...ring, origin: [100, 0, 0] });
    const report = (source: CadDocument) => assemblyReport(activeDesign(source), evaluateCadDocument(activeDesign(source)).parts);
    expect(report(patterned)!.parts).toHaveLength(4);
    patterned.parts[0]!.pattern!.suppressed = true;
    const saved = parseCadDocument(JSON.parse(JSON.stringify(patterned)));
    expect(report(saved)!.parts).toEqual([{ name: 'Leg', at: [0, 0, 0], size: [20, 30, 18] }]);
    const solved = await solveCadDocument(saved);
    expect(report(solved.document)!.parts).toEqual([{ name: 'Leg', at: [0, 0, 0], size: [20, 30, 18] }]);
    delete solved.document.parts[0]!.pattern!.suppressed;
    const restored = resolvePartPatterns(solved.document);
    expect(report(restored)!.parts).toHaveLength(4);
    expect(positions(restored)).toEqual([
      [100, -100, 0],
      [200, 0, 0],
      [100, 100, 0],
    ]);
    // Suppression materializes the implicit frame only in the built view. Removing the feature restores the unplaced seed.
    expect(saved.parts[0]!.placement).toBeUndefined();
    const removed = setPartPattern(saved, saved.parts[0]!.id, null);
    expect(removed.parts[0]!.placement).toBeUndefined();
    expect(report(removed)).toBeUndefined();
  });

  it('preserves removed material in the rotated copy, rather than filling its bounding box', () => {
    const document = source();
    document.parts[0]!.sketch = addRectangle(document.parts[0]!.sketch, { x: 5, y: 10, width: 10, height: 10 });
    const changed = pattern(document);
    const probe = createPlateDocument({ name: 'Probe', width: 4, height: 4, thickness: 18 }).parts[0]!;
    probe.name = 'Probe';
    // The hole at source x=5..15,y=10..20 rotates to world x=-20..-10,y=105..115.
    probe.placement = { position: [-17, 108, 0], rotation: [0, 0, 0, 1] };
    const withProbe = { ...changed, parts: [...changed.parts, probe] };
    expect(assemblyReport(withProbe, evaluateCadDocument(withProbe).parts)!.collisions).toEqual([]);
    probe.placement.position = [-27, 108, 0];
    expect(assemblyReport(withProbe, evaluateCadDocument(withProbe).parts)!.collisions).toMatchObject([
      { parts: ['Leg 2', 'Probe'], volume: 288 },
    ]);
    const pieces = cadPartsToCut(changed, evaluateCadDocument(changed).parts);
    expect(pieces[0]!.part.holes).toHaveLength(1);
    expect(polygonArea(pieces[0]!.part.holes[0]!)).toBeCloseTo(-100, 9);
  });

  it('retains physical identities, names, suppression, other copies and cut references when the count grows', () => {
    let document = source();
    document.parts[0]!.copies = [{ id: 'manual', name: 'Spare' }];
    document = pattern(document, 3);
    const part = document.parts[0]!;
    const first = part.copies![1]!.id;
    const second = part.copies![2]!.id;
    document = renamePartCopy(document, part.id, second, 'Back leg');
    document.parts[0]!.copies![1]!.suppressed = true;
    const tool = cadPartReference(part.id, second);
    document.partCuts = [{ id: 'joint', tools: [tool], targets: [part.id], clearance: 0 }];
    document = pattern(document, 4);
    expect(document.parts[0]!.copies!.map(copy => copy.id)).toEqual(['manual', first, second, `${part.pattern!.id}:3`]);
    expect(document.parts[0]!.copies![1]).toMatchObject({ id: first, suppressed: true });
    expect(document.parts[0]!.copies![2]).toMatchObject({ id: second, name: 'Back leg' });
    expect(document.partCuts![0]!.tools).toEqual([tool]);
    expect(activeDesign(document).parts[0]!.copies!.map(copy => copy.id)).toEqual(['manual', second, `${part.pattern!.id}:3`]);
    document.parts[0]!.pattern!.suppressed = true;
    expect(activeDesign(document).parts[0]!.copies!.map(copy => copy.id)).toEqual(['manual']);
    delete document.parts[0]!.pattern!.suppressed;
    expect(resolvePartPatterns(document).parts[0]!.copies![1]).toMatchObject({ id: first, suppressed: true });
  });

  it('cuts with one exact rotated copy and retains its physical reference through growth and reload', async () => {
    const document = pattern(source());
    const sourceId = document.parts[0]!.id;
    const selectedCopyId = document.parts[0]!.copies![1]!.id;
    const base = createPlateDocument({ width: 300, height: 300, thickness: 18 }).parts[0]!;
    base.name = 'Base';
    base.placement = { position: [-150, -150, 0], rotation: [0, 0, 0, 1] };
    const tool = cadPartReference(sourceId, selectedCopyId);
    document.parts.push(base);
    document.partCuts = [{ id: 'housing', tools: [tool], targets: [base.id], clearance: 0 }];
    const first = await solveCadDocument(document);
    const firstCut = first.parts.find(part => part.partId === base.id)!.cuts!;
    expect(firstCut).toHaveLength(1);
    expect(Math.abs(polygonArea(firstCut[0]!.outline))).toBeCloseTo(600, 9);
    expect(firstCut[0]!.outline.map(point => point.x).sort((a, b) => a - b)).toEqual([30, 30, 50, 50]);
    expect(firstCut[0]!.outline.map(point => point.y).sort((a, b) => a - b)).toEqual([120, 120, 150, 150]);
    const expanded = pattern(first.document, 8);
    const reloaded = parseCadDocument(JSON.parse(JSON.stringify(expanded)));
    const grown = await solveCadDocument(reloaded);
    expect(grown.diagnostics.filter(diagnostic => diagnostic.severity === 'error')).toEqual([]);
    expect(grown.document.partCuts![0]!.tools).toEqual([tool]);
    expect(grown.document.parts[0]!.copies![1]!.id).toBe(selectedCopyId);
    const cuts = grown.parts.find(part => part.partId === base.id)!.cuts!;
    expect(cuts).toHaveLength(1);
    expect(Math.abs(polygonArea(cuts[0]!.outline))).toBeCloseTo(600, 6);
    // The same physical slot moves from the half turn to the quarter turn as the ring grows from four to eight.
    expect(cuts[0]!.outline.map(point => point.x).sort((a, b) => a - b)).toEqual([120, 120, 150, 150]);
    expect(cuts[0]!.outline.map(point => point.y).sort((a, b) => a - b)).toEqual([250, 250, 270, 270]);
    const pieces = cadPartsToCut(grown.document, grown.parts);
    expect(pieces.find(piece => piece.part.partId === sourceId)!.names).toHaveLength(8);
    expect(pieces.find(piece => piece.part.partId === base.id)!.part.cuts).toHaveLength(1);
    // Cut parts still refuses relative angles it cannot machine; a circular tool must not silently cut the family instead.
    const angled = await solveCadDocument(pattern(grown.document, 5));
    expect(angled.parts.find(part => part.partId === base.id)!.cuts).toBeUndefined();
    expect(angled.diagnostics).toContainEqual(
      expect.objectContaining({
        code: 'part-cut-unresolved',
        severity: 'warning',
        message: expect.stringContaining("isn't square"),
      })
    );
  });

  it('regenerates angle and count expressions, rewrites a renamed variable and keeps last valid geometry on errors', () => {
    let document = variable(variable(source(), 'sweep', '180deg'), 'legs', '3');
    document = setPartPattern(document, document.parts[0]!.id, {
      axis: 'x',
      spacing: 100,
      count: 3,
      countExpression: 'legs',
      circular: { ...ring, angle: 180, angleExpression: 'sweep' },
    });
    const variableId = document.variables!.find(v => v.name === 'sweep')!.id;
    document = variable(document, 'arc', '90deg', variableId);
    expect(document.parts[0]!.pattern!.circular).toMatchObject({ angle: 90, angleExpression: 'arc' });
    expect(cadVariableUses(document, 'arc')).toBe(1);
    expect(positions(document)[1]).toEqual([0, 100, 0]);
    document = variable(document, 'legs', '4', document.variables!.find(v => v.name === 'legs')!.id);
    expect(document.parts[0]!.copies).toHaveLength(3);
    document = variable(document, 'arc', '10mm', variableId);
    expect(document.parts[0]!.pattern!.circular!.angle).toBe(90);
    expect(cadVariableProblems(document).some(problem => problem.message.includes('angle'))).toBe(true);
    const loaded = parseCadDocument(JSON.parse(JSON.stringify(document)));
    expect(loaded.parts[0]!.pattern).toEqual(document.parts[0]!.pattern);
  });

  it('rejects malformed saved circular sources without changing legacy linear patterns', () => {
    const document = pattern(source());
    for (const circular of [
      null,
      {},
      { ...ring, origin: [0, 0] },
      { ...ring, origin: [0, Infinity, 0] },
      { ...ring, axis: [0, 0, 0] },
      { ...ring, axis: [0, NaN, 1] },
      { ...ring, angle: '360' },
      { ...ring, angleExpression: 2 },
      { ...ring, equalSpacing: 'yes' },
      { ...ring, opposite: 1 },
    ]) {
      const broken = structuredClone(document);
      Object.assign(broken.parts[0]!.pattern!, { circular });
      expect(() => parseCadDocument(broken)).toThrow(/circular part pattern/);
    }
    const legacy = source();
    const linear = setPartPattern(legacy, legacy.parts[0]!.id, { axis: 'y', count: 3, spacing: 40 });
    expect(parseCadDocument(JSON.parse(JSON.stringify(linear)))).toEqual(linear);
  });
});
