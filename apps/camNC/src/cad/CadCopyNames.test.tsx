import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { createCadPart } from '@wbcnc/cad';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CadCopyNames } from './CadCopyNames';

afterEach(cleanup);

describe('copy names', () => {
  it('names a copy, leaves it alone on Escape, and shows the numbered name until then', () => {
    const part = { ...createCadPart('Divider', 8), copies: [{ id: 'a' }, { id: 'b', name: 'Short divider' }] };
    const onRename = vi.fn();
    render(<CadCopyNames part={part} onRename={onRename} />);
    expect(screen.getByText('Names of the 3 pieces')).toBeTruthy();
    const first = screen.getByLabelText('Name of copy 2') as HTMLInputElement;
    expect(first.placeholder).toBe('Divider 2');
    expect((screen.getByLabelText('Name of copy 3') as HTMLInputElement).value).toBe('Short divider');
    fireEvent.change(first, { target: { value: 'Long divider' } });
    fireEvent.keyDown(first, { key: 'Escape' });
    expect(onRename).not.toHaveBeenCalled();
    fireEvent.change(first, { target: { value: 'Long divider' } });
    fireEvent.blur(first);
    expect(onRename).toHaveBeenCalledWith('a', 'Long divider');
  });
});
