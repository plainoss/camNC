import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { createCadDocument, createPlateDocument, type CadDocument, type CadPart } from '@wbcnc/cad';
import { afterEach, describe, expect, it, vi } from 'vitest';
import WorkspaceView from './WorkspaceView';

afterEach(cleanup);

const panel = (name: string): CadPart => ({ ...createPlateDocument({ width: 200, height: 100 }).parts[0]!, name });
function setup(document: CadDocument, selectedId: string | null = null) {
  const select = vi.fn(),
    open = vi.fn();
  render(
    <div style={{ height: 500, display: 'flex' }}>
      <WorkspaceView document={document} selectedId={selectedId} onSelect={select} onOpen={open} />
    </div>
  );
  return { select, open };
}

describe('the design workspace', () => {
  it('shows every part, and opens the selected one', () => {
    const side = panel('Side');
    const { open } = setup({ ...createCadDocument(), parts: [side, panel('Shelf')] }, side.id);
    expect(screen.getByRole('status').textContent).toBe('Click a part to select it, double-click to work on it. Drag to orbit.');
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
});
