import { expect, it } from 'vitest';
import {
  addPartCut,
  addRectangle,
  cadVariableProblems,
  createCadDocument,
  createCadPart,
  evaluateCadDocument,
  orderedCadDocument,
  parseCadDocument,
  setCadVariable,
  smallestCornerRelief,
  updatePartCut,
  type CadDocument,
} from './index';

function source() {
  const seat = createCadPart('Seat', 18);
  seat.sketch = addRectangle(seat.sketch, { x: 0, y: 0, width: 240, height: 200, dimensioned: true, positioned: true });
  seat.sketch = addRectangle(seat.sketch, { x: 190, y: 140, width: 20, height: 20, dimensioned: true, positioned: true });
  seat.cornerRelief = { diameter: 6 };
  seat.placement = { position: [0, 0, 0], rotation: [0, 0, 0, 1] };
  const tools = [
    [20, 40],
    [110, 40],
    [70, 110],
  ].map(([x, y], index) => {
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
  Math.min(...outline.map(p => p.x)),
  Math.min(...outline.map(p => p.y)),
  Math.max(...outline.map(p => p.x)),
  Math.max(...outline.map(p => p.y)),
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

it.each([false, true])('keeps an ordered physical-copy design valid with a relief override (ordered first: %s)', orderedFirst => {
  const { document } = source();
  const relieve = (value: CadDocument) => updatePartCut(value, value.partCuts![1]!.id, { cornerRelief: { diameter: 4 } });
  const changed = orderedFirst ? relieve(orderedCadDocument(document)) : orderedCadDocument(relieve(document));
  expect(changed.version).toBe(5);
  expect(changed.operationOrder).toEqual(document.partCuts!.map(step => step.id));
  const evaluated = evaluateCadDocument(changed);
  expect(evaluated.diagnostics).toEqual([]);
  expect(evaluated.parts[0]!.cuts![1]!.outline.length).toBeGreaterThan(4);
  expect(evaluateCadDocument(parseCadDocument(JSON.parse(JSON.stringify(changed))))).toEqual(evaluated);
  const inherited = updatePartCut(changed, changed.partCuts![1]!.id, { cornerRelief: undefined });
  expect(inherited.version).toBe(4);
  expect(evaluateCadDocument(parseCadDocument(JSON.parse(JSON.stringify(inherited)))).diagnostics).toEqual([]);
});

it('resolves, renames and tracks a step diameter variable without changing clearance or source relief', () => {
  const original = source().document;
  let document: CadDocument = { ...original, variables: [{ id: 'cutter', name: 'cutter', expression: '6 mm' }] };
  document = updatePartCut(document, document.partCuts![0]!.id, { cornerRelief: { diameter: 6, diameterExpression: 'cutter' } });
  const changed = setCadVariable(document, { id: 'cutter', name: 'selectedCutter', expression: '8 mm' });
  if ('error' in changed) throw new Error(changed.error);
  expect(changed.document.partCuts![0]!.cornerRelief).toEqual({ diameter: 8, diameterExpression: 'selectedCutter' });
  expect(changed.document.partCuts![0]!.clearance).toBe(0);
  expect(changed.document.parts).toEqual(document.parts);
  expect(parseCadDocument(JSON.parse(JSON.stringify(changed.document))).version).toBe(5);
});

it.each(['constructions'])('refuses unsupported %s even combined with its own relief', key => {
  const document = source().document;
  const relieved = updatePartCut(document, document.partCuts![0]!.id, { cornerRelief: null });
  const combined = { ...relieved, [key]: [] };
  expect(() => parseCadDocument(combined)).toThrow(/support/i);
  expect(evaluateCadDocument(combined as CadDocument).diagnostics).toContainEqual(
    expect.objectContaining({ severity: 'error', code: 'invalid-document' })
  );
});

it.each([false, true, 0, -1, 'off', {}, { diameter: 0 }, { diameter: Infinity }, { diameter: 6, kind: 'tbone' }])(
  'refuses malformed relief %j before evaluating geometry',
  relief => {
    const document = source().document;
    const input = {
      ...document,
      version: 5,
      partCuts: document.partCuts!.map((step, i) => (i ? step : { ...step, cornerRelief: relief })),
    };
    expect(() => parseCadDocument(input)).toThrow();
    expect(evaluateCadDocument(input as CadDocument).diagnostics).toContainEqual(expect.objectContaining({ severity: 'error' }));
  }
);

it('says on the joined parts when a step diameter variable gives no usable cutter', () => {
  const original = source().document;
  let document: CadDocument = { ...original, variables: [{ id: 'cutter', name: 'cutter', expression: '6 mm' }] };
  document = updatePartCut(document, document.partCuts![0]!.id, { cornerRelief: { diameter: 6, diameterExpression: 'cutter' } });
  const changed = setCadVariable(document, { id: 'cutter', name: 'cutter', expression: '0 mm' });
  if ('error' in changed) throw new Error(changed.error);
  const problems = cadVariableProblems(changed.document).filter(problem => problem.message.startsWith('Cutter diameter cutter'));
  expect(problems.length).toBeGreaterThan(0);
  expect(problems[0]!.message).toMatch(/= 0 mm in Cut .*: a cutter diameter must be greater than zero\./);
});

it('takes the smallest relief from the part and its active steps only', () => {
  const { document, seat } = source();
  const [first, second] = document.partCuts!;
  let changed = updatePartCut(document, first!.id, { cornerRelief: { diameter: 4 } });
  changed = updatePartCut(changed, second!.id, { cornerRelief: { diameter: 3 } });
  expect(smallestCornerRelief(changed, seat.id)).toBe(3);
  const folded: CadDocument = {
    ...changed,
    version: 5,
    folders: [{ id: 'f', name: 'Off', partIds: [], partCutIds: [second!.id], suppressed: true }],
  };
  expect(smallestCornerRelief(folded, seat.id)).toBe(4);
  expect(
    smallestCornerRelief({ ...changed, partCuts: changed.partCuts!.map(step => ({ ...step, suppressed: true as const })) }, seat.id)
  ).toBe(6);
  expect(smallestCornerRelief(changed, changed.parts[1]!.id)).toBeUndefined();
  // A step whose tool is switched off cuts nothing, so its relief doesn't count either.
  const toolOff: CadDocument = {
    ...changed,
    parts: changed.parts.map(part => (second!.tools.includes(part.id) ? { ...part, suppressed: true as const } : part)),
  };
  expect(smallestCornerRelief(toolOff, seat.id)).toBe(4);
});

function seatWith(tenons: [number, number][], relief = 6) {
  const seat = createCadPart('Seat', 18);
  seat.sketch = addRectangle(seat.sketch, { x: 0, y: 0, width: 240, height: 200, dimensioned: true, positioned: true });
  seat.placement = { position: [0, 0, 0], rotation: [0, 0, 0, 1] };
  const tools = tenons.map(([x, y], index) => {
    const tool = createCadPart(`Tenon ${index + 1}`, 18);
    tool.sketch = addRectangle(tool.sketch, { x, y, width: 40, height: 18, dimensioned: true, positioned: true });
    tool.placement = structuredClone(seat.placement);
    return tool;
  });
  let document = { ...createCadDocument('Bones near edges'), parts: [seat, ...tools] };
  for (const tool of tools) document = addPartCut(document, [tool.id], [seat.id], { value: 0 }).document;
  for (const step of document.partCuts!) document = updatePartCut(document, step.id, { cornerRelief: { diameter: relief } });
  return evaluateCadDocument(document);
}
const skippedWarnings = (evaluated: ReturnType<typeof evaluateCadDocument>) =>
  evaluated.diagnostics.filter(d => d.code === 'corner-relief-skipped');

it('keeps a step corner square, and says where, when its bone would break out of the part edge', () => {
  // The opening's left wall is 0.5 mm from the seat edge; a 6 mm bone bulges about 0.9 mm past it.
  const evaluated = seatWith([[0.5, 60]]);
  const cut = evaluated.parts[0]!.cuts![0]!;
  expect(cut.outline.every(p => p.x >= 0)).toBe(true);
  const [warning] = skippedWarnings(evaluated);
  expect(warning?.message).toMatch(/^2 of the corners Tenon 1 cuts in Seat stay square/);
  expect(warning?.points).toEqual(expect.arrayContaining([expect.objectContaining({ x: 0.5 })]));
  expect(warning?.points).toHaveLength(2);
  // With room to spare every corner gets its bone.
  expect(skippedWarnings(seatWith([[20, 60]]))).toEqual([]);
});

it('keeps step corners square where their bones would break into a neighbouring opening', () => {
  // Two mortises 0.5 mm apart: the second one's bones toward the first would cut through the web.
  const evaluated = seatWith([
    [20, 60],
    [60.5, 60],
  ]);
  const [first, second] = evaluated.parts[0]!.cuts!;
  // Each keeps the bones on its far side and leaves the two facing corners square.
  expect(first!.outline.length).toBeGreaterThan(4);
  expect(second!.outline.length).toBeGreaterThan(4);
  expect(Math.max(...first!.outline.map(p => p.x))).toBeCloseTo(60, 6);
  expect(Math.min(...second!.outline.map(p => p.x))).toBeCloseTo(60.5, 6);
  const warnings = skippedWarnings(evaluated);
  expect(warnings.map(w => w.message.slice(0, 40))).toEqual([
    '2 of the corners Tenon 2 cuts in Seat st',
    '2 of the corners Tenon 1 cuts in Seat st',
  ]);
  expect(warnings[0]!.points!.every(p => p.x === 60.5)).toBe(true);
  expect(warnings[1]!.points!.every(p => p.x === 60)).toBe(true);
  expect(
    skippedWarnings(
      seatWith([
        [20, 60],
        [80, 60],
      ])
    )
  ).toEqual([]);
});
