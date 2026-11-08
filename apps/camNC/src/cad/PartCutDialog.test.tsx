import { cleanup, fireEvent, render, screen } from '@testing-library/react';
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
  it('cuts the chosen parts out of the others, with the design’s fit as the clearance', () => {
    const document = design();
    const onSave = vi.fn();
    render(
      <PartCutDialog
        document={document}
        tool="back"
        variables={{ fit: { value: 0.3, kind: 'length' } }}
        onSave={onSave}
        onClose={() => {}}
      />
    );
    expect(screen.getByLabelText('Clearance')).toHaveProperty('value', 'fit');
    fireEvent.click(screen.getByRole('button', { name: 'Cut' }));
    expect(screen.getByRole('alert').textContent).toMatch(/at least one part/);
    fireEvent.click(screen.getAllByRole('checkbox', { name: 'Side' })[1]!);
    fireEvent.click(screen.getByRole('button', { name: 'Cut' }));
    expect(onSave).toHaveBeenCalledWith({ tools: ['back'], targets: [document.parts[0]!.id], clearance: 0.3, clearanceExpression: 'fit' });
  });

  it('won’t cut a part out of itself, or with less than no room', () => {
    const onSave = vi.fn();
    render(<PartCutDialog document={design()} tool="back" onSave={onSave} onClose={() => {}} />);
    fireEvent.click(screen.getAllByRole('checkbox', { name: 'Back' })[1]!);
    fireEvent.click(screen.getByRole('button', { name: 'Cut' }));
    expect(screen.getByRole('alert').textContent).toMatch(/itself/);
    fireEvent.click(screen.getAllByRole('checkbox', { name: 'Side' })[1]!);
    fireEvent.change(screen.getByLabelText('Clearance'), { target: { value: '-1' } });
    fireEvent.click(screen.getByRole('button', { name: 'Cut' }));
    expect(screen.getByRole('alert').textContent).toMatch(/less than nothing/);
    expect(onSave).not.toHaveBeenCalled();
  });
});
