import { act, cleanup, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react';
import { createPlateDocument } from '@wbcnc/cad';
import { afterEach, expect, it, vi } from 'vitest';
import { ModelViewport } from '@/cam/model/ModelViewport';
import { assemblyModel, instanceKey } from './assemblyModel';
import { useStudioSection } from './useStudioSection';
import WorkspaceView from './WorkspaceView';

vi.mock('@/cam/model/ModelViewport', () => ({ ModelViewport: vi.fn(() => null) }));
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function fixture() {
  const document = createPlateDocument({ name: 'Block', width: 100, height: 100, thickness: 18 }),
    block = document.parts[0]!;
  block.name = 'Block';
  block.placement = { position: [0, 0, 0], rotation: [0, 0, 0, 1] };
  block.copies = [{ id: 'along', placement: { position: [200, 0, 0], rotation: [0, 0, 0, 1] } }];
  const boss = createPlateDocument({ name: 'Boss', width: 20, height: 20, thickness: 10 }).parts[0]!;
  boss.name = 'Boss';
  boss.addTo = block.id;
  boss.placement = { position: [40, 40, 18], rotation: [0, 0, 0, 1] };
  document.parts.push(boss);
  return { document, block, boss, selectedFace: { partId: boss.id, copyId: 'along', face: 'top' as const } };
}

it('preselects the actual face of an Add body inherited by a parent copy', () => {
  const { document, boss, selectedFace } = fixture(),
    before = JSON.stringify(document),
    model = assemblyModel(document),
    frame = { current: window.document.createElement('div') },
    onViewRequest = vi.fn();
  expect(boss.copies).toBeUndefined();
  expect(model.instances).toContainEqual({ partId: boss.id, copyId: 'along', name: 'Boss · Block 2' });
  const { result } = renderHook(() => useStudioSection(document, model, frame, true, onViewRequest, null, selectedFace));
  act(() => result.current.start());
  expect(result.current.reason).toBeNull();
  expect(result.current.picking).toBe(false);
  expect(result.current.planeId).toBe('picked-face');
  expect(result.current.plane).toEqual({ origin: [240, 40, 28], normal: [0, 0, 1] });
  expect(result.current.planes).toContainEqual({ id: 'picked-face', label: 'Boss · Block 2 face' });
  act(() => result.current.normal());
  expect(onViewRequest).toHaveBeenCalledExactlyOnceWith({ name: 'normal', direction: [0, 0, 1], up: [0, 1, 0] });
  expect(JSON.stringify(document)).toBe(before);
});

it('keeps inherited-copy identity and the source intact through section edit, confirm, recall and turn off', async () => {
  const { document, block, boss, selectedFace } = fixture(),
    before = JSON.stringify(document),
    onSelect = vi.fn(),
    onOpen = vi.fn(),
    onSelectFace = vi.fn();
  render(
    <WorkspaceView
      document={document}
      selectedId={block.id}
      selectedFace={selectedFace}
      onSelect={onSelect}
      onOpen={onOpen}
      onSelectFace={onSelectFace}
    />
  );
  const viewport = () => vi.mocked(ModelViewport).mock.lastCall![0],
    original = viewport().meshes,
    identities = [block.id, `${block.id}/along`, boss.id, `${boss.id}/along`],
    index = identities.indexOf(instanceKey(selectedFace));
  expect(viewport().instanceIds).toEqual(identities);
  const buffers = original.map(mesh => ({ positions: mesh.positions.slice(), indices: mesh.indices.slice() }));
  const maxZ = () => Math.max(...Array.from(viewport().meshes[index]!.indices, at => viewport().meshes[index]!.positions[at * 3 + 2]!));
  fireEvent.click(screen.getByRole('button', { name: 'Section view' }));
  expect(screen.getByRole('combobox', { name: 'Section plane' })).toHaveValue('picked-face');
  expect(viewport().sectionControl).toMatchObject({ origin: [150, 50, 28], normal: [0, 0, 1] });
  fireEvent.change(screen.getByRole('textbox', { name: 'Offset' }), { target: { value: '-5mm' } });
  expect(viewport().sectionControl).toMatchObject({ origin: [150, 50, 23], normal: [0, 0, 1] });
  expect(maxZ()).toBe(23);
  expect(viewport().sectionCaps![index]!.count).toBeGreaterThan(0);
  fireEvent.click(screen.getByRole('button', { name: 'Confirm section view' }));
  await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Section view' })).toBeNull());
  expect(viewport().instanceIds).toEqual(identities);
  expect(viewport().sourceMeshes).toBe(original);
  expect(maxZ()).toBe(23);
  fireEvent.click(screen.getByRole('button', { name: 'Turn off section view' }));
  expect(viewport().meshes).toBe(original);
  fireEvent.click(screen.getByRole('button', { name: 'Section view' }));
  expect(screen.getByRole('textbox', { name: 'Offset' })).toHaveValue('-5mm');
  expect(viewport().sectionControl).toMatchObject({ origin: [150, 50, 23], normal: [0, 0, 1] });
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
  await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Section view' })).toBeNull());
  expect(viewport().meshes).toBe(original);
  expect(viewport().instanceIds).toEqual(identities);
  original.forEach((mesh, at) => {
    expect(mesh.positions).toEqual(buffers[at]!.positions);
    expect(mesh.indices).toEqual(buffers[at]!.indices);
  });
  expect(onSelect).not.toHaveBeenCalled();
  expect(onOpen).not.toHaveBeenCalled();
  expect(onSelectFace).not.toHaveBeenCalled();
  expect(JSON.stringify(document)).toBe(before);
});
