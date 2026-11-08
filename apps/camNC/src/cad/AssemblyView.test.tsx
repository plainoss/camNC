import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { createCadDocument, createPlateDocument, type CadDocument, type CadPart } from '@wbcnc/cad';
import { afterEach, describe, expect, it, vi } from 'vitest';
import AssemblyView from './AssemblyView';

afterEach(cleanup);

const panel = (name: string) => ({ ...createPlateDocument({ width: 200, height: 100 }).parts[0]!, name });
function setup(document: CadDocument, selectedId: string | null = null) {
  const place = vi.fn(),
    select = vi.fn();
  render(
    <div style={{ height: 500, display: 'flex' }}>
      <AssemblyView document={document} selectedId={selectedId} onSelect={select} onPlace={place} />
    </div>
  );
  return { place, select };
}

describe('the assembly view', () => {
  it('needs two parts before one can be put against another', () => {
    setup({ ...createCadDocument(), parts: [panel('Side')] });
    expect((screen.getByRole('button', { name: 'Put against…' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('walks through choosing the two faces, and Esc backs out', () => {
    setup({ ...createCadDocument(), parts: [panel('Side'), panel('Shelf')] });
    fireEvent.click(screen.getByRole('button', { name: 'Put against…' }));
    expect(screen.getByRole('status').textContent).toBe('Click the face of the part to move. Esc cancels.');
    fireEvent.keyDown(screen.getByTestId('assembly-3d'), { key: 'Escape' });
    expect(screen.getByRole('status').textContent).toBe('Click a part to select it. Drag to orbit.');
  });

  it('can’t place parts laid flat, and says what that view shows', () => {
    setup({ ...createCadDocument(), parts: [panel('Side'), panel('Shelf')] });
    fireEvent.click(screen.getByRole('button', { name: 'Laid flat' }));
    expect((screen.getByRole('button', { name: 'Put against…' }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByRole('status').textContent).toMatch(/machined side faces up/);
  });

  it('lays a placed part out with the others again', () => {
    const side: CadPart = { ...panel('Side'), placement: { position: [0, 0, 50], rotation: [0, 0, 0, 1] } };
    const { place } = setup({ ...createCadDocument(), parts: [side, panel('Shelf')] }, side.id);
    fireEvent.click(screen.getByRole('button', { name: 'Lay out again' }));
    expect(place).toHaveBeenCalledWith([{ partId: side.id, placement: undefined }]);
  });

  it('names the parts it can’t show', () => {
    const empty: CadPart = { ...panel('Broken'), sketch: { id: 's', entities: [], constraints: [] } };
    setup({ ...createCadDocument(), parts: [empty, panel('Shelf')] });
    expect(screen.getByRole('status').textContent).toMatch(/^Not shown: Broken/);
  });

  it('places a part by typing a position that uses variables', () => {
    const side: CadPart = { ...panel('Right side'), placement: { position: [0, 0, 0], rotation: [0, 0, 0, 1] } };
    const document: CadDocument = {
      ...createCadDocument(),
      variables: [
        { id: 'w', name: 'width', expression: '600mm' },
        { id: 'b', name: 'board', expression: '18mm' },
      ],
      parts: [side, panel('Shelf')],
    };
    const { place } = setup(document, side.id);
    const x = screen.getByRole('textbox', { name: 'Position X' });
    fireEvent.change(x, { target: { value: 'width - boards' } });
    fireEvent.keyDown(x, { key: 'Enter' });
    expect(screen.getByRole('status').textContent).toBe("Position X: There's no variable called boards.");
    expect(place).not.toHaveBeenCalled();
    fireEvent.change(x, { target: { value: 'width - board' } });
    fireEvent.keyDown(x, { key: 'Enter' });
    expect(place).toHaveBeenCalledWith([
      { partId: side.id, placement: { position: [582, 0, 0], rotation: [0, 0, 0, 1], positionExpressions: ['width - board', null, null] } },
    ]);
  });

  it('turns a part about its own origin, keeping the position typed for it', () => {
    const side: CadPart = {
      ...panel('Side'),
      placement: { position: [582, 0, 0], rotation: [0, 0, 0, 1], positionExpressions: ['width - board', null, null] },
    };
    const { place } = setup({ ...createCadDocument(), parts: [side, panel('Shelf')] }, side.id);
    fireEvent.click(screen.getByRole('button', { name: '⟲Y' }));
    expect(place).toHaveBeenCalledWith([
      {
        partId: side.id,
        placement: {
          position: [582, 0, 0],
          rotation: [0, Math.SQRT1_2, 0, Math.SQRT1_2],
          positionExpressions: ['width - board', null, null],
        },
      },
    ]);
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
    expect(screen.getByRole('status').textContent).toBe(
      'Bottom and Shelf take up the same space. Move one, or check the sizes they follow.'
    );
  });
});
