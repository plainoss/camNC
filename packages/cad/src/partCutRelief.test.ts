import { expect, it } from 'vitest';
import {
  addPartCut, addRectangle, createCadDocument, createCadPart, evaluateCadDocument, parseCadDocument,
  setCadVariable, updatePartCut, type CadDocument,
} from './index';

function source() {
  const seat = createCadPart('Seat', 18);
  seat.sketch = addRectangle(seat.sketch, { x: 0, y: 0, width: 240, height: 200, dimensioned: true, positioned: true });
  seat.sketch = addRectangle(seat.sketch, { x: 190, y: 140, width: 20, height: 20, dimensioned: true, positioned: true });
  seat.cornerRelief = { diameter: 6 };
  seat.placement = { position: [0, 0, 0], rotation: [0, 0, 0, 1] };
  const tools = [[20, 40], [110, 40], [70, 110]].map(([x, y], index) => {
    const tool = createCadPart(`Tenon ${index + 1}`, 18);
    tool.sketch = addRectangle(tool.sketch, { x: x!, y: y!, width: 40, height: 18, dimensioned: true, positioned: true });
    tool.placement = structuredClone(seat.placement);
    return tool;
  });
  let document = { ...createCadDocument('Mixed step-local relief'), parts: [seat, ...tools] };
  for (const tool of tools) document = addPartCut(document, [tool.id], [seat.id], { value: 0 }).document;
  return { document, seat, tools };
}
const cutBounds = (outline: { x: number; y: number }[]) => [
  Math.min(...outline.map(p => p.x)), Math.min(...outline.map(p => p.y)), Math.max(...outline.map(p => p.x)), Math.max(...outline.map(p => p.y)),
];

it('keeps legacy inheritance but applies Off and Dogbone only to their own openings', () => {
  const { document, seat } = source();
  const before = structuredClone(document);
  const legacy = evaluateCadDocument(document).parts[0]!;
  let changed = updatePartCut(document, document.partCuts![1]!.id, { cornerRelief: null });
  changed = updatePartCut(changed, document.partCuts![2]!.id, { cornerRelief: { diameter: 4 } });
  expect(changed.version).toBe(5);
  const evaluated = evaluateCadDocument(changed);
  expect(evaluated.diagnostics).toEqual([]);
  const part = evaluated.parts[0]!;
  expect(part.outline).toEqual(legacy.outline);
  expect(part.holes).toEqual(legacy.holes);
  expect(part.holes[0]!.length).toBeGreaterThan(4);
  expect(part.cuts![0]).toEqual(legacy.cuts![0]);
  expect(part.cuts![1]!.outline).toHaveLength(4);
  expect(cutBounds(part.cuts![1]!.outline)).toEqual([110, 40, 150, 58]);
  expect(part.cuts![2]!.outline.length).toBeGreaterThan(4);
  expect(cutBounds(part.cuts![2]!.outline)[0]).toBeGreaterThan(cutBounds(legacy.cuts![2]!.outline)[0]!);
  expect(changed.parts.find(part => part.id === seat.id)).toEqual(seat);
  expect(document).toEqual(before);
  expect(evaluateCadDocument(parseCadDocument(JSON.parse(JSON.stringify(changed))))).toEqual(evaluated);
  const inherited = updatePartCut(changed, changed.partCuts![1]!.id, { cornerRelief: undefined });
  expect(inherited.partCuts![1]).not.toHaveProperty('cornerRelief');
  expect(evaluateCadDocument(inherited).parts[0]!.cuts![1]).toEqual(legacy.cuts![1]);
});

it('resolves, renames and tracks a step diameter variable without changing clearance or source relief', () => {
  const original = source().document;
  let document = { ...original, variables: [{ id: 'cutter', name: 'cutter', expression: '6 mm' }] };
  document = updatePartCut(document, document.partCuts![0]!.id, { cornerRelief: { diameter: 6, diameterExpression: 'cutter' } });
  const changed = setCadVariable(document, { id: 'cutter', name: 'selectedCutter', expression: '8 mm' });
  if ('error' in changed) throw new Error(changed.error);
  expect(changed.document.partCuts![0]!.cornerRelief).toEqual({ diameter: 8, diameterExpression: 'selectedCutter' });
  expect(changed.document.partCuts![0]!.clearance).toBe(0);
  expect(changed.document.parts).toEqual(document.parts);
  expect(parseCadDocument(JSON.parse(JSON.stringify(changed.document))).version).toBe(5);
});

it.each(['operationOrder', 'copyTransforms', 'legacyPartCutIds', 'constructions'])('refuses unsupported %s even combined with its own relief', key => {
  const document = source().document;
  const relieved = updatePartCut(document, document.partCuts![0]!.id, { cornerRelief: null });
  const combined = { ...relieved, [key]: [] };
  expect(() => parseCadDocument(combined)).toThrow(/support/i);
  expect(evaluateCadDocument(combined as CadDocument).diagnostics).toContainEqual(expect.objectContaining({ severity: 'error', code: 'invalid-document' }));
});

it.each([false, true, 0, -1, 'off', {}, { diameter: 0 }, { diameter: Infinity }, { diameter: 6, kind: 'tbone' }])('refuses malformed relief %j before evaluating geometry', relief => {
  const document = source().document;
  const input = { ...document, version: 5, partCuts: document.partCuts!.map((step, i) => i ? step : { ...step, cornerRelief: relief }) };
  expect(() => parseCadDocument(input)).toThrow();
  expect(evaluateCadDocument(input as CadDocument).diagnostics).toContainEqual(expect.objectContaining({ severity: 'error' }));
});
