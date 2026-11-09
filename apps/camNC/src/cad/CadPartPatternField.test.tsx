import { createPlateDocument, type CadDrawnOn, type CadPartPattern } from '@wbcnc/cad';
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

  it('picks a direction, preserves it while editing, flips it and clears back to the axis', () => {
    const document = createPlateDocument({ width: 100, height: 50 });
    let pattern: CadPartPattern = { id: 'p', axis: 'x', count: 3, spacing: 20 };
    const onChange = vi.fn();
    let picked: (on: CadDrawnOn['on']) => void = () => {};
    const pickDirection = vi.fn(callback => {
      picked = callback;
    });
    const field = () => <CadPartPatternField document={document} pattern={pattern} pickDirection={pickDirection} onChange={onChange} />;
    const { rerender } = render(field());
    const update = () => {
      pattern = { id: 'p', ...onChange.mock.calls.at(-1)![0] };
      rerender(field());
    };
    expect(screen.getByLabelText('Along')).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Direction' }));
    expect(pickDirection).toHaveBeenCalledOnce();
    expect(screen.getByRole('button', { name: 'Direction' })).toHaveAttribute('data-active');
    picked({ plane: 'front' });
    update();
    expect(screen.getByRole('button', { name: 'Direction' }).textContent).toContain('the front plane');
    expect(screen.getByRole('button', { name: 'Direction' })).not.toHaveAttribute('data-active');
    expect(screen.queryByLabelText('Along')).toBeNull();
    fireEvent.change(screen.getByLabelText('How many'), { target: { value: '4' } });
    fireEvent.blur(screen.getByLabelText('How many'));
    update();
    expect(pattern.direction).toEqual({ along: { plane: 'front' } });
    fireEvent.click(screen.getByLabelText('Flip direction'));
    update();
    expect(pattern.direction).toEqual({ along: { plane: 'front' }, flip: true });
    fireEvent.click(screen.getByRole('button', { name: 'Clear' }));
    update();
    expect(pattern).not.toHaveProperty('direction');
    expect(screen.getByLabelText('Along')).toHaveValue('x');
    expect(screen.queryByLabelText('Flip direction')).toBeNull();
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
