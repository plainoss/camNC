import { describe, expect, it } from 'vitest';
import {
  addPartCut,
  addRectangle,
  cadPartReference,
  cadPartsToCut,
  cadStepReport,
  createCadDocument,
  createCadPart,
  designSteps,
  evaluateCadPart,
  evaluatedPartCopy,
  parseCadDocument,
  setPartPattern,
  solveCadDocument,
  type CadDocument,
} from './index';
import { withPartCuts } from './cutParts';

function shelves() {
  const shelf = createCadPart('Shelf', 18),
    chase = createCadPart('Cable chase', 300);
  shelf.sketch = addRectangle(shelf.sketch, { x: 0, y: 0, width: 300, height: 200, dimensioned: true, positioned: true });
  shelf.placement = { position: [0, 0, 0], rotation: [0, 0, 0, 1] };
  chase.sketch = addRectangle(chase.sketch, { x: 40, y: -10, width: 20, height: 40, dimensioned: true, positioned: true });
  chase.placement = { position: [0, 0, 0], rotation: [0, 0, 0, 1] };
  return setPartPattern({ ...createCadDocument(), parts: [shelf, chase] }, shelf.id, { axis: 'z', count: 3, spacing: 100 });
}

const targetCut = (document: CadDocument, copyId: string) =>
  addPartCut(document, [document.parts[1]!.id], [cadPartReference(document.parts[0]!.id, copyId)], { value: 0 }).document;

