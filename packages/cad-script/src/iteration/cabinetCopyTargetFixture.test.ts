import { addPartCut, cadPartReference, evaluatedPartCopy, solveCadDocument, updatePartCut, type CadDocument } from '@wbcnc/cad';
import { expect, it } from 'vitest';
import { axisMaterial } from './axisMaterial';
import { loadWoodworkingSource, sourcePart } from './woodworkingChecks';

async function solve(document: CadDocument) {
  const before = JSON.stringify(document);
  const result = await solveCadDocument(document);
  expect(result.status, JSON.stringify(result.diagnostics)).toBe('solved');
  expect(result.diagnostics).toEqual([]);
  expect(JSON.stringify(document)).toBe(before);
  return result;
}

it('uses an all-shelf crossing tool so the complete cabinet UI fixture distinguishes exact and family targets', async () => {
  const baseline = await solve(await loadWoodworkingSource('cabinet-copy-target-start'));
  expect(baseline.document.parts.map(part => part.name)).toEqual(['Side', 'Bottom', 'Top', 'Back', 'Shelf', 'Cable chase']);
  const shelf = sourcePart(baseline.document, 'Shelf');
  expect(shelf.copies).toHaveLength(2);
  const tool = sourcePart(baseline.document, 'Cable chase');
  const evaluatedTool = baseline.parts.find(part => part.partId === tool.id)!;
  const toolMaterial = axisMaterial(evaluatedTool, tool.placement!);
  const third = cadPartReference(shelf.id, shelf.copies![1]!.id);
  const exactStep = addPartCut(baseline.document, [tool.id], [third], { value: 0 });
  const exact = await solve(updatePartCut(exactStep.document, exactStep.id, { consumeTools: true }));
  const familyStep = addPartCut(baseline.document, [tool.id], [shelf.id], { value: 0 });
  const family = await solve(updatePartCut(familyStep.document, familyStep.id, { consumeTools: true }));
  const stock = 762 * 284 * 18;
  const notch = 20 * 30 * 18;

  // Authored 800x900x300 cabinet,18 mm stock: shelf bases220.5,441,661.5.
  // The upright tool occupies X100..120,Y-10..30,Z0..900 and reaches every shelf.
  for (const [index, height] of [229.5, 450, 670.5].entries()) {
    const insideNotch = [110, 15, height];
    const clearOfTool = [110, 45, height];
    expect(toolMaterial.containsWorld(insideNotch), `tool intersects shelf ${index + 1}`).toBe(true);
    for (const [label, result, removed] of [
      ['uncut', baseline, false],
      ['exact', exact, index === 2],
      ['family', family, true],
    ] as const) {
      const source = sourcePart(result.document, 'Shelf');
      const part = result.parts.find(part => part.partId === source.id)!;
      const copy = index ? source.copies![index - 1]! : null;
      const material = axisMaterial(copy ? evaluatedPartCopy(part, copy) : part, (copy ?? source).placement!);
      expect(material.volume, `${label} shelf ${index + 1} analytic occupied volume`).toBeCloseTo(stock - (removed ? notch : 0), 5);
      expect(material.containsWorld(insideNotch), `${label} shelf ${index + 1} notch probe`).toBe(!removed);
      expect(material.containsWorld(clearOfTool), `${label} shelf ${index + 1} retained probe`).toBe(true);
      expect(material.components).toBe(1);
    }
  }
  // The explicit scope changes no other cabinet board's evaluated material.
  for (const original of baseline.parts.filter(part => part.partId !== shelf.id)) {
    expect(exact.parts.find(part => part.partId === original.partId)).toEqual(original);
    expect(family.parts.find(part => part.partId === original.partId)).toEqual(original);
  }
  expect(exact.document.partCuts!.find(step => step.id === exactStep.id)!.targets).toEqual([third]);
  expect(family.document.partCuts!.find(step => step.id === familyStep.id)!.targets).toEqual([shelf.id]);
});
