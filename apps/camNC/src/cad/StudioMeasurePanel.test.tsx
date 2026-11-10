import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { StudioMeasurePanel, type StudioMeasurePanelProps, type StudioMeasureSelection } from './StudioMeasurePanel';
import type { MeasureResult } from './measureGeometry';
import './cad.css';

afterEach(cleanup);

const selection: StudioMeasureSelection[] = [
  { key: 'side:corner', label: 'Side · vertex', entity: { kind: 'vertex', point: [0, 0, 0] } },
  { key: 'shelf:corner', label: 'Shelf 3 · vertex', entity: { kind: 'vertex', point: [3, 4, 0] } },
];
const result: MeasureResult = {
  rows: [
    { id: 'distance', label: 'Distance', value: 5, kind: 'length', witness: { a: [0, 0, 0], b: [3, 4, 0] } },
    { id: 'delta-x', label: 'Δ X', value: 3, kind: 'position', axis: 'x' },
    { id: 'delta-y', label: 'Δ Y', value: 4, kind: 'position', axis: 'y' },
    { id: 'delta-z', label: 'Δ Z', value: 0, kind: 'position', axis: 'z' },
  ],
};

function setup(overrides: Partial<StudioMeasurePanelProps> = {}) {
  const callbacks = {
    onExpand: vi.fn(),
    onClose: vi.fn(),
    onClear: vi.fn(),
    onRemove: vi.fn(),
    onSelectRow: vi.fn(),
    copyText: vi.fn<(text: string) => Promise<void>>().mockResolvedValue(undefined),
  };
  let current: StudioMeasurePanelProps = { selection, result, expanded: false, ...callbacks, ...overrides };
  const view = (props: StudioMeasurePanelProps) => (
    <div className="cad-editor" style={{ position: 'relative', width: 500, height: 600 }}>
      <button type="button">Outside inspector</button>
      <StudioMeasurePanel {...props} />
    </div>
  );
  const rendered = render(view(current));
  return {
    ...callbacks,
    ...rendered,
    rerenderPanel: (next: Partial<StudioMeasurePanelProps>) => {
      current = { ...current, ...next };
      rendered.rerender(view(current));
    },
  };
}

