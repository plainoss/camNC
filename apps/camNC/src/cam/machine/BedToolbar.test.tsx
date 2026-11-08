import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { BedToolbar } from './BedToolbar';
import { useBedEdit, type BedTools } from './bedEdit';

const tools = (t: Partial<BedTools> = {}): BedTools => ({
  board: 'A',
  hold: 'clamp',
  undo: null,
  note: 'Drag to move the board',
  blocked: false,
  ...t,
});

afterEach(() => {
  cleanup();
  useBedEdit.setState(useBedEdit.getInitialState(), true);
});

it('shows nothing while no board is edited', () => {
  const { container } = render(<BedToolbar />);
  expect(container.textContent).toBe('');
});

it("the board's bar switches to Add mode and back, with what a tap does said below it", () => {
  useBedEdit.setState({ tools: tools() });
  render(<BedToolbar />);
  const add = screen.getByRole('button', { name: /Add clamp/ });
  expect(screen.getByRole('toolbar', { name: 'Edit board A' })).toBeTruthy();
  expect(screen.getByText('Drag to move the board')).toBeTruthy();
  fireEvent.click(add);
  expect(useBedEdit.getState().mode).toBe('add');
  expect(add.getAttribute('aria-pressed')).toBe('true');
  fireEvent.click(add);
  expect(useBedEdit.getState().mode).toBe('move');
});

it('Undo runs the last undo, and is off with nothing to undo', () => {
  useBedEdit.setState({ tools: tools() });
  const { rerender } = render(<BedToolbar />);
  expect((screen.getByRole('button', { name: 'Undo' }) as HTMLButtonElement).disabled).toBe(true);
  const undo = vi.fn();
  useBedEdit.setState({ tools: tools({ undo }) });
  rerender(<BedToolbar />);
  fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
  expect(undo).toHaveBeenCalledOnce();
});

it("a selected item's bar has its own buttons and Undo, but no Add", () => {
  useBedEdit.setState({ tools: tools() });
  render(
    <BedToolbar item="Clamp 2">
      <button>Remove</button>
    </BedToolbar>
  );
  const bar = screen.getByRole('toolbar', { name: 'Clamp 2' });
  expect(bar.textContent).toContain('Remove');
  expect(screen.getByRole('button', { name: 'Undo' })).toBeTruthy();
  expect(screen.queryByRole('button', { name: /Add clamp/ })).toBeNull();
});

it('no Add where the board has no holds, and none while the setup is protected', () => {
  useBedEdit.setState({ tools: tools({ hold: null }) });
  const { rerender } = render(<BedToolbar />);
  expect(screen.queryByRole('button', { name: /Add/ })).toBeNull();
  useBedEdit.setState({ tools: tools({ blocked: true, note: 'Locked while the program runs.' }) });
  rerender(<BedToolbar />);
  expect((screen.getByRole('button', { name: /Add clamp/ }) as HTMLButtonElement).disabled).toBe(true);
  expect(screen.getByText('Locked while the program runs.')).toBeTruthy();
});

it("a selected item's bar still shows its buttons before the board's tools are known", () => {
  render(
    <BedToolbar item="Socket">
      <button>Layout in CAM</button>
    </BedToolbar>
  );
  expect(screen.getByRole('toolbar', { name: 'Socket' }).textContent).toContain('Layout in CAM');
  expect(screen.queryByRole('button', { name: 'Undo' })).toBeNull();
});
