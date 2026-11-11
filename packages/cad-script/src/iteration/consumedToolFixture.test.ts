import { assemblyReport, evaluatedPartCopy, solveCadDocument } from '@wbcnc/cad';
import { expect, it } from 'vitest';
import { axisMaterial } from './axisMaterial';
import { loadWoodworkingSource, sourcePart } from './woodworkingChecks';

it('reports only the eight physical pieces of the genuine consumed-tool cabinet without changing its exact notch', async () => {
  const source = await loadWoodworkingSource('cabinet-consumed-cable-chase');
  const before = structuredClone(source);
  const solved = await solveCadDocument(source);
  expect(solved.status).toBe('solved');
  expect(solved.diagnostics).toEqual([]);
  const shelf = sourcePart(solved.document, 'Shelf');
  const tool = sourcePart(solved.document, 'Cable chase');
  const step = solved.document.partCuts!.at(-1)!;
  expect(step.tools).toEqual([tool.id]);
  expect(step.targets).toEqual([`${shelf.id}:${shelf.copies![1]!.id}`]);
  expect(step.consumeTools).toBe(true);
  const report = assemblyReport(solved.document, solved.parts)!;
  expect(report.parts.map(part => part.name)).toEqual(['Side', 'Right side', 'Bottom', 'Top', 'Back', 'Shelf', 'Shelf 2', 'Shelf 3']);
  expect(report.collisions).toEqual([]);
  const evaluated = solved.parts.find(part => part.partId === shelf.id)!;
  for (const [index, height] of [229.5, 450, 670.5].entries()) {
    const copy = index ? shelf.copies![index - 1]! : null;
    const material = axisMaterial(copy ? evaluatedPartCopy(evaluated, copy) : evaluated, (copy ?? shelf).placement!);
    expect(material.volume).toBeCloseTo(762 * 284 * 18 - (index === 2 ? 20 * 30 * 18 : 0), 5);
    expect(material.containsWorld([110, 15, height])).toBe(index !== 2);
    expect(material.containsWorld([110, 45, height])).toBe(true);
    expect(material.components).toBe(1);
  }
  const kept = structuredClone(solved.document);
  delete kept.partCuts!.at(-1)!.consumeTools;
  const keptSolved = await solveCadDocument(kept);
  expect(keptSolved.parts).toEqual(solved.parts);
  expect(keptSolved.document.parts).toEqual(solved.document.parts);
  expect(assemblyReport(keptSolved.document, keptSolved.parts)!.parts).toHaveLength(9);
  expect(assemblyReport(keptSolved.document, keptSolved.parts)!.collisions.map(clash => clash.parts)).toEqual([
    ['Bottom', 'Cable chase'],
    ['Top', 'Cable chase'],
    ['Shelf', 'Cable chase'],
    ['Shelf 2', 'Cable chase'],
  ]);
  expect(source).toEqual(before);
});
