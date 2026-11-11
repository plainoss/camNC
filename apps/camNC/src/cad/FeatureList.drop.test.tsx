import { act, cleanup, render, screen } from '@testing-library/react';
import { createCadDocument, createCadFolder, createPlateDocument, setCadVariable, type CadDocument } from '@wbcnc/cad';
import { useRef, useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { StudioFeatureList } from './StudioFeatureList';

afterEach(cleanup);
const plate = (name: string) => ({ ...createPlateDocument({ width: 100, height: 50 }).parts[0]!, name });

function setup(initial: CadDocument) {
  const commits = vi.fn<(document: CadDocument) => void>();
  const refusals = vi.fn();
  function Host() {
    const [document, setDocument] = useState(initial);
    const current = useRef(document);
    current.current = document;
    return (
      <div className="cad-editor">
        <StudioFeatureList
          document={document}
          currentDocument={current}
          selectedPartId={null}
          onSelect={() => undefined}
          onAction={() => undefined}
          workspace
          onRefusal={refusals}
          commit={next => {
            commits(next);
            setDocument(next);
          }}
        />
      </div>
    );
  }
  render(<Host />);
  const dataTransfer = new DataTransfer();
  const row = (name: string) => screen.getByRole('button', { name: new RegExp(`^${name}`) }).closest('li')!;
  const drag = (target: Element, type: string) => {
    const event = new DragEvent(type, { bubbles: true, cancelable: true, dataTransfer });
    act(() => void target.dispatchEvent(event));
    return event;
  };
  return { commits, refusals, row, drag, button: (name: string) => screen.getByRole('button', { name: new RegExp(`^${name}`) }) };
}

describe('dragging a step in the feature list', () => {
  it('draws a line where the step will land, before the part it’s dropped on, and moves it there', () => {
    const { commits, row, drag, button } = setup({ ...createCadDocument(), parts: [plate('A'), plate('B'), plate('C')] });
    drag(button('Extrude · C'), 'dragstart');
    // Over B's extrude, C's steps go ahead of all of B's, so the line is above B's sketch.
    const over = drag(row('Extrude · B'), 'dragover');
    expect(over.defaultPrevented).toBe(true);
    expect(row('Sketch · B').classList).toContain('cad-feature-drop-before');
    expect(row('Extrude · B').classList).not.toContain('cad-feature-drop-before');
    expect(document.querySelectorAll('.cad-feature-drop-before')).toHaveLength(1);
    expect(screen.queryByRole('status')).toBeNull();
    // Over its own part nothing moves, so nothing is marked and the drop isn't taken.
    expect(drag(row('Sketch · C'), 'dragover').defaultPrevented).toBe(false);
    expect(document.querySelector('.cad-feature-drop-before')).toBeNull();
    drag(row('Extrude · B'), 'dragover');
    drag(row('Extrude · B'), 'drop');
    expect(commits.mock.calls.at(-1)?.[0].parts.map(part => part.name)).toEqual(['A', 'C', 'B']);
    expect(document.querySelector('.cad-feature-drop-before')).toBeNull();
  });

  it('marks a row the step can’t go to with the reason, and refuses the drop', () => {
    const a = plate('A');
    const b = { ...plate('B'), drawnOn: { on: { partId: a.id, face: 'top' as const }, offset: 0 } };
    const { commits, row, drag, button } = setup({ ...createCadDocument(), parts: [a, b] });
    drag(button('Extrude · B'), 'dragstart');
    const over = drag(row('Sketch · A'), 'dragover');
    expect(over.defaultPrevented).toBe(false);
    expect(over.dataTransfer!.dropEffect).toBe('none');
    expect(row('Sketch · A').classList).toContain('cad-feature-drop-refused');
    expect(screen.getByRole('status').textContent).toBe('B is built on A, so it comes after it.');
    expect(document.querySelector('.cad-feature-drop-before')).toBeNull();
    // Ending the drag clears it.
    drag(button('Extrude · B'), 'dragend');
    expect(document.querySelector('.cad-feature-drop-refused')).toBeNull();
    expect(screen.queryByRole('status')).toBeNull();
    expect(commits).not.toHaveBeenCalled();
  });

  it('marks the folder row when a step would land just ahead of the folder', () => {
    const parts = [plate('A'), plate('B'), plate('C')];
    const made = createCadFolder({ ...createCadDocument(), parts }, { id: 'box', name: 'Box', partIds: [parts[0]!.id, parts[1]!.id] });
    if ('error' in made) throw new Error(made.error);
    // The folder's variable is listed between its row and its first step.
    const variable = setCadVariable(made.document, { name: 'width', expression: '600 mm', folderId: 'box' });
    if ('error' in variable) throw new Error(variable.error);
    const { row, drag, button } = setup(variable.document);
    expect(button('#width')).toBeTruthy();
    drag(button('Extrude · C'), 'dragstart');
    drag(row('Extrude · A'), 'dragover');
    expect(screen.getByRole('button', { name: 'Box' }).closest('li')!.classList).toContain('cad-feature-drop-before');
    expect(row('Sketch · A').classList).not.toContain('cad-feature-drop-before');
    // Dragged out of the list, the line goes.
    const list = row('Sketch · A').closest('ol')!;
    act(() => void list.dispatchEvent(new DragEvent('dragleave', { bubbles: true, relatedTarget: document.body })));
    expect(document.querySelector('.cad-feature-drop-before')).toBeNull();
  });
});
