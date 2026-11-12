import { act, cleanup, renderHook } from '@testing-library/react';
import { createCadDocument } from '@wbcnc/cad';
import { afterEach, expect, it } from 'vitest';
import { useStudioMeasure } from './useStudioMeasure';
import type { AssemblyModel } from './assemblyModel';
import type { MeasureEntity } from './measureGeometry';

afterEach(cleanup);
const instance = (name: string) =>
  name.startsWith('Shelf ') ? { partId: 'Shelf', copyId: `pattern:${Number(name.slice(-1)) - 1}`, name } : { partId: name, name };
const model = (names: string[]): AssemblyModel => ({
  meshes: [],
  solids: [],
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

it('invalidates section faces, selected readouts and witnesses when inspection topology changes without a design edit', () => {
  const document = createCadDocument(),
    before = JSON.stringify(document),
    assembly = model(['Panel']);
  const frame = { current: window.document.createElement('div') };
  const initial = { plane: { origin: [0, 0, 9], normal: [0, 0, 1] }, available: true, editing: false };
  const { result, rerender } = renderHook(({ topology }) => useStudioMeasure(document, assembly, frame, true, topology), {
    initialProps: { topology: initial },
  });
  const face = (z: number, normal: 1 | -1): MeasureEntity => ({
    kind: 'face',
    normal: [0, 0, normal],
    triangles: [
      [
        [0, 0, z],
        [100, 0, z],
        [100, 50, z],
      ],
      [
        [0, 0, z],
        [100, 50, z],
        [0, 50, z],
      ],
    ],
  });
  const selectPair = (height: number) =>
    act(() => {
      result.current.pick({ partId: 'Panel', index: 0, additive: true, entity: face(height, 1) });
      result.current.pick({ partId: 'Panel', index: 0, additive: true, entity: face(0, -1) });
      result.current.selectRow('min-distance');
    });
  act(() => result.current.open());
  selectPair(9);
  expect(result.current.selection).toHaveLength(2);
  expect(result.current.result.rows.find(row => row.id === 'min-distance')?.value).toBe(9);
  expect(result.current.witness).toBeDefined();
  expect(result.current.selectedRowId).toBe('min-distance');
  rerender({ topology: initial });
  expect(result.current.selection).toHaveLength(2);
  expect(result.current.witness).toBeDefined();

  const moved = { ...initial, plane: { ...initial.plane, origin: [0, 0, 12] } };
  const empty = () => {
    expect(result.current.selection).toEqual([]);
    expect(result.current.result.rows).toEqual([]);
    expect(result.current.witness).toBeUndefined();
    expect(result.current.selectedRowId).toBeUndefined();
  };
  rerender({ topology: moved });
  empty();
  expect(result.current.expanded).toBe(true);
  selectPair(12);
  expect(result.current.result.rows.find(row => row.id === 'min-distance')?.value).toBe(12);
  expect(result.current.witness).toBeDefined();
  // An unsupported body's visibility can switch between a clipped model and the full-model fallback.
  rerender({ topology: { ...moved, available: false } });
  empty();
  selectPair(18);
  expect(result.current.witness).toBeDefined();
  rerender({ topology: { ...moved, available: false, editing: true } });
  empty();
  expect(JSON.stringify(document)).toBe(before);
  expect(assembly.instances).toEqual([instance('Panel')]);
});
