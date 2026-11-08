import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { createCadDocument, createPlateDocument, type CadPart } from '@wbcnc/cad';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CadDrawnOnField } from './CadDrawnOnField';

afterEach(cleanup);

const side = { ...createPlateDocument().parts[0]!, name: 'Side' };
const back = (drawnOn: NonNullable<CadPart['drawnOn']>) => ({ ...createPlateDocument().parts[0]!, name: 'Back', drawnOn });

describe('where a drawn part starts', () => {
  it('names what it’s drawn on, takes an offset that uses variables, and grows into the face when asked', () => {
    const change = vi.fn();
    const part = back({ on: { partId: side.id, face: 'top' }, offset: 0 });
    render(
      <CadDrawnOnField
        document={{ ...createCadDocument(), parts: [side, part] }}
        part={part}
        variables={{ inset: { value: 10, kind: 'length' } }}
        onChange={change}
      />
    );
    expect(screen.getByText('Drawn on the top of Side.')).toBeTruthy();
    const offset = screen.getByRole('textbox', { name: /Offset/ });
    fireEvent.change(offset, { target: { value: '-inset' } });
    fireEvent.keyDown(offset, { key: 'Enter' });
    expect(change).toHaveBeenLastCalledWith({ on: { partId: side.id, face: 'top' }, offset: -10, offsetExpression: '-inset' });
    fireEvent.click(screen.getByRole('checkbox', { name: 'Grows into the face' }));
    expect(change).toHaveBeenLastCalledWith({ on: { partId: side.id, face: 'top' }, offset: 0, inward: true });
  });
});
