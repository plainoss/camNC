import { expect, it } from 'vitest';
import { addRectangle, createCadDocument, createCadPart } from './document';
import { designSteps } from './designSteps';
import { evaluateCadDocument } from './features';
import { parseCadDocument } from './parseCadDocument';
import type { CadDocument, CadPart } from './types';

function block(lines: 'front' | 'gone'): CadDocument {
  const part: CadPart = { ...createCadPart('Part 1', 10), id: 'block' };
  part.sketch = addRectangle(part.sketch, { x: 0, y: 0, width: 100, height: 40 });
  const points = new Map(part.sketch.entities.flatMap(e => (e.type === 'point' ? [[e.id, e] as const] : [])));
  const front = part.sketch.entities.find(e => e.type === 'line' && points.get(e.startId)!.y === 0 && points.get(e.endId)!.y === 0)!;
  part.fillets = [
    {
      id: 'c',
      corners: [],
      rims: [{ side: 'top', loops: ['outline'], lines: [lines === 'front' ? front.id : 'no-such-line'] }],
      radius: 3,
      chamfer: true,
    },
  ];
  return { ...createCadDocument(), parts: [part] };
}

it('lists a Chamfer step as Chamfer 1, numbered apart from fillets, with its distance', () => {
  const step = designSteps(block('front')).find(candidate => candidate.id === 'c')!;
  expect(step).toMatchObject({ kind: 'fillet', label: 'Chamfer 1', detail: 'd 3 mm' });
});

it('cuts only the stretch of the outline along the picked line, flat', () => {
  const round = evaluateCadDocument(block('front')).parts[0]!.rounds![0]!;
  expect(round).toMatchObject({ loopId: 'outline', side: 'top', radius: 3, chamfer: true });
  expect(round.edges).toHaveLength(1);
  expect(round.edges![0]!.map(p => p.y)).toEqual([0, 0]);
});

it('leaves the edge sharp and says so when its line is gone', () => {
  const evaluated = evaluateCadDocument(block('gone'));
  expect(evaluated.parts[0]!.rounds).toBeUndefined();
  expect(evaluated.diagnostics.some(d => d.code === 'fillet-round-unresolved')).toBe(true);
});

it('reads a saved chamfer back', () => {
  const document = block('front');
  expect(parseCadDocument(JSON.parse(JSON.stringify(document))).parts[0]!.fillets![0]).toEqual(document.parts[0]!.fillets![0]);
});
