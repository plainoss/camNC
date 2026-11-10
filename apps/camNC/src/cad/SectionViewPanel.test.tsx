import { useState } from 'react';
import type { CadLengthUnit } from '@wbcnc/cad';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { userEvent } from '@vitest/browser/context';
import { afterEach, expect, it, vi } from 'vitest';
import { SectionViewPanel, type SectionViewPanelProps } from './SectionViewPanel';
import { useProvideCadVariableFields } from './variableFields';
import { DesignUnitContext } from './designUnits';
import './cad.css';

afterEach(cleanup);

const planes = [
  { id: 'top', label: 'Top' },
  { id: 'front', label: 'Front' },
  { id: 'right', label: 'Right' },
  { id: 'datum-shelf', label: 'Shelf height' },
  { id: 'face-side', label: 'Side · outer face' },
];

function ControlledPanel(props: SectionViewPanelProps & { define: (name: string, expression: string) => string | null }) {
  const [planeId, setPlaneId] = useState(props.planeId);
  const [offset, setOffset] = useState(props.offset);
  const [flipped, setFlipped] = useState(props.flipped);
  useProvideCadVariableFields({ variables: [{ name: 'stock', shown: '18 mm' }], define: props.define });
  return (
    <SectionViewPanel
      {...props}
      planeId={planeId}
      offset={offset}
      flipped={flipped}
      onSelectPlane={id => {
        setPlaneId(id);
        props.onSelectPlane(id);
      }}
      onOffsetChange={value => {
        setOffset(value);
        props.onOffsetChange(value);
      }}
      onFlip={() => {
        setFlipped(value => !value);
        props.onFlip();
      }}
    />
  );
}

function setup(overrides: Partial<SectionViewPanelProps> = {}, width = 500, lengthUnit: CadLengthUnit = 'mm') {
  const callbacks = {
    onSelectPlane: vi.fn<(id: string) => void>(),
    onPickFace: vi.fn(),
    onOffsetChange: vi.fn<(value: string) => void>(),
    onFlip: vi.fn(),
    onViewNormal: vi.fn(),
    onConfirm: vi.fn(),
    onCancel: vi.fn(),
    onTurnOff: vi.fn(),
  };
  const define = vi.fn<(name: string, expression: string) => string | null>().mockReturnValue('View controls cannot define variables.');
  let current: SectionViewPanelProps = { planes, planeId: 'top', offset: '0', flipped: false, ...callbacks, ...overrides };
  const view = () => (
    <div className="cad-editor" data-testid="section-host" style={{ position: 'relative', width, height: 600 }}>
      <button type="button" style={{ position: 'absolute', bottom: 8, right: 8 }}>
        Outside inspector
      </button>
      <DesignUnitContext value={lengthUnit}>
        <ControlledPanel {...current} define={define} />
      </DesignUnitContext>
    </div>
  );
  const rendered = render(view());
  return {
    ...callbacks,
    define,
    rerenderPanel: (next: Partial<SectionViewPanelProps>) => {
      current = { ...current, ...next };
      rendered.rerender(view());
    },
  };
}

it('opens a compact nonmodal inspector with named geometry and allows working outside it', async () => {
  setup();
  const dialog = screen.getByRole('dialog', { name: 'Section view' });
  expect(dialog).not.toHaveAttribute('aria-modal');
  const plane = within(dialog).getByRole('combobox', { name: 'Section plane' });
  await waitFor(() => expect(document.activeElement).toBe(plane));
  expect(within(plane).getByRole('option', { name: 'Top' })).toBeDefined();
  expect(within(plane).getByRole('option', { name: 'Shelf height' })).toBeDefined();
  expect(within(plane).getByRole('option', { name: 'Side · outer face' })).toBeDefined();
  expect(plane).toHaveValue('top');
  await userEvent.click(screen.getByRole('button', { name: 'Outside inspector' }));
  expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Outside inspector' }));
  expect(dialog).toBeVisible();
});

it('uses native controls for a datum or actual face, signed offset, flip and normal view', async () => {
  const callbacks = setup();
  const plane = screen.getByRole('combobox', { name: 'Section plane' });
  await userEvent.selectOptions(plane, 'datum-shelf');
  expect(callbacks.onSelectPlane).toHaveBeenLastCalledWith('datum-shelf');
  expect(plane).toHaveValue('datum-shelf');
  await userEvent.selectOptions(plane, 'face-side');
  expect(callbacks.onSelectPlane).toHaveBeenLastCalledWith('face-side');
  const offset = screen.getByRole('textbox', { name: 'Offset' });
  await userEvent.fill(offset, '-25.4');
  expect(offset).toHaveValue('-25.4');
  expect(callbacks.onOffsetChange).toHaveBeenLastCalledWith('-25.4');
  const flip = screen.getByRole('button', { name: 'Flip plane' });
  await userEvent.click(flip);
  expect(flip).toHaveAttribute('aria-pressed', 'true');
  await userEvent.click(flip);
  expect(flip).toHaveAttribute('aria-pressed', 'false');
  expect(callbacks.onFlip).toHaveBeenCalledTimes(2);
  await userEvent.click(screen.getByRole('button', { name: 'View normal' }));
  expect(callbacks.onViewNormal).toHaveBeenCalledOnce();
});

