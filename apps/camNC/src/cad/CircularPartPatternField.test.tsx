import { createPlateDocument, setPartPattern, type CadDocument, type CadDrawnOn, type CadPartPattern } from '@wbcnc/cad';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CadPartPatternField } from './CadPartPatternField';
import { PartPatternDialog, type CadConnectorPick } from './PartFeatureDialogs';
import './cad.css';

afterEach(cleanup);

const circular: CadPartPattern = {
  id: 'legs',
  axis: 'x',
  count: 4,
  spacing: 100,
  circular: { origin: [0, 0, 0], axis: [0, 0, 1], angle: 360, equalSpacing: true },
};

function setup(pattern?: CadPartPattern) {
  const source = createPlateDocument({ width: 40, height: 40, thickness: 18 });
  source.parts[0]!.name = 'Leg';
  if (pattern) {
    source.parts[0]!.pattern = pattern;
    source.parts[0]!.copies = [{ id: `${pattern.id}:1`, pattern: pattern.id, name: 'Other leg' }];
  }
  let latest = source;
  let picked: ((pick: CadConnectorPick) => void) | null = null;
  let pickedDirection: ((on: CadDrawnOn['on']) => void) | null = null;
  const onOk = vi.fn(),
    onCancel = vi.fn();
  const pickPoint = (callback: ((pick: CadConnectorPick) => void) | null) => {
    picked = callback;
  };
  const pickDirection = (callback: ((on: CadDrawnOn['on']) => void) | null) => {
    pickedDirection = callback;
  };
  function Harness() {
    const [document, setDocument] = useState(source);
    const [open, setOpen] = useState(true);
    latest = document;
    return (
      open && (
        <PartPatternDialog
          document={document}
          part={document.parts[0]!}
          variables={{ legs: { value: 6, kind: 'number' }, sweep: { value: 180, kind: 'angle' } }}
          onChange={change => setDocument(change)}
          onOk={onOk}
          onCancel={() => {
            setDocument(source);
            setOpen(false);
            onCancel();
          }}
          pickPoint={pickPoint}
          pickDirection={pickDirection}
        />
      )
    );
  }
  render(<Harness />);
  return {
    latest: () => latest,
    pick: (pick: CadConnectorPick) => act(() => picked?.(pick)),
    pendingPick: () => picked,
    pendingDirection: () => pickedDirection,
    onOk,
    onCancel,
    source,
  };
}

