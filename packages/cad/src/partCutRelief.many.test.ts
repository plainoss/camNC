import { expect, it } from 'vitest';
import { addPartCut, addRectangle, createCadDocument, createCadPart, evaluateCadDocument } from './index';

// Bones are worked out once per target after every step, not again for each opening: 48 mortises used to take about
// 2 s to evaluate, now about 0.15 s. This keeps the result of that one pass covered for a many-mortise part.
it('relieves every one of 48 mortises cut by separate steps, and reports none square', () => {
  const seat = createCadPart('Seat', 18);
  seat.sketch = addRectangle(seat.sketch, { x: 0, y: 0, width: 1200, height: 1200, dimensioned: true, positioned: true });
  seat.placement = { position: [0, 0, 0], rotation: [0, 0, 0, 1] };
  const tools = Array.from({ length: 48 }, (_, i) => {
    const tool = createCadPart(`T${i}`, 18);
    const x = 20 + (i % 8) * 140,
      y = 20 + Math.floor(i / 8) * 150;
    tool.sketch = addRectangle(tool.sketch, { x, y, width: 40, height: 18, dimensioned: true, positioned: true });
    tool.placement = { position: [0, 0, 9], rotation: [0, 0, 0, 1] };
    return tool;
  });
  let document = { ...createCadDocument('Many mortises'), parts: [seat, ...tools] };
  for (const tool of tools) document = addPartCut(document, [tool.id], [seat.id], { value: 0.2 }, undefined, { diameter: 6 }).document;
  const evaluated = evaluateCadDocument(document);
  const cuts = evaluated.parts[0]!.cuts!;
  expect(cuts).toHaveLength(48);
  // Four bones each: the square's 4 corners become 4 arcs.
  expect(cuts.every(cut => cut.outline.length > 4 && cut.relief === 6)).toBe(true);
  expect(evaluated.diagnostics.filter(d => d.code === 'corner-relief-skipped')).toEqual([]);
});
