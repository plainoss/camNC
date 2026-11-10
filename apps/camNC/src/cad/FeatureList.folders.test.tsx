import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import {
  activeDesign,
  createCadDocument,
  createCadFolder,
  createPlateDocument,
  parseCadDocument,
  setCadVariable,
  type CadDocument,
} from '@wbcnc/cad';
import { userEvent } from '@vitest/browser/context';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FeatureList } from './FeatureList';
import { PartsList } from './PartsList';

afterEach(cleanup);
const plate = (name: string) => ({ ...createPlateDocument({ width: 120, height: 80 }).parts[0]!, name });
function cupboard() {
  let document = { ...createCadDocument('Room'), parts: [plate('Side'), plate('Shelf'), plate('Other')] };
  const folder = createCadFolder(document, { id: 'cupboard', name: 'Cupboard', partIds: document.parts.slice(0, 2).map(part => part.id) });
  if ('error' in folder) throw new Error(folder.error);
  document = folder.document;
  const variable = setCadVariable(document, { name: 'width', expression: '600 mm', folderId: 'cupboard' });
  if ('error' in variable) throw new Error(variable.error);
  return variable.document;
}
function setup() {
  let current = cupboard();
  const changes = vi.fn();
  const rolls = vi.fn();
  function Host() {
    const [document, setDocument] = useState(current);
    const [rollback, setRollback] = useState<string | null>(null);
    return (
      <div className="cad-editor">
        <FeatureList
          document={document}
          selectedPartId={document.parts[0]!.id}
          onSelect={() => undefined}
          onAction={() => undefined}
          onRename={() => undefined}
          rollback={rollback}
          onRollTo={id => {
            rolls(id);
            setRollback(id);
          }}
          onChange={next => {
            current = next;
            changes(next);
            setDocument(next);
          }}
        />
      </div>
    );
  }
  render(<Host />);
  return { changes, rolls, document: () => current };
}

describe('folder feature rows', () => {
  it('selects one actual step and keeps folder settings with their contents', async () => {
    setup();
    await userEvent.click(screen.getByRole('button', { name: 'Sketch · Side' }));
    expect(document.querySelectorAll('[aria-current="true"]')).toHaveLength(1);
    await userEvent.click(screen.getByRole('button', { name: /Extrude · Side/ }));
    expect(screen.getByRole('button', { name: /Extrude · Side/ }).getAttribute('aria-current')).toBe('true');
    expect(screen.getByRole('button', { name: 'Sketch · Side' }).getAttribute('aria-current')).toBeNull();
    expect(screen.getByRole('button', { name: '#width = 600 mm' })).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'Collapse Cupboard' }));
    expect(screen.queryByRole('button', { name: 'Sketch · Side' })).toBeNull();
    expect(screen.queryByRole('button', { name: '#width = 600 mm' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Sketch · Other' })).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'Expand Cupboard' }));
    expect(screen.getByRole('button', { name: '#width = 600 mm' })).toBeTruthy();
  });

  it('suppresses and unpacks through the folder menu without rewriting part flags', async () => {
    const ui = setup();
    const source = structuredClone(ui.document().parts);
    fireEvent.contextMenu(screen.getByRole('button', { name: 'Cupboard' }), { clientX: 10, clientY: 10 });
    await userEvent.click(screen.getByRole('menuitem', { name: 'Suppress' }));
    expect(ui.document().folders![0]!.suppressed).toBe(true);
    expect(ui.document().parts).toEqual(source);
    fireEvent.contextMenu(screen.getByRole('button', { name: 'Cupboard' }), { clientX: 10, clientY: 10 });
    await userEvent.click(screen.getByRole('menuitem', { name: 'Unpack folder' }));
    expect(ui.document().folders).toBeUndefined();
    expect(ui.document().variables![0]!.folderId).toBeUndefined();
    expect(ui.document().parts).toEqual(source);
  });

  it('keeps the rollback bar and real-step keyboard progression in a closed folder', async () => {
    const ui = setup();
    fireEvent.contextMenu(screen.getByRole('button', { name: 'Cupboard' }), { clientX: 10, clientY: 10 });
    await userEvent.click(screen.getByRole('menuitem', { name: 'Roll to here' }));
    expect(ui.rolls).toHaveBeenLastCalledWith(`${ui.document().parts[1]!.id}:extrude`);
    await userEvent.click(screen.getByRole('button', { name: 'Collapse Cupboard' }));
    const bar = screen.getByRole('separator', { name: 'Shown through Extrude · Shelf' });
    await userEvent.click(bar);
    await userEvent.keyboard('{ArrowUp}');
    expect(ui.rolls).toHaveBeenLastCalledWith(`${ui.document().parts[1]!.id}:sketch`);
    expect(screen.getByRole('separator', { name: 'Shown through Sketch · Shelf' })).toBeTruthy();
  });

  it('uses the same named folder to group physical parts and their copies', () => {
    const document = cupboard();
    document.parts[0]!.copies = [{ id: 'copy', name: 'Side 2' }];
    const rows = document.parts.flatMap(part => [
      { key: part.id, part, name: part.name },
      ...(part.copies ?? []).map(copy => ({ key: `${part.id}/${copy.id}`, part, name: copy.name! })),
    ]);
    render(
      <PartsList
        rows={rows}
        folders={document.folders}
        hidden={false}
        studio
        selectedKey={undefined}
        hiddenParts={new Set()}
        onToggleHidden={() => undefined}
        trouble={() => null}
        onPick={() => undefined}
        onRename={() => undefined}
      />
    );
    const group = screen.getByRole('list', { name: 'Cupboard parts' });
    expect(within(group).getByRole('button', { name: /^Side 2/ })).toBeTruthy();
    expect(within(group).queryByRole('button', { name: /Other/ })).toBeNull();
  });
  it('rerenders an empty parts list through grouped parts and copies and back without changing hook order', () => {
    const document = cupboard();
    const props = {
      folders: document.folders,
      hidden: false,
      studio: true,
      selectedKey: undefined,
      hiddenParts: new Set<string>(),
      onToggleHidden: () => undefined,
      trouble: () => null,
      onPick: () => undefined,
      onRename: () => undefined,
    };
    const view = render(<PartsList {...props} rows={[]} />);
    view.rerender(<PartsList {...props} rows={document.parts.map(part => ({ key: part.id, part, name: part.name }))} />);
    expect(screen.getByRole('list', { name: 'Cupboard parts' })).toBeTruthy();
    view.rerender(<PartsList {...props} rows={[]} />);
    expect(screen.queryByRole('list', { name: 'Cupboard parts' })).toBeNull();
  });
});

