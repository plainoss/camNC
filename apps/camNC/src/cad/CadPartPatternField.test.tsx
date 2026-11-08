import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CadPartPatternField } from './CadPartPatternField';

afterEach(cleanup);

describe('the part pattern field', () => {
  it('starts a pattern, then takes a count and spacing that use variables', () => {
    const onChange = vi.fn();
    const { rerender } = render(<CadPartPatternField pattern={undefined} onChange={onChange} />);
    fireEvent.click(screen.getByRole('checkbox', { name: 'Pattern copies in a row' }));
    expect(onChange).toHaveBeenLastCalledWith({ axis: 'x', count: 2, spacing: 100 });
    const variables = { dividers: { value: 5, kind: 'number' as const }, gap: { value: 60, kind: 'length' as const } };
    rerender(<CadPartPatternField pattern={{ id: 'p', axis: 'x', count: 2, spacing: 100 }} variables={variables} onChange={onChange} />);
    fireEvent.change(screen.getByLabelText('How many'), { target: { value: 'dividers' } });
    fireEvent.change(screen.getByLabelText(/Spacing/), { target: { value: 'gap' } });
    fireEvent.keyDown(screen.getByLabelText(/Spacing/), { key: 'Enter' });
    expect(onChange).toHaveBeenLastCalledWith({ axis: 'x', count: 5, spacing: 60, countExpression: 'dividers', spacingExpression: 'gap' });
    fireEvent.change(screen.getByLabelText('Along'), { target: { value: 'y' } });
    expect(onChange).toHaveBeenLastCalledWith({ axis: 'y', count: 5, spacing: 60, countExpression: 'dividers', spacingExpression: 'gap' });
  });

  it('says why a count can’t be used, and takes the pattern away when unticked', () => {
    const onChange = vi.fn();
    render(<CadPartPatternField pattern={{ id: 'p', axis: 'z', count: 3, spacing: 50 }} onChange={onChange} />);
    fireEvent.change(screen.getByLabelText('How many'), { target: { value: '0' } });
    fireEvent.keyDown(screen.getByLabelText('How many'), { key: 'Enter' });
    expect(screen.getByRole('alert').textContent).toMatch(/one to 200/);
    expect(onChange).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('checkbox', { name: 'Pattern copies in a row' }));
    expect(onChange).toHaveBeenCalledWith(null);
  });
});