describe('assembled measurement inspector', () => {
  it('shows a passive quick readout without moving keyboard focus, then opens the full tool explicitly', () => {
    const outside = document.createElement('button');
    document.body.append(outside);
    outside.focus();
    const { onExpand, onClear } = setup();
    const quick = screen.getByRole('region', { name: 'Selection measurements' });
    expect(document.activeElement).toBe(outside);
    expect(within(quick).getByRole('button', { name: 'Distance: 5 mm' })).toBeVisible();
    expect(within(quick).queryByRole('button', { name: 'Δ Z: 0 mm' })).toBeNull();
    expect(within(quick).getByText('1 more in Measure')).toBeVisible();
    fireEvent.click(within(quick).getByRole('button', { name: 'Measure [' }));
    expect(onExpand).toHaveBeenCalledOnce();
    fireEvent.click(within(quick).getByRole('button', { name: 'Clear measurements' }));
    expect(onClear).toHaveBeenCalledOnce();
    outside.remove();
  });

  it('uses a non-modal dialog and permits selecting elsewhere while the inspector is open', () => {
    const { onClose } = setup({ expanded: true });
    const dialog = screen.getByRole('dialog', { name: 'Measure' }) as HTMLDialogElement;
    expect(dialog.open).toBe(true);
    expect(dialog.hasAttribute('aria-modal')).toBe(false);
    expect(dialog.matches(':modal')).toBe(false);
    expect(within(dialog).getByRole('list', { name: 'Measured entities' })).toHaveTextContent('Shelf 3 · vertex');
    screen.getByRole('button', { name: 'Outside inspector' }).focus();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Outside inspector' }));
    fireEvent.keyDown(dialog, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledOnce();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Close Measure' }));
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it.each([
    { unit: 'cm', length: '2.54 cm', area: '6.452 cm²' },
    { unit: 'in', length: '1 in', area: '1 in²' },
  ] as const)('defaults quick and expanded readouts to $unit while retaining an explicit conversion', ({ unit, length, area }) => {
    const measured: MeasureResult = {
      rows: [
        { id: 'length', label: 'Length', value: 25.4, kind: 'length' },
        { id: 'area', label: 'Surface area', value: 645.16, kind: 'area' },
      ],
    };
    const original = JSON.stringify({ selection, measured });
    const { rerenderPanel } = setup({ defaultLengthUnit: unit, result: measured });
    expect(screen.getByRole('button', { name: `Length: ${length}` })).toBeVisible();
    expect(screen.getByRole('button', { name: `Surface area: ${area}` })).toBeVisible();
    rerenderPanel({ expanded: true });
    expect(screen.getByLabelText('Length unit')).toHaveValue(unit);
    expect(screen.getByRole('button', { name: `Length: ${length}` })).toBeVisible();
    fireEvent.change(screen.getByLabelText('Length unit'), { target: { value: 'mm' } });
    expect(screen.getByRole('button', { name: 'Length: 25.4 mm' })).toBeVisible();
    expect(screen.getByRole('button', { name: 'Surface area: 645.16 mm²' })).toBeVisible();
    rerenderPanel({ expanded: false, selection: [], result: { rows: [] } });
    expect(screen.queryByRole('region', { name: 'Selection measurements' })).toBeNull();
    rerenderPanel({ selection, result: measured });
    expect(screen.getByRole('button', { name: 'Length: 25.4 mm' })).toBeVisible();
    rerenderPanel({ expanded: true });
    expect(screen.getByLabelText('Length unit')).toHaveValue('mm');
    expect(JSON.stringify({ selection, measured })).toBe(original);
  });

  it('converts lengths, areas and angles with independent dimensions and filters result types', () => {
    setup({
      expanded: true,
      result: {
        rows: [
          { id: 'length', label: 'Length', value: 25.4, kind: 'length' },
          { id: 'area', label: 'Surface area', value: 645.16, kind: 'area' },
          { id: 'angle', label: 'Angle', value: 90, kind: 'angle' },
        ],
      },
    });
    fireEvent.change(screen.getByLabelText('Length unit'), { target: { value: 'in' } });
    expect(screen.getByRole('button', { name: 'Length: 1 in' })).toBeVisible();
    expect(screen.getByRole('button', { name: 'Surface area: 1 in²' })).toBeVisible();
    expect(screen.getByRole('button', { name: 'Angle: 90°' })).toBeVisible();
    fireEvent.change(screen.getByLabelText('Angle unit'), { target: { value: 'rad' } });
    expect(screen.getByRole('button', { name: 'Angle: 1.571 rad' })).toBeVisible();
    fireEvent.change(screen.getByLabelText('Measure type'), { target: { value: 'area' } });
    expect(screen.queryByRole('button', { name: /^Length:/ })).toBeNull();
    expect(screen.getByRole('button', { name: 'Surface area: 1 in²' })).toBeVisible();
  });

  it('selects a witness row and alternates full and displayed precision when copying that value', async () => {
    const { copyText, onSelectRow, rerenderPanel } = setup({
      expanded: true,
      result: { rows: [{ id: 'distance', label: 'Distance', value: Math.PI, kind: 'length' }] },
    });
    const value = screen.getByRole('button', { name: 'Distance: 3.142 mm' });
    fireEvent.click(value);
    await waitFor(() => expect(copyText).toHaveBeenLastCalledWith('3.141592653589793 mm'));
    expect(onSelectRow).toHaveBeenCalledWith('distance');
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Distance copied at full precision.'));
    rerenderPanel({ selectedRowId: 'distance' });
    expect(value).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(value);
    await waitFor(() => expect(copyText).toHaveBeenLastCalledWith('3.142 mm'));
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Distance copied at displayed precision.'));
  });

  it('reports clipboard refusal, permits retry and ignores a completion for an obsolete result', async () => {
    let finishCopy: (() => void) | undefined;
    const failedCopy = vi.fn<(text: string) => Promise<void>>().mockRejectedValueOnce(new Error('Denied')).mockResolvedValue(undefined);
    const { rerenderPanel } = setup({ expanded: true, copyText: failedCopy });
    fireEvent.click(screen.getByRole('button', { name: 'Distance: 5 mm' }));
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Copy failed.'));
    fireEvent.click(screen.getByRole('button', { name: 'Distance: 5 mm' }));
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('full precision'));
    rerenderPanel({
      copyText: () =>
        new Promise(resolve => {
          finishCopy = resolve;
        }),
    });
    fireEvent.click(screen.getByRole('button', { name: 'Distance: 5 mm' }));
    rerenderPanel({ result: { rows: [{ id: 'length', label: 'Length', value: 10, kind: 'length' }] } });
    finishCopy?.();
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent(''));
    expect(screen.getByRole('status')).not.toHaveTextContent('Distance copied');
  });

  it('removes exact named selections, clears all, and keeps controls available when nothing is selected', () => {
    const { onRemove, onClear, rerenderPanel } = setup({ expanded: true });
    fireEvent.click(screen.getByRole('button', { name: 'Remove Shelf 3 · vertex' }));
    expect(onRemove).toHaveBeenCalledWith('shelf:corner');
    fireEvent.click(screen.getByRole('button', { name: /^Clear$/ }));
    expect(onClear).toHaveBeenCalledOnce();
    rerenderPanel({ selection: [], result: { rows: [] } });
    expect(screen.getByRole('dialog', { name: 'Measure' })).toBeVisible();
    expect(screen.getByRole('button', { name: /^Clear$/ })).toBeDisabled();
    expect(screen.getByText(/Select a vertex, straight edge or planar face/)).toBeVisible();
    rerenderPanel({ expanded: false });
    expect(screen.queryByRole('region', { name: 'Selection measurements' })).toBeNull();
  });

  it('shows invalid-geometry feedback, refuses nonfinite values and preserves a small nonzero clearance', () => {
    setup({
      expanded: true,
      result: {
        problem: 'That face is degenerate.',
        rows: [
          { id: 'distance', label: 'Distance', value: 1e-7, kind: 'length' },
          { id: 'angle', label: 'Angle', value: NaN, kind: 'angle' },
        ],
      },
    });
    expect(screen.getByRole('alert')).toHaveTextContent('That face is degenerate.');
    expect(screen.getByRole('button', { name: 'Distance: 1e-7 mm' })).toBeVisible();
    expect(screen.queryByRole('button', { name: /^Angle:/ })).toBeNull();
  });

  it('reports both parallel and nonparallel edge relations and describes faceted curved measurements', () => {
    const { rerenderPanel } = setup({ expanded: true, result: { ...result, parallel: true } });
    expect(screen.getByText('Parallel', { exact: true })).toBeVisible();
    rerenderPanel({ result: { ...result, parallel: false } });
    expect(screen.getByText('Not parallel')).toBeVisible();
    expect(screen.getByText('Curved outlines use a faceted approximation.')).toBeVisible();
  });

  it('keeps colored XYZ labels distinguishable and fits the panel within a narrow viewport', () => {
    setup({ expanded: true });
    const dialog = screen.getByRole('dialog', { name: 'Measure' });
    const axes = ['x', 'y', 'z'].map(axis => dialog.querySelector<HTMLElement>(`[data-axis="${axis}"]`)!);
    expect(new Set(axes.map(row => getComputedStyle(row).color)).size).toBe(3);
    expect(axes.map(row => row.textContent)).toEqual(['Δ X3 mm', 'Δ Y4 mm', 'Δ Z0 mm']);
    dialog.parentElement!.style.width = '220px';
    const box = dialog.getBoundingClientRect(),
      parent = dialog.parentElement!.getBoundingClientRect();
    expect(box.left).toBeGreaterThanOrEqual(parent.left);
    expect(box.right).toBeLessThanOrEqual(parent.right);
    expect(getComputedStyle(dialog).position).toBe('absolute');
    const unit = screen.getByLabelText('Length unit');
    expect(unit.getBoundingClientRect().height).toBeGreaterThanOrEqual(24);
  });
});