describe('folder plane membership', () => {
  function setupPlanes() {
    let current: CadDocument = {
      ...createCadDocument('Planes'),
      parts: [plate('Shelf'), plate('Other')],
      planes: [
        { id: 'shelf-plane', name: 'Shelf plane', on: { plane: 'top' }, offset: 100 },
        { id: 'other-plane', name: 'Other plane', on: { plane: 'top' }, offset: 200 },
      ],
    };
    current.parts[0]!.drawnOn = { on: { plane: 'top' }, offset: 100, datum: 'shelf-plane' };
    const source = structuredClone(current);
    function Host() {
      const [document, setDocument] = useState(current);
      return (
        <FeatureList
          document={document}
          selectedPartId={null}
          onSelect={() => undefined}
          onAction={() => undefined}
          onRename={() => undefined}
          onChange={next => {
            current = next;
            setDocument(next);
          }}
        />
      );
    }
    render(<Host />);
    return { document: () => current, source };
  }
  it('creates a plane-only folder, groups and collapses the plane, and suppresses its dependants without changing source flags', async () => {
    const ui = setupPlanes();
    await userEvent.click(screen.getByRole('button', { name: 'New folder' }));
    const dialog = screen.getByRole('dialog', { name: 'New folder' });
    await userEvent.fill(within(dialog).getByRole('textbox', { name: 'Name' }), 'Construction planes');
    await userEvent.click(within(dialog).getByRole('checkbox', { name: 'Shelf plane' }));
    await userEvent.click(within(dialog).getByRole('button', { name: 'OK' }));
    await expect.poll(() => ui.document().folders?.[0]?.planeIds).toEqual(['shelf-plane']);
    expect(ui.document().folders![0]!.partIds).toEqual([]);
    expect(parseCadDocument(JSON.parse(JSON.stringify(ui.document())))).toEqual(ui.document());
    expect(ui.document().parts).toEqual(ui.source.parts);
    expect(ui.document().planes).toEqual(ui.source.planes);
    expect(screen.getByRole('button', { name: 'Shelf plane' }).closest('li')!.classList.contains('cad-folder-child')).toBe(true);
    await userEvent.click(screen.getByRole('button', { name: 'Collapse Construction planes' }));
    expect(screen.queryByRole('button', { name: 'Shelf plane' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Other plane' })).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'Expand Construction planes' }));
    fireEvent.contextMenu(screen.getByRole('button', { name: 'Construction planes' }), { clientX: 10, clientY: 10 });
    await userEvent.click(screen.getByRole('menuitem', { name: 'Suppress' }));
    expect(activeDesign(ui.document()).parts[0]!.extrude).toBe(false);
    expect(activeDesign(ui.document()).parts[1]!.extrude).toBeUndefined();
    expect(ui.document().parts).toEqual(ui.source.parts);
    expect(ui.document().planes).toEqual(ui.source.planes);
    expect(screen.getByRole('button', { name: 'Shelf plane' }).closest('li')!.classList.contains('cad-feature-suppressed')).toBe(true);
    fireEvent.contextMenu(screen.getByRole('button', { name: 'Construction planes' }), { clientX: 10, clientY: 10 });
    await userEvent.click(screen.getByRole('menuitem', { name: 'Unsuppress' }));
    expect(activeDesign(ui.document()).parts).toEqual(ui.source.parts);
    await userEvent.click(screen.getByRole('button', { name: 'New folder' }));
    const next = screen.getByRole('dialog', { name: 'New folder' });
    expect(within(next).queryByRole('checkbox', { name: 'Shelf plane' })).toBeNull();
    expect(within(next).getByRole('checkbox', { name: 'Other plane' })).toBeTruthy();
  });
  it('accepts mixed part and plane membership and records planes in source order regardless of click order', async () => {
    const ui = setupPlanes();
    await userEvent.click(screen.getByRole('button', { name: 'New folder' }));
    const dialog = screen.getByRole('dialog', { name: 'New folder' });
    await userEvent.click(within(dialog).getByRole('checkbox', { name: 'Shelf' }));
    await userEvent.click(within(dialog).getByRole('checkbox', { name: 'Other plane' }));
    await userEvent.click(within(dialog).getByRole('checkbox', { name: 'Shelf plane' }));
    await userEvent.click(within(dialog).getByRole('button', { name: 'OK' }));
    await expect.poll(() => ui.document().folders?.[0]?.planeIds).toEqual(['shelf-plane', 'other-plane']);
    expect(ui.document().folders![0]!.partIds).toEqual([ui.source.parts[0]!.id]);
    expect(parseCadDocument(JSON.parse(JSON.stringify(ui.document())))).toEqual(ui.document());
  });
});
