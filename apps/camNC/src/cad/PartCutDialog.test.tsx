import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { createCadPart, createPlateDocument, type CadDocument } from '@wbcnc/cad';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PartCutDialog } from './PartCutDialog';

afterEach(cleanup);

function design(): CadDocument {
  const document = createPlateDocument({ width: 300, height: 600, thickness: 18 });
  document.parts[0]!.name = 'Side';
  return { ...document, parts: [...document.parts, { ...createCadPart('Back', 6), id: 'back' }] };
}

describe('the cut parts dialog', () => {
  it('picks clicked parts into the box being filled, and cuts the tools out of the targets with the design’s fit', async () => {
    const document = design();
    const side = document.parts[0]!.id;
    const onSave = vi.fn(),
      onPicked = vi.fn();
    const dialog = (pick: { partId: string; seq: number } | null) => (
      <PartCutDialog
        document={document}
        tool="back"
        pick={pick}
        variables={{ fit: { value: 0.3, kind: 'length' } }}
        onPicked={onPicked}
        onSave={onSave}
        onClose={() => {}}
      />
    );
    const view = render(dialog(null));
    expect(screen.getByLabelText('Clearance')).toHaveProperty('value', 'fit');
    // The selected part is the tool, and the targets box is the one being filled.
    expect(within(screen.getByRole('group', { name: 'Tools' })).getByText('Back')).toBeDefined();
    expect(screen.getByRole('group', { name: 'Targets' }).hasAttribute('data-active')).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Cut' }));
    await waitFor(() => expect(screen.getByRole('alert').textContent).toMatch(/at least one part/));
    view.rerender(dialog({ partId: side, seq: 1 }));
    expect(within(screen.getByRole('group', { name: 'Targets' })).getByText('Side')).toBeDefined();
    expect(onPicked).toHaveBeenLastCalledWith({ tools: ['back'], targets: [side] });
    fireEvent.click(screen.getByRole('button', { name: 'Cut' }));
    await waitFor(() =>
      expect(onSave).toHaveBeenCalledWith({ tools: ['back'], targets: [side], clearance: 0.3, clearanceExpression: 'fit' })
    );
    // A second click on a picked part takes it out again, and its cross does too.
    view.rerender(dialog({ partId: side, seq: 2 }));
    expect(within(screen.getByRole('group', { name: 'Targets' })).queryByText('Side')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Take Back out of tools' }));
    expect(within(screen.getByRole('group', { name: 'Tools' })).queryByText('Back')).toBeNull();
  });

  it('won’t cut a part out of itself, or with less than no room', async () => {
    const document = design();
    const onSave = vi.fn();
    const dialog = (pick: { partId: string; seq: number } | null) => (
      <PartCutDialog document={document} tool="back" pick={pick} onSave={onSave} onClose={() => {}} />
    );
    const view = render(dialog(null));
    view.rerender(dialog({ partId: 'back', seq: 1 }));
    fireEvent.click(screen.getByRole('button', { name: 'Cut' }));
    await waitFor(() => expect(screen.getByRole('alert').textContent).toMatch(/itself/));
    view.rerender(dialog({ partId: document.parts[0]!.id, seq: 2 }));
    fireEvent.change(screen.getByLabelText('Clearance'), { target: { value: '-1' } });
    fireEvent.click(screen.getByRole('button', { name: 'Cut' }));
    await waitFor(() => expect(screen.getByRole('alert').textContent).toMatch(/less than nothing/));
    expect(onSave).not.toHaveBeenCalled();
  });
});
