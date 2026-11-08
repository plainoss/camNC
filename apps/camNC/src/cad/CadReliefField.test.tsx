import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CadReliefField } from './CadReliefField';

afterEach(cleanup);

describe('corner relief field', () => {
  it('turns relief on for a 6 mm bit, and off again', () => {
    const change = vi.fn();
    const { rerender } = render(<CadReliefField relief={undefined} onChange={change} />);
    fireEvent.click(screen.getByRole('checkbox', { name: 'Relieve inside corners' }));
    expect(change).toHaveBeenLastCalledWith({ diameter: 6 });
    rerender(<CadReliefField relief={{ diameter: 6 }} onChange={change} />);
    fireEvent.click(screen.getByRole('checkbox', { name: 'Relieve inside corners' }));
    expect(change).toHaveBeenLastCalledWith(undefined);
  });

  it('takes a bit size from a variable, and refuses one it can’t use', () => {
    const change = vi.fn();
    render(<CadReliefField relief={{ diameter: 6 }} variables={{ bit: { value: 8, kind: 'length' } }} onChange={change} />);
    const size = screen.getByRole('textbox');
    fireEvent.change(size, { target: { value: 'bits' } });
    fireEvent.keyDown(size, { key: 'Enter' });
    expect(screen.getByRole('alert').textContent).toBe("There's no variable called bits.");
    fireEvent.change(size, { target: { value: 'bit' } });
    fireEvent.keyDown(size, { key: 'Enter' });
    expect(change).toHaveBeenLastCalledWith({ diameter: 8, diameterExpression: 'bit' });
  });

  it('keeps a cancelled size from being saved, and shows a size restored by undo', () => {
    const change = vi.fn();
    const { rerender } = render(<CadReliefField relief={{ diameter: 6 }} onChange={change} />);
    const size = screen.getByRole('textbox') as HTMLInputElement;
    fireEvent.change(size, { target: { value: '8' } });
    fireEvent.keyDown(size, { key: 'Escape' });
    fireEvent.blur(size);
    expect(change).not.toHaveBeenCalled();
    rerender(<CadReliefField relief={{ diameter: 4 }} onChange={change} />);
    expect(size.value).toBe('4');
    fireEvent.blur(size);
    expect(change).not.toHaveBeenCalled();
  });
});
