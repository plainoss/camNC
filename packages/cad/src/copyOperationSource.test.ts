import { expect, it } from 'vitest';
import {
  addPartCopy,
  createPlateDocument,
  parseCadDocument,
  orderedCadDocument,
  evaluateCadDocument,
  type CadDocument,
  setCadVariable,
  cadVariableUses,
  cadVariableProblems,
  createCadFolder,
  deleteCadFolder,
} from './index';

function source(): CadDocument {
  let document = createPlateDocument({ width: 100, height: 60, thickness: 18 });
  const partId = document.parts[0]!.id;
  document.parts[0]!.placement = { position: [0, 0, 0], rotation: [0, 0, 0, 1] };
  const copy = addPartCopy(document, partId, { offset: { position: [200, 0, 0], rotation: [0, 0, 0, 1] } });
  document = orderedCadDocument(copy.document);
  return { ...document, copyTransforms: [{ id: 'operation', partId, copyId: copy.id, by: [10, 20, 30] }], operationOrder: ['operation'] };
}

const malformed: [string, (document: CadDocument) => void][] = [
  [
    'missing order',
    d => {
      delete d.operationOrder;
    },
  ],
  [
    'unknown operation',
    d => {
      d.operationOrder = ['missing'];
    },
  ],
  [
    'duplicate operation',
    d => {
      d.operationOrder = ['operation', 'operation'];
    },
  ],
  [
    'sparse order',
    d => {
      d.operationOrder = Array(1);
    },
  ],
  [
    'nonarray transforms',
    d => {
      Object.assign(d, { copyTransforms: {} });
    },
  ],
  [
    'null transform',
    d => {
      Object.assign(d, { copyTransforms: [null] });
    },
  ],
  [
    'missing transform target',
    d => {
      Object.assign(d.copyTransforms![0]!, { copyId: null });
    },
  ],
  [
    'sparse translation',
    d => {
      d.copyTransforms![0]!.by = Array(3) as [number, number, number];
    },
  ],
  [
    'nonfinite translation',
    d => {
      d.copyTransforms![0]!.by[0] = Infinity;
    },
  ],
  [
    'object translation',
    d => {
      Object.assign(d.copyTransforms![0]!, { by: [{}, 0, 0] });
    },
  ],
  [
    'invalid suppression',
    d => {
      Object.assign(d.copyTransforms![0]!, { suppressed: false });
    },
  ],
  [
    'sparse expressions',
    d => {
      d.copyTransforms![0]!.byExpressions = Array(3) as [null, null, null];
    },
  ],
  [
    'invalid expression',
    d => {
      Object.assign(d.copyTransforms![0]!, { byExpressions: [false, null, null] });
    },
  ],
  [
    'null rotation',
    d => {
      Object.assign(d.copyTransforms![0]!, { turn: null });
    },
  ],
  [
    'overflowing rotation axis',
    d => {
      d.copyTransforms![0]!.turn = { about: [0, 0, 0], axis: [1.7e308, 1.7e308, 1.7e308], degrees: 90 };
    },
  ],
  [
    'zero rotation axis',
    d => {
      d.copyTransforms![0]!.turn = { about: [0, 0, 0], axis: [0, 0, 0], degrees: 90 };
    },
  ],
  [
    'sparse rotation origin',
    d => {
      d.copyTransforms![0]!.turn = { about: Array(3) as [number, number, number], axis: [0, 0, 1], degrees: 90 };
    },
  ],
  [
    'nonfinite rotation angle',
    d => {
      d.copyTransforms![0]!.turn = { about: [0, 0, 0], axis: [0, 0, 1], degrees: NaN };
    },
  ],
  [
    'global ID collision',
    d => {
      d.copyTransforms![0]!.id = d.parts[0]!.id;
      d.operationOrder = [d.parts[0]!.id];
    },
  ],
  [
    'invalid legacy prefix',
    d => {
      d.legacyPartCutIds = ['operation'];
    },
  ],
];

it.each(malformed)('rejects malformed operation source before formatting history: %s', (_name, mutate) => {
  const document = source();
  mutate(document);
  expect(() => parseCadDocument(document)).toThrow(Error);
});

it('keeps absent raw targets valid source records while evaluation reports missing membership', () => {
  const document = source();
  document.copyTransforms![0]!.copyId = 'original-slot-now-absent';
  const loaded = parseCadDocument(document),
    result = evaluateCadDocument(loaded);
  expect(loaded.copyTransforms![0]!.copyId).toBe('original-slot-now-absent');
  expect(result.diagnostics).toContainEqual(expect.objectContaining({ code: 'copy-transform-target-missing' }));
  expect(result.available).not.toContain(`${document.parts[0]!.id}:original-slot-now-absent`);
});

it('resolves typed translation and rotation without changing creation poses or typed source', () => {
  const document = source();
  document.variables = [
    { id: 'shift', name: 'shift', expression: '25mm' },
    { id: 'angle', name: 'angle', expression: '90deg' },
  ];
  const move = document.copyTransforms![0]!;
  move.byExpressions = ['#shift', null, null];
  move.turn = { about: [200, 0, 0], axis: [0, 0, 1], degrees: 0, degreesExpression: '#angle' };
  const before = JSON.stringify(document),
    result = evaluateCadDocument(document);
  expect(result.placements?.[`${move.partId}:${move.copyId}`]?.position).toEqual([225, 20, 30]);
  expect(result.placements?.[`${move.partId}:${move.copyId}`]?.rotation).toEqual([0, 0, Math.SQRT1_2, Math.SQRT1_2]);
  expect(JSON.stringify(document)).toBe(before);
});

it('reports coordinate overflow without returning infinite physical poses', () => {
  const document = source(),
    move = document.copyTransforms![0]!;
  document.parts[0]!.copies![0]!.placement!.position = [1e308, 0, 0];
  move.by = [1e308, 0, 0];
  const result = evaluateCadDocument(document);
  expect(result.parts).toEqual([]);
  expect(result.diagnostics).toContainEqual(expect.objectContaining({ code: 'copy-transform-nonfinite', severity: 'error' }));
});

it('updates and renames operation expressions while keeping variable ownership visible to folder deletion', () => {
  const document = source();
  const grouped = createCadFolder(document, { name: 'Controls', partIds: [] });
  if ('error' in grouped) throw Error(grouped.error);
  const variable = setCadVariable(grouped.document, { name: 'shift', expression: '25mm', folderId: grouped.id });
  if ('error' in variable) throw Error(variable.error);
  const move = variable.document.copyTransforms![0]!;
  move.byExpressions = ['#shift', null, null];
  const renamed = setCadVariable(variable.document, { id: variable.id, name: 'travel', expression: '35mm' });
  if ('error' in renamed) throw Error(renamed.error);
  expect(renamed.document.copyTransforms![0]!.by).toEqual([35, 20, 30]);
  expect(renamed.document.copyTransforms![0]!.byExpressions).toEqual(['#travel', null, null]);
  expect(cadVariableUses(renamed.document, 'shift')).toBe(0);
  expect(cadVariableUses(renamed.document, 'travel')).toBe(1);
  expect(deleteCadFolder(renamed.document, grouped.id)).toHaveProperty('error');
  const invalid = structuredClone(renamed.document);
  invalid.copyTransforms![0]!.byExpressions = ['#missing', null, null];
  expect(cadVariableProblems(invalid)).toContainEqual(expect.objectContaining({ code: 'variable-value', partId: move.partId }));
});