it('starts without inventing a default plane and shows an active face picker', async () => {
  const { onPickFace, onConfirm } = setup({ planeId: null, picking: true });
  const plane = screen.getByRole('combobox', { name: 'Section plane' });
  expect(plane).toHaveValue('');
  const pick = screen.getByRole('button', { name: 'Pick planar face' });
  expect(pick).toHaveAttribute('aria-pressed', 'true');
  expect(pick.closest('[data-active]')).not.toBeNull();
  expect(screen.getByRole('status')).toHaveTextContent('Click a planar face in the view.');
  expect(screen.getByRole('button', { name: 'View normal' })).toHaveProperty('disabled', true);
  const confirm = screen.getByRole('button', { name: 'Confirm section view' });
  expect(confirm).toHaveProperty('disabled', true);
  expect(confirm).toHaveAttribute('aria-description', 'Pick a plane or a planar face for the section.');
  await userEvent.click(pick);
  expect(onPickFace).toHaveBeenCalledOnce();
  fireEvent.click(confirm);
  expect(onConfirm).not.toHaveBeenCalled();
});

it('keeps invalid offsets visible and blocks confirmation from mouse or Enter', async () => {
  const { onConfirm, rerenderPanel } = setup({ offset: '-', offsetProblem: 'Enter a valid section offset.' });
  const offset = screen.getByRole('textbox', { name: 'Offset' });
  expect(offset).toHaveValue('-');
  expect(offset).toHaveAttribute('aria-invalid', 'true');
  expect(offset).toHaveAttribute('aria-describedby', screen.getByRole('alert').id);
  const confirm = screen.getByRole('button', { name: 'Confirm section view' });
  expect(confirm).toHaveProperty('disabled', true);
  expect(confirm).toHaveAttribute('title', 'Enter a valid section offset.');
  fireEvent.click(confirm);
  offset.focus();
  await userEvent.keyboard('{Enter}{Enter}');
  expect(onConfirm).not.toHaveBeenCalled();
  await userEvent.fill(offset, '12');
  rerenderPanel({ offsetProblem: null });
  expect(offset).not.toHaveAttribute('aria-invalid');
  expect(screen.queryByRole('alert')).toBeNull();
  expect(confirm).toHaveProperty('disabled', false);
});

it('uses the existing first-Enter then confirmation behavior and ignores composing or repeated Enter', async () => {
  const { onConfirm } = setup({ offset: '-12' });
  const offset = screen.getByRole('textbox', { name: 'Offset' });
  offset.focus();
  await userEvent.keyboard('{Enter}');
  expect(onConfirm).not.toHaveBeenCalled();
  fireEvent.keyDown(offset, { key: 'Enter', repeat: true });
  fireEvent.keyDown(offset, { key: 'Enter', isComposing: true, keyCode: 229 });
  expect(onConfirm).not.toHaveBeenCalled();
  await userEvent.keyboard('{Enter}');
  await waitFor(() => expect(onConfirm).toHaveBeenCalledOnce());
});

it('keeps confirmation, Escape cancellation and turning off as distinct owner actions', async () => {
  const { onConfirm, onCancel, onTurnOff } = setup();
  await userEvent.click(screen.getByRole('button', { name: 'Confirm section view' }));
  await waitFor(() => expect(onConfirm).toHaveBeenCalledOnce());
  expect(onTurnOff).not.toHaveBeenCalled();
  expect(onCancel).not.toHaveBeenCalled();
  const offset = screen.getByRole('textbox', { name: 'Offset' });
  offset.focus();
  await userEvent.keyboard('{Escape}');
  expect(onCancel).toHaveBeenCalledOnce();
  await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
  expect(onCancel).toHaveBeenCalledTimes(2);
  await userEvent.click(screen.getByRole('button', { name: 'Turn off section view' }));
  expect(onTurnOff).toHaveBeenCalledOnce();
});

it('does not define design variables from a view-only offset field', async () => {
  const { define, onOffsetChange } = setup();
  const offset = screen.getByRole('textbox', { name: 'Offset' });
  await userEvent.fill(offset, '#span = 140mm');
  await userEvent.keyboard('{Enter}');
  await userEvent.click(screen.getByRole('button', { name: 'Flip plane' }));
  expect(onOffsetChange).toHaveBeenLastCalledWith('#span = 140mm');
  expect(define).not.toHaveBeenCalled();
  expect(screen.queryByRole('listbox', { name: 'Variables' })).toBeNull();
});

it('rejects stale plane selections and keeps the inspector within a narrow viewport', () => {
  setup({ planeId: 'removed-plane', onTurnOff: undefined }, 240);
  expect(screen.getByRole('button', { name: 'Confirm section view' })).toHaveProperty('disabled', true);
  expect(screen.queryByRole('button', { name: 'Turn off section view' })).toBeNull();
  const host = screen.getByTestId('section-host').getBoundingClientRect();
  const panel = screen.getByRole('dialog', { name: 'Section view' }).getBoundingClientRect();
  expect(panel.left).toBeGreaterThanOrEqual(host.left);
  expect(panel.right).toBeLessThanOrEqual(host.right);
  expect(panel.bottom).toBeLessThanOrEqual(host.bottom);
});

it('inherits the design length suffix while leaving explicitly typed units unchanged', async () => {
  setup({ offset: '1/4' }, 500, 'in');
  const offset = screen.getByRole('textbox', { name: 'Offset' });
  const field = offset.closest('.cad-section-value')!;
  expect(offset).toHaveValue('1/4');
  expect(field.querySelector('[aria-hidden="true"]')).toHaveTextContent('in');
  await userEvent.fill(offset, '9mm');
  expect(offset).toHaveValue('9mm');
  expect(field.querySelector('[aria-hidden="true"]')).toBeNull();
});