describe('circular part pattern controls', () => {
  it('starts a fresh circular pattern with four instances and restores the design on cancel', () => {
    const { latest, onCancel, source } = setup();
    fireEvent.change(screen.getByLabelText('Pattern type'), { target: { value: 'circular' } });
    expect(screen.getByRole('dialog', { name: 'Circular pattern · Leg' })).toBeVisible();
    expect(screen.getByLabelText('Angle')).toHaveValue('360');
    expect(screen.getByLabelText('Instance count')).toHaveValue('4');
    expect(screen.getByLabelText('Equal spacing')).toBeChecked();
    expect(latest().parts[0]!.copies).toHaveLength(3);
    expect(screen.getByText(/full circle has no duplicate/)).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onCancel).toHaveBeenCalledOnce();
    expect(latest()).toBe(source);
  });

  it('preserves an authored linear count and pattern identity when changing pattern type', () => {
    const { latest } = setup({ id: 'row', axis: 'y', count: 5, spacing: 60 });
    fireEvent.change(screen.getByLabelText('Pattern type'), { target: { value: 'circular' } });
    expect(latest().parts[0]!.pattern).toMatchObject({ id: 'row', count: 5, circular: { angle: 360 } });
    expect(latest().parts[0]!.copies![0]).toMatchObject({ id: 'row:1', name: 'Other leg' });
    fireEvent.change(screen.getByLabelText('Pattern type'), { target: { value: 'linear' } });
    expect(latest().parts[0]!.pattern).toEqual({ id: 'row', axis: 'y', count: 5, spacing: 60 });
    expect(latest().parts[0]!.copies![0]).toMatchObject({ id: 'row:1', name: 'Other leg' });
    expect(screen.getByLabelText('How many')).toHaveValue('5');
  });

  it('keeps count and angle expressions while changing spacing mode and direction', () => {
    const { latest } = setup(circular);
    fireEvent.change(screen.getByLabelText('Instance count'), { target: { value: 'legs' } });
    fireEvent.change(screen.getByLabelText('Angle'), { target: { value: 'sweep' } });
    fireEvent.keyDown(screen.getByLabelText('Angle'), { key: 'Enter' });
    expect(latest().parts[0]!.pattern).toMatchObject({
      count: 6,
      countExpression: 'legs',
      circular: { angle: 180, angleExpression: 'sweep' },
    });
    fireEvent.click(screen.getByLabelText('Equal spacing'));
    fireEvent.click(screen.getByLabelText('Opposite direction'));
    expect(latest().parts[0]!.pattern).toMatchObject({
      countExpression: 'legs',
      circular: { angleExpression: 'sweep', equalSpacing: false, opposite: true },
    });
    expect(screen.getByText(/angle between each instance/)).toBeVisible();
  });

  it('disables acceptance for invalid draft values and preserves the last valid preview', async () => {
    const { latest, onOk } = setup(circular);
    fireEvent.change(screen.getByLabelText('Instance count'), { target: { value: '2.5' } });
    fireEvent.blur(screen.getByLabelText('Instance count'));
    expect(screen.getByRole('alert')).toHaveTextContent(/whole number/);
    expect(screen.getByRole('button', { name: 'OK' })).toBeDisabled();
    expect(latest().parts[0]!.pattern).toBe(circular);
    fireEvent.click(screen.getByRole('button', { name: 'OK' }));
    expect(onOk).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText('Instance count'), { target: { value: '1' } });
    fireEvent.change(screen.getByLabelText('Angle'), { target: { value: '361' } });
    expect(screen.getByRole('alert')).toHaveTextContent(/no more than 360/);
    fireEvent.change(screen.getByLabelText('Angle'), { target: { value: '90' } });
    fireEvent.blur(screen.getByLabelText('Angle'));
    expect(screen.getByRole('button', { name: 'OK' })).toBeEnabled();
    expect(latest().parts[0]!.copies ?? []).toHaveLength(0);
    fireEvent.click(screen.getByRole('button', { name: 'OK' }));
    await waitFor(() => expect(onOk).toHaveBeenCalledOnce());
  });

  it('uses a picked edge axis with the latest count, and supports a face connector axis', () => {
    const { latest, pick } = setup(circular);
    fireEvent.click(screen.getByRole('button', { name: 'Axis of pattern' }));
    fireEvent.change(screen.getByLabelText('Instance count'), { target: { value: '5' } });
    fireEvent.blur(screen.getByLabelText('Instance count'));
    pick({ partId: 'post', point: [99, 99, 99], normal: [0, 0, 1], edge: { a: [10, 20, 30], b: [10, 30, 30] } });
    expect(latest().parts[0]!.pattern).toMatchObject({ count: 5, circular: { origin: [10, 20, 30], axis: [0, 1, 0] } });
    fireEvent.click(screen.getByRole('button', { name: 'Axis of pattern' }));
    pick({ partId: 'seat', point: [15, 25, 18], normal: [0, 0, -1] });
    expect(latest().parts[0]!.pattern!.circular).toMatchObject({ origin: [15, 25, 18], axis: [0, 0, -1] });
    expect(screen.getByLabelText('Axis direction')).toHaveValue('picked');
    fireEvent.change(screen.getByLabelText('Axis direction'), { target: { value: 'x' } });
    expect(latest().parts[0]!.pattern!.circular).toMatchObject({ origin: [15, 25, 18], axis: [1, 0, 0] });
  });

  it('edits circular values from the legacy inline part controls without losing their axis', () => {
    const source = createPlateDocument({ width: 40, height: 40 });
    let latest: CadDocument = setPartPattern(source, source.parts[0]!.id, circular);
    function Inline() {
      const [document, setDocument] = useState(latest);
      latest = document;
      return (
        <CadPartPatternField
          pattern={document.parts[0]!.pattern}
          onChange={pattern => setDocument(current => setPartPattern(current, current.parts[0]!.id, pattern))}
        />
      );
    }
    render(<Inline />);
    fireEvent.change(screen.getByLabelText('Instance count'), { target: { value: '7' } });
    fireEvent.blur(screen.getByLabelText('Instance count'));
    expect(latest.parts[0]!.pattern).toMatchObject({ count: 7, circular: circular.circular });
    expect(latest.parts[0]!.copies).toHaveLength(6);
  });

  it('edits the fixed axis origin and refuses a degenerate picked edge', () => {
    const { latest, pick } = setup(circular);
    fireEvent.click(screen.getByText('Axis origin', { selector: 'summary' }));
    fireEvent.change(screen.getByLabelText('Axis origin X'), { target: { value: '2 in' } });
    fireEvent.blur(screen.getByLabelText('Axis origin X'));
    expect(latest().parts[0]!.pattern!.circular!.origin).toEqual([50.8, 0, 0]);
    fireEvent.click(screen.getByRole('button', { name: 'Axis of pattern' }));
    pick({ partId: 'bad-edge', point: [0, 0, 0], normal: [0, 0, 1], edge: { a: [1, 2, 3], b: [1, 2, 3] } });
    expect(screen.getByRole('alert')).toHaveTextContent(/straight edge or a face/);
    expect(screen.getByRole('button', { name: 'OK' })).toBeDisabled();
    expect(latest().parts[0]!.pattern!.circular!.origin).toEqual([50.8, 0, 0]);
    fireEvent.change(screen.getByLabelText('Axis direction'), { target: { value: 'y' } });
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.getByRole('button', { name: 'OK' })).toBeEnabled();
  });

  it('retains a picked axis until an invalid draft count is corrected', () => {
    const { latest, pick } = setup(circular);
    fireEvent.click(screen.getByRole('button', { name: 'Axis of pattern' }));
    fireEvent.change(screen.getByLabelText('Instance count'), { target: { value: '2.5' } });
    pick({ partId: 'post', point: [0, 0, 0], normal: [0, 0, 1], edge: { a: [10, 20, 30], b: [10, 30, 30] } });
    expect(latest().parts[0]!.pattern).toBe(circular);
    expect(screen.getByLabelText('Axis direction')).toHaveValue('y');
    fireEvent.change(screen.getByLabelText('Instance count'), { target: { value: '5' } });
    fireEvent.blur(screen.getByLabelText('Instance count'));
    expect(latest().parts[0]!.pattern).toMatchObject({ count: 5, circular: { origin: [10, 20, 30], axis: [0, 1, 0] } });
  });

  it.each(['direction', 'origin'])('cancels a pending viewport pick after editing the axis %s', kind => {
    const { latest, pendingPick } = setup(circular);
    fireEvent.click(screen.getByRole('button', { name: 'Axis of pattern' }));
    const pending = pendingPick();
    if (kind === 'direction') fireEvent.change(screen.getByLabelText('Axis direction'), { target: { value: 'x' } });
    else {
      fireEvent.click(screen.getByText('Axis origin', { selector: 'summary' }));
      fireEvent.change(screen.getByLabelText('Axis origin X'), { target: { value: '33' } });
      fireEvent.blur(screen.getByLabelText('Axis origin X'));
    }
    const manual = latest().parts[0]!.pattern!.circular;
    act(() => pending?.({ partId: 'late', point: [10, 20, 30], normal: [0, 1, 0] }));
    expect(latest().parts[0]!.pattern!.circular).toEqual(manual);
    expect(pendingPick()).toBeNull();
    expect(screen.getByRole('button', { name: 'Axis of pattern' })).not.toHaveAttribute('data-active');
  });

  it('invalidates a pending linear direction pick when switching to a circular pattern', () => {
    const { latest, pendingDirection } = setup({ id: 'row', axis: 'x', count: 3, spacing: 50 });
    fireEvent.click(screen.getByRole('button', { name: 'Direction' }));
    const pending = pendingDirection();
    fireEvent.change(screen.getByLabelText('Pattern type'), { target: { value: 'circular' } });
    const changed = latest().parts[0]!.pattern;
    act(() => pending?.({ plane: 'front' }));
    expect(latest().parts[0]!.pattern).toBe(changed);
    expect(latest().parts[0]!.pattern!.circular).toBeDefined();
    expect(pendingDirection()).toBeNull();
  });

  it('ignores superseded linear picker callbacks in either request order', () => {
    const { latest, pendingPick, pendingDirection } = setup({ id: 'row', axis: 'x', count: 3, spacing: 50 });
    fireEvent.click(screen.getByRole('button', { name: 'Direction' }));
    const firstDirection = pendingDirection();
    fireEvent.click(screen.getByRole('button', { name: 'Direction edge' }));
    const firstEdge = pendingPick();
    act(() => firstDirection?.({ plane: 'front' }));
    expect(latest().parts[0]!.pattern).not.toHaveProperty('direction');
    act(() => firstEdge?.({ partId: 'edge', point: [0, 0, 0], normal: [0, 0, 1], edge: { a: [0, 0, 0], b: [0, 0, 10] } }));
    expect(latest().parts[0]!.pattern!.vector).toEqual([0, 0, 1]);
    fireEvent.click(screen.getByRole('button', { name: 'Direction edge' }));
    const secondEdge = pendingPick();
    fireEvent.click(screen.getByRole('button', { name: 'Direction' }));
    const secondDirection = pendingDirection();
    act(() => secondEdge?.({ partId: 'late-edge', point: [0, 0, 0], normal: [0, 0, 1], edge: { a: [0, 0, 0], b: [10, 0, 0] } }));
    expect(latest().parts[0]!.pattern!.vector).toEqual([0, 0, 1]);
    act(() => secondDirection?.({ plane: 'front' }));
    expect(latest().parts[0]!.pattern!.direction).toEqual({ along: { plane: 'front' } });
    expect(latest().parts[0]!.pattern).not.toHaveProperty('vector');
  });

  it('keeps checkbox rows compact and axis selection tinted inside the editor styles', () => {
    const document = createPlateDocument({ width: 40, height: 40 });
    document.parts[0]!.pattern = circular;
    render(
      <div className="cad-editor" style={{ height: 600, width: 800 }}>
        <PartPatternDialog
          document={document}
          part={document.parts[0]!}
          onChange={() => {}}
          onOk={() => {}}
          onCancel={() => {}}
          pickPoint={() => {}}
        />
      </div>
    );
    for (const name of ['Equal spacing', 'Opposite direction']) {
      const checkbox = screen.getByRole('checkbox', { name });
      const rowStyle = getComputedStyle(checkbox.closest('label')!);
      expect(rowStyle.display).toBe('flex');
      expect(rowStyle.alignItems).toBe('center');
      expect(rowStyle.minHeight).toBe('24px');
      expect(checkbox.getBoundingClientRect().width).toBe(14);
      expect(checkbox.getBoundingClientRect().height).toBe(14);
    }
    const selectionStyle = getComputedStyle(screen.getByRole('button', { name: 'Axis of pattern' }));
    expect(selectionStyle.display).toBe('grid');
    expect(selectionStyle.textAlign).toBe('left');
    expect(selectionStyle.borderTopWidth).toBe('1px');
    expect(selectionStyle.borderTopColor).toBe('rgb(156, 192, 232)');
    expect(selectionStyle.backgroundColor).toBe('rgb(238, 245, 253)');
  });
});
