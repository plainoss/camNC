import { createCadDocument } from '@wbcnc/cad';
import { expect, it } from 'vitest';
import { createAssistantScriptSession } from './scriptSession';

it('stores immutable source handles and reconstructs one exact repair without evaluating source', async () => {
  const base = createCadDocument();
  const session = createAssistantScriptSession(base);
  const original = await session.resolve({ source: 'd => { d.part("Plate").thickness(18); }' });
  expect(original.hash).toMatch(/^sha256:[a-f0-9]{64}$/);
  expect(original).toMatchObject({ baseId: base.id, baseRevision: base.revision });
  const repaired = await session.resolve({
    scriptId: original.scriptId,
    expectedHash: original.hash,
    patches: [{ oldText: '.thickness(18)', newText: '.thickness(24)' }],
  });
  expect(repaired.source).toBe('d => { d.part("Plate").thickness(24); }');
  expect(repaired.scriptId).not.toBe(original.scriptId);
  expect(repaired.hash).not.toBe(original.hash);
  expect(session.get(original.scriptId).source).toContain('thickness(18)');
  expect(await session.resolve({ scriptId: repaired.scriptId, expectedHash: repaired.hash })).toBe(repaired);
  expect(Object.isFrozen(repaired)).toBe(true);
  await session.resolve({ source: 'throw new Error("Source resolution must never execute this")' });
});

it('refuses stale or ambiguous repairs atomically and retains the last good source', async () => {
  const session = createAssistantScriptSession(createCadDocument(), { maxScripts: 2 });
  const previous = await session.resolve({ source: 'd => { const a = 18; const b = 18; }' });
  for (const request of [
    { scriptId: previous.scriptId, patches: [{ oldText: '18', newText: '24' }] },
    { scriptId: previous.scriptId, expectedHash: 'stale', patches: [{ oldText: 'const a = 18', newText: 'const a = 24' }] },
    { scriptId: previous.scriptId, expectedHash: previous.hash, patches: [{ oldText: '18', newText: '24' }] },
    { scriptId: previous.scriptId, expectedHash: previous.hash, patches: [{ oldText: 'missing', newText: '' }] },
    { scriptId: previous.scriptId, expectedHash: previous.hash, patches: [{ oldText: '', newText: '' }] },
    { scriptId: '../file' },
  ])
    await expect(session.resolve(request)).rejects.toThrow();
  expect(session.get(previous.scriptId)).toBe(previous);
  const next = await session.resolve({ source: 'd => {}' });
  expect(session.get(next.scriptId)).toBe(next);
  await expect(session.resolve({ source: 'd => { /* third */ }' })).rejects.toThrow(/stored script limit/);
});

it('binds handles to the complete base snapshot including edit-and-undo revision counters', async () => {
  const base = createCadDocument();
  const session = createAssistantScriptSession(base);
  const script = await session.resolve({ source: 'd => {}' });
  expect(session.get(script.scriptId, structuredClone(base))).toBe(script);
  const afterUndo = { ...base, revision: base.revision + 2 };
  expect(() => session.get(script.scriptId, afterUndo)).toThrow(/revision changed/);
  await expect(session.resolve({ source: 'd => {}' }, afterUndo)).rejects.toThrow(/revision changed/);
  expect(() => createAssistantScriptSession(base).get(script.scriptId)).toThrow(/Unknown scriptId/);
  const pending = session.resolve({ source: 'd => { /* revision changed while hashing */ }' });
  base.revision += 1;
  await expect(pending).rejects.toThrow(/revision changed/);
});

it('limits source/patch bytes and refuses mixed requests or non-data patch objects', async () => {
  const session = createAssistantScriptSession(createCadDocument(), { maxSourceBytes: 32, maxPatchBytes: 8, maxPatches: 1 });
  await expect(session.resolve({ source: '🙂'.repeat(9) })).rejects.toThrow(/byte limit/);
  await expect(session.resolve({ source: 'd => {}', recipe: 'cupboard' })).rejects.toThrow(/exactly one/);
  await expect(session.resolve({ source: 'd => {}', path: '/file' })).rejects.toThrow(/Unexpected/);
  const script = await session.resolve({ source: 'd => { let a = 1; }' });
  const reference = { scriptId: script.scriptId, expectedHash: script.hash };
  await expect(session.resolve({ ...reference, patches: [{ oldText: '1', newText: '12345678' }] })).rejects.toThrow(/patch byte/);
  await expect(
    session.resolve({
      ...reference,
      patches: [
        { oldText: '1', newText: '2' },
        { oldText: '2', newText: '3' },
      ],
    })
  ).rejects.toThrow(/between 1 and 1/);
  await expect(
    session.resolve({ ...reference, patches: [Object.assign(Object.create({}), { oldText: '1', newText: '2' })] })
  ).rejects.toThrow(/plain data/);
  const patches = Object.defineProperty([{}], '0', {
    enumerable: true,
    get() {
      throw new Error('must not run');
    },
  });
  await expect(session.resolve({ ...reference, patches })).rejects.toThrow(/JSON data/);
});