describe('Cut parts targets one physical copy', () => {
  it('cuts only the saved slot, including the assembly projection, feature label and CAM handoff', async () => {
    let document = shelves();
    const sourceId = document.parts[0]!.id,
      copyId = document.parts[0]!.copies![0]!.id,
      sibling = document.parts[0]!.copies![1]!;
    document = targetCut(document, copyId);
    const solved = await solveCadDocument(document);
    expect(solved.status, JSON.stringify(solved.diagnostics)).toBe('solved');
    expect(solved.diagnostics).toEqual([]);
    const shelf = solved.parts[0]!;
    expect(shelf.cuts ?? []).toEqual([]);
    expect(evaluatedPartCopy(shelf, sibling).cuts ?? []).toEqual([]);
    expect(shelf.copyCuts?.[copyId]).toHaveLength(1);
    expect(shelf.copyCuts![copyId]![0]).toMatchObject({ through: true, to: 18, opening: { x0: 40, y0: 0, x1: 60, y1: 30 } });
    expect(withPartCuts(solved.document, evaluateCadPart(solved.document.parts[0]!).part!)).toEqual(shelf);
    expect(cadPartsToCut(solved.document, solved.parts).map(group => group.names)).toEqual([
      ['Shelf', 'Shelf 3'],
      ['Shelf 2'],
      ['Cable chase'],
    ]);
    const step = designSteps(solved.document).find(step => step.partCutId)!;
    expect(step).toMatchObject({ label: 'Cut Shelf 2 with Cable chase', partId: sourceId, copyId });
    const report = cadStepReport(solved.document, solved.parts).find(step => step.kind === 'partCut');
    expect(report).toMatchObject({ targets: ['Shelf 2'], cuts: [{ target: 'Shelf 2', width: 20, length: 30, depth: 18 }] });
    expect(parseCadDocument(JSON.parse(JSON.stringify(solved.document))).partCuts).toEqual(document.partCuts);
  });

  it('keeps a missing slot unresolved through reload and reapplies only when that slot returns', async () => {
    let document = shelves();
    const sourceId = document.parts[0]!.id,
      copyId = document.parts[0]!.copies![1]!.id;
    document = targetCut(document, copyId);
    const reference = document.partCuts![0]!.targets[0]!;
    document = setPartPattern(document, sourceId, { axis: 'z', count: 2, spacing: 100 });
    const absent = await solveCadDocument(parseCadDocument(JSON.parse(JSON.stringify(document))));
    expect(absent.status).toBe('solved');
    expect(absent.document.partCuts![0]!.targets).toEqual([reference]);
    expect(absent.diagnostics).toMatchObject([{ code: 'part-cut-target-missing', severity: 'warning' }]);
    expect(absent.parts[0]!.cuts ?? []).toEqual([]);
    expect(absent.parts[0]!.copyCuts).toBeUndefined();
    document = setPartPattern(absent.document, sourceId, { axis: 'z', count: 3, spacing: 100 });
    const restored = await solveCadDocument(parseCadDocument(JSON.parse(JSON.stringify(document))));
    expect(restored.diagnostics).toEqual([]);
    expect(restored.document.parts[0]!.copies![1]!.id).toBe(copyId);
    expect(restored.document.partCuts![0]!.targets).toEqual([reference]);
    expect(restored.parts[0]!.cuts ?? []).toEqual([]);
    expect(restored.parts[0]!.copyCuts?.[copyId]).toHaveLength(1);
  });

  it('applies a family and an overlapping exact target once per physical instance', async () => {
    const document = shelves(),
      source = document.parts[0]!,
      copyId = source.copies![0]!.id;
    document.partCuts = [
      { id: 'notch', tools: [document.parts[1]!.id], targets: [cadPartReference(source.id, copyId), source.id, source.id], clearance: 0 },
    ];
    const solved = await solveCadDocument(document);
    expect(solved.diagnostics).toEqual([]);
    expect(solved.parts[0]!.cuts).toHaveLength(1);
    for (const copy of solved.document.parts[0]!.copies!) expect(evaluatedPartCopy(solved.parts[0]!, copy).cuts).toHaveLength(1);
  });

  it('does not bypass the established same-family self-cut guard with an exact target string', async () => {
    const document = shelves(),
      source = document.parts[0]!;
    document.partCuts = [{ id: 'self', tools: [source.id], targets: [cadPartReference(source.id, source.copies![0]!.id)], clearance: 0 }];
    const solved = await solveCadDocument(document);
    expect(solved.parts[0]!.cuts ?? []).toEqual([]);
    expect(solved.parts[0]!.copyCuts).toBeUndefined();
    expect(solved.diagnostics).toHaveLength(1);
  });

  it('keeps mirrored target cuts in source coordinates and leaves the source uncut', async () => {
    let document = shelves();
    const source = document.parts[0]!;
    delete source.pattern;
    source.copies = [{ id: 'mirror:slot', mirrored: true, placement: { position: [300, 0, 100], rotation: [0, 0, 0, 1] } }];
    document = targetCut(document, 'mirror:slot');
    const solved = await solveCadDocument(document);
    expect(solved.diagnostics).toEqual([]);
    expect(solved.parts[0]!.cuts ?? []).toEqual([]);
    const copy = evaluatedPartCopy(solved.parts[0]!, solved.document.parts[0]!.copies![0]!);
    expect(copy.cuts).toHaveLength(1);
    // The mirrored physical outline is -300..0 in its local X frame: world40..60 becomes local-260..-240.
    expect(copy.cuts![0]!.opening).toEqual({ x0: -260, y0: 0, x1: -240, y1: 30 });
    expect(withPartCuts(solved.document, evaluateCadPart(solved.document.parts[0]!).part!)).toEqual(solved.parts[0]);
  });

  it.each(['half', { fingers: 3 }] as const)('explicitly refuses the unsupported exact-target split mode %j', async split => {
    const document = shelves(),
      source = document.parts[0]!;
    document.partCuts = [
      { id: 'split', tools: [document.parts[1]!.id], targets: [cadPartReference(source.id, source.copies![0]!.id)], clearance: 0, split },
    ];
    const solved = await solveCadDocument(document);
    expect(solved.diagnostics).toMatchObject([{ code: 'part-cut-copy-target-split', severity: 'warning' }]);
    expect(solved.parts.every(part => !part.cuts?.length && !part.copyCuts)).toBe(true);
  });

  it('reports a suppressed target copy as missing without using its family', async () => {
    let document = shelves();
    const source = document.parts[0]!,
      copy = source.copies![0]!;
    copy.suppressed = true;
    document = targetCut(document, copy.id);
    const solved = await solveCadDocument(document);
    expect(solved.diagnostics).toMatchObject([{ code: 'part-cut-target-missing' }]);
    expect(solved.parts[0]!.cuts ?? []).toEqual([]);
    expect(solved.parts[0]!.copyCuts).toBeUndefined();
    expect(solved.document.partCuts![0]!.targets).toEqual([cadPartReference(source.id, copy.id)]);
  });
});
