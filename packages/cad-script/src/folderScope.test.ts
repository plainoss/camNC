import { expect, it } from 'vitest';
import { parseCadDocument, setCadVariable, solveCadDocument } from '@wbcnc/cad';
import { editCad } from './edit';
import { cupboard } from './cupboard';

it('scopes same-named boards and expressions to independent folder variables', async () => {
  const result = await editCad(null, d => {
    for (const [name, width, x] of [
      ['First', '100mm', 0],
      ['Second', '200mm', 300],
    ] as const)
      d.folder(name, d => {
        const widthName = d.variable('width', width);
        d.variable(widthName, width);
        const part = d.newPart('Panel');
        part.profile.rect({ at: [0, 0], w: 'width', h: 80 });
        part.place({ at: [x, 0, 0] });
        const copy = part.copy({ at: [x, 0, 30], name: 'Other' });
        expect(d.existingCopy(copy.id.slice(part.id.length + 1)).id).toBe(copy.id);
      });
  });
  expect(result.scriptError).toBeUndefined();
  expect(result.report.errors).toEqual([]);
  expect(result.ok).toBe(true);
  expect(result.document.folders).toHaveLength(2);
  expect(result.document.variables?.map(variable => variable.name)).toEqual(['width', 'width_2']);
  expect(result.report.parts.map(part => part.outline?.size)).toEqual([
    [100, 80],
    [200, 80],
  ]);
  expect(parseCadDocument(JSON.parse(JSON.stringify(result.document)))).toEqual(result.document);
  const original = JSON.stringify(result.document.parts[1]);
  const edited = await editCad(result.document, d => d.existingFolder('First', d => d.variable('width', '120mm')));
  expect(edited.ok).toBe(true);
  expect(edited.report.parts.map(part => part.outline?.size)).toEqual([
    [120, 80],
    [200, 80],
  ]);
  expect(JSON.stringify(edited.document.parts[1])).toBe(original);
  const invalid = {
    ...result.document,
    folders: result.document.folders!.map((folder, index) =>
      index === 0 ? { ...folder, partIds: [...folder.partIds, 'missing-part'] } : folder
    ),
  };
  expect((await solveCadDocument(invalid)).diagnostics).toContainEqual(
    expect.objectContaining({ code: 'invalid-folder', severity: 'error' })
  );
});

it('builds two cupboards without touching the first and keeps pattern IDs through reload/count edits', async () => {
  const first = await editCad(null, cupboard({ shelves: 3 }));
  expect(first.scriptError).toBeUndefined();
  expect(first.report.errors).toEqual([]);
  const next = await editCad(first.document, cupboard({ width: '400mm', height: '900mm', shelves: 4, at: [600, 0, 0] }));
  expect(next.scriptError).toBeUndefined();
  expect(next.report.errors).toEqual([]);
  expect(next.document.folders?.map(folder => folder.name)).toEqual(['Cupboard', 'Cupboard 2']);
  expect(next.document.parts.slice(0, first.document.parts.length)).toEqual(first.document.parts);
  expect(next.report.assembly?.collisions).toEqual([]);
  const reloaded = parseCadDocument(JSON.parse(JSON.stringify(next.document)));
  const secondShelf = reloaded.parts.find(part => part.name === 'Shelf' && reloaded.folders![1].partIds.includes(part.id))!;
  const copyIds = secondShelf.copies!.map(copy => copy.id);
  let document = reloaded;
  for (const count of [2, 4]) {
    const variable = document.variables!.find(
      variable => variable.folderId === document.folders![1].id && variable.name.startsWith('shelves')
    )!;
    const changed = setCadVariable(document, { id: variable.id, name: variable.name, expression: String(count) });
    if ('error' in changed) throw new Error(changed.error);
    document = changed.document;
  }
  expect(document.parts.find(part => part.id === secondShelf.id)?.copies?.map(copy => copy.id)).toEqual(copyIds);
}, 60_000);

it('refuses missing scoped parts instead of finding one in another folder', async () => {
  const first = await editCad(null, d => d.folder('First', d => d.newPart('Panel').profile.rect({ at: [0, 0], w: 100, h: 80 })));
  const refused = await editCad(first.document, d => d.folder('Second', d => d.part('Panel')));
  expect(refused.scriptError).toContain('part in Second');
  expect(refused.document).toEqual(first.document);
});

it('reopens the suffixed variables of a second folder and appends inside its run', async () => {
  const first = await editCad(null, d => {
    d.folder('First', d => {
      d.variable('width', '100mm');
      d.newPart('Panel').profile.rect({ at: [0, 0], w: 'width', h: 80 });
    });
    d.folder('Second', d => {
      d.variable('width', '200mm');
      d.newPart('Panel').profile.rect({ at: [0, 0], w: 'width', h: 80 });
    });
  });
  const changed = await editCad(first.document, d => {
    d.existingFolder('Second', d => d.variable('width', '240mm'));
    d.existingFolder('First', d => d.newPart('Other').profile.rect({ at: [0, 100], w: 'width', h: 20 }));
  });
  expect(changed.scriptError).toBeUndefined();
  expect(changed.report.parts.map(part => part.outline?.size)).toEqual([
    [100, 80],
    [100, 20],
    [240, 80],
  ]);
});

it('refuses mistyped cupboard options and fractional shelf counts before building', () => {
  expect(() => cupboard({ widht: '800mm' } as never)).toThrow('Available options: name, width');
  expect(() => cupboard({ shelves: 2.5 })).toThrow('whole number');
  expect(() => cupboard({ at: [0, NaN, 0] })).toThrow('finite');
});

it('keeps functions and scientific literals distinct from suffixed local variable names', async () => {
  const result = await editCad(null, d => {
    d.variable('floor', '1');
    d.variable('e3', '1');
    d.folder('Scoped', d => {
      d.variable('floor', '2');
      d.variable('e3', '3');
      d.variable('calculated', 'floor(100.8) + floor + #e3');
      d.newPart('Function').profile.rect({ at: [0, 0], w: 'floor(100.8) + floor', h: 80 });
      d.newPart('Exponent').profile.rect({ at: [0, 100], w: '1e3 + e3', h: 80 });
      expect(d.value('calculated')).toBe(105);
    });
  });
  expect(result.scriptError).toBeUndefined();
  expect(result.report.errors).toEqual([]);
  expect(result.report.parts.map(part => part.outline?.size)).toEqual([
    [102, 80],
    [1003, 80],
  ]);
  expect(result.document.variables?.find(variable => variable.name === 'calculated')?.expression).toBe('floor(100.8) + floor_2 + #e3_2');
});
