import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { createCadDocument, createPlateDocument, type CadDocument, type CadPart } from '@wbcnc/cad';
import { afterEach, describe, expect, it, vi } from 'vitest';
import WorkspaceView from './WorkspaceView';

afterEach(cleanup);

const panel = (name: string): CadPart => ({ ...createPlateDocument({ width: 200, height: 100 }).parts[0]!, name });
function setup(document: CadDocument, selectedId: string | null = null) {
  const select = vi.fn(),
    open = vi.fn(),
    newPart = vi.fn();
  render(
    <div style={{ height: 500, display: 'flex' }}>
      <WorkspaceView document={document} selectedId={selectedId} onSelect={select} onOpen={open} onNewPart={newPart} />
    </div>
  );
  return { select, open, newPart };
}

describe('the design workspace', () => {
  it('shows every part, and opens the selected one', () => {
    const side = panel('Side');
    const { open } = setup({ ...createCadDocument(), parts: [side, panel('Shelf')] }, side.id);
    expect(screen.getByRole('status').textContent).toBe(
      'Click a part to select it, double-click to work on it. Right-drag to turn, middle-drag to pan.'
    );
    fireEvent.click(screen.getByRole('button', { name: 'Open Side' }));
    expect(open).toHaveBeenCalledWith(side.id);
  });

  it('says which parts take up the same space', () => {
    const at = (z: number) => ({
      position: [0, 0, z] as [number, number, number],
      rotation: [0, 0, 0, 1] as [number, number, number, number],
    });
    setup({
      ...createCadDocument(),
      parts: [
        { ...panel('Bottom'), placement: at(0) },
        { ...panel('Shelf'), placement: at(9) },
      ],
    });
    expect(screen.getByRole('status').textContent).toBe('Bottom and Shelf take up the same space.');
  });

  it('names the parts it can’t show', () => {
    setup({ ...createCadDocument(), parts: [{ ...panel('Broken'), sketch: { id: 's', entities: [], constraints: [] } }, panel('Shelf')] });
    expect(screen.getByRole('status').textContent).toMatch(/^Not shown: Broken/);
  });

  it('starts a new part on a plane, and asks for a face otherwise', () => {
    const { newPart } = setup({ ...createCadDocument(), parts: [panel('Side')] });
    fireEvent.click(screen.getByRole('button', { name: 'New part' }));
    expect(screen.getByRole('status').textContent).toBe('Click the face of a part to draw the new part on, or pick a plane. Esc cancels.');
    fireEvent.click(screen.getByRole('button', { name: 'Right plane' }));
    expect(newPart).toHaveBeenCalledWith({ plane: 'right' });
    expect(screen.queryByRole('button', { name: 'Right plane' })).toBeNull();
  });

  it('starts a step cutting parts once there are two', () => {
    const cut = vi.fn();
    render(
      <div style={{ height: 500, display: 'flex' }}>
        <WorkspaceView
          document={{ ...createCadDocument(), parts: [panel('Side'), panel('Back')] }}
          selectedId={null}
          onSelect={() => {}}
          onOpen={() => {}}
          onCutParts={cut}
        />
      </div>
    );
    fireEvent.click(screen.getByRole('button', { name: 'Cut parts' }));
    expect(cut).toHaveBeenCalled();
  });
});
