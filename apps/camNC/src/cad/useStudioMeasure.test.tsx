import { act, cleanup, renderHook } from '@testing-library/react';
import { createCadDocument } from '@wbcnc/cad';
import { afterEach, expect, it } from 'vitest';
import { useStudioMeasure } from './useStudioMeasure';
import type { AssemblyModel } from './assemblyModel';

afterEach(cleanup);
const instance = (name: string) =>
  name.startsWith('Shelf ') ? { partId: 'Shelf', copyId: `pattern:${Number(name.slice(-1)) - 1}`, name } : { partId: name, name };
const model = (names: string[]): AssemblyModel => ({
  meshes: [],
  parts: [],
  placements: new Map(),
  problems: [],
  instances: names.map(instance),
});

it('removes hidden copy picks permanently and invalidates all picked topology on a design edit', () => {
  const document = createCadDocument(),
    frame = { current: window.document.createElement('div') };
  const source = { ...document, revision: 1 },
    edited = { ...document, revision: 2 };
  const { result, rerender } = renderHook(({ names, source, enabled }) => useStudioMeasure(source, model(names), frame, enabled), {
    initialProps: { names: ['Side', 'Shelf 2', 'Shelf 3'], source, enabled: true },
  });
  const pick = (index: number, x: number) =>
    act(() => result.current.pick({ partId: '', index, additive: true, entity: { kind: 'vertex', point: [x, 0, 0] } }));
  pick(0, 0);
  pick(1, 100);
  expect(result.current.result.rows.find(row => row.id === 'distance')?.value).toBe(100);
  rerender({ names: ['Side', 'Shelf 3'], source, enabled: true });
  expect(result.current.selection.map(item => item.label)).toEqual(['Side · vertex']);
  pick(1, 200);
  rerender({ names: ['Side', 'Shelf 2', 'Shelf 3'], source, enabled: true });
  expect(result.current.selection.map(item => item.label)).toEqual(['Side · vertex', 'Shelf 3 · vertex']);
  expect(result.current.result.rows.find(row => row.id === 'distance')?.value).toBe(200);
  rerender({ names: ['Side', 'Shelf 2', 'Shelf 3'], source: edited, enabled: true });
  expect(result.current.selection).toEqual([]);
  pick(0, 1);
  act(() => result.current.open());
  rerender({ names: ['Side'], source: edited, enabled: false });
  expect(result.current.selection).toEqual([]);
  expect(result.current.expanded).toBe(false);
  rerender({ names: ['Side'], source: edited, enabled: true });
  expect(result.current.selection).toEqual([]);
  pick(0, 3);
  // A rollback preview has the same persistent ID/revision but a different shown-document topology.
  rerender({ names: ['Side'], source: { ...edited, parts: [] }, enabled: true });
  expect(result.current.selection).toEqual([]);
});
