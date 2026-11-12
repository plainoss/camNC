import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { cadVariableScope, createCadPart, createPlateDocument, type CadDocument, type CadPartCut } from '@wbcnc/cad';
import { afterEach, expect, it, vi } from 'vitest';
import { PartCutDialog } from './PartCutDialog';
import { ReliefBitContext } from './reliefBit';

afterEach(cleanup);

function design(): CadDocument {
  const document = createPlateDocument({ width: 200, height: 200, thickness: 18 });
  document.parts[0]!.name = 'Seat';
  return { ...document, parts: [...document.parts, { ...createCadPart('Tenon', 18), id: 'tenon' }] };
}

const step = (seat: string, cornerRelief?: CadPartCut['cornerRelief']): CadPartCut => ({
  id: 'mortise',
  tools: ['tenon'],
  targets: [seat],
  clearance: 0,
  ...(cornerRelief !== undefined && { cornerRelief }),
});

it('saves a per-step dogbone with its cutter diameter variable, and previews it at the raised reader version', async () => {
  const base = design();
  const document = { ...base, partCuts: [step(base.parts[0]!.id)], variables: [{ id: 'cutter', name: 'cutter', expression: '6 mm' }] };
  const onSave = vi.fn(),
    onPreview = vi.fn();
  render(
    <PartCutDialog
      document={document}
      step={step(document.parts[0]!.id)}
      variables={cadVariableScope(document)}
      onSave={onSave}
      onPreview={onPreview}
      onClose={() => {}}
    />
  );
  expect((screen.getByRole('combobox', { name: 'Corner relief' }) as HTMLSelectElement).value).toBe('inherit');
  fireEvent.change(screen.getByRole('combobox', { name: 'Corner relief' }), { target: { value: 'dogbone' } });
  fireEvent.change(screen.getByRole('textbox', { name: 'Cutter diameter' }), { target: { value: 'cutter' } });
  await waitFor(() => expect(onPreview).toHaveBeenLastCalledWith(expect.objectContaining({ version: 5 })));
  fireEvent.click(screen.getByRole('button', { name: 'Save' }));
  await waitFor(() =>
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ cornerRelief: { diameter: 6, diameterExpression: 'cutter' } }))
  );
});

it('keeps an explicit Off, and clears an override when set back to Inherit', async () => {
  const document = design(),
    seat = document.parts[0]!.id,
    onSave = vi.fn();
  render(<PartCutDialog document={document} step={step(seat, null)} onSave={onSave} onClose={() => {}} />);
  expect((screen.getByRole('combobox', { name: 'Corner relief' }) as HTMLSelectElement).value).toBe('off');
  fireEvent.click(screen.getByRole('button', { name: 'Save' }));
  await waitFor(() => expect(onSave).toHaveBeenLastCalledWith(expect.objectContaining({ cornerRelief: null })));
  fireEvent.change(screen.getByRole('combobox', { name: 'Corner relief' }), { target: { value: 'inherit' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save' }));
  await waitFor(() => expect(onSave).toHaveBeenLastCalledWith(expect.objectContaining({ cornerRelief: undefined })));
});

it('refuses a dogbone without a positive cutter diameter', async () => {
  const document = design(),
    onSave = vi.fn();
  render(<PartCutDialog document={document} step={step(document.parts[0]!.id, { diameter: 6 })} onSave={onSave} onClose={() => {}} />);
  fireEvent.change(screen.getByRole('textbox', { name: 'Cutter diameter' }), { target: { value: '0' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save' }));
  await waitFor(() => expect(screen.getByRole('alert').textContent).toMatch(/cutter diameter greater than zero/));
  expect(onSave).not.toHaveBeenCalled();
});

it('previews a new step with an Off override at the raised reader version', async () => {
  const document = design(),
    onPreview = vi.fn();
  const dialog = (pick: { partId: string; seq: number } | null) => (
    <PartCutDialog document={document} tool="tenon" pick={pick} onPreview={onPreview} onSave={() => {}} onClose={() => {}} />
  );
  const view = render(dialog(null));
  view.rerender(dialog({ partId: document.parts[0]!.id, seq: 1 }));
  fireEvent.change(screen.getByRole('combobox', { name: 'Corner relief' }), { target: { value: 'off' } });
  await waitFor(() =>
    expect(onPreview).toHaveBeenLastCalledWith(
      expect.objectContaining({ version: 5, partCuts: [expect.objectContaining({ cornerRelief: null })] })
    )
  );
});

it('starts a new dogbone at the bit the job is planned with', async () => {
  const document = design(),
    onSave = vi.fn();
  const view = render(
    <PartCutDialog document={document} step={step(document.parts[0]!.id)} reliefBit={8} onSave={onSave} onClose={() => {}} />
  );
  fireEvent.change(screen.getByRole('combobox', { name: 'Corner relief' }), { target: { value: 'dogbone' } });
  expect((screen.getByRole('textbox', { name: 'Cutter diameter' }) as HTMLInputElement).value).toBe('8');
  fireEvent.click(screen.getByRole('button', { name: 'Save' }));
  await waitFor(() => expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ cornerRelief: { diameter: 8 } })));
  view.unmount();
  // The design route provides the job's planned bit.
  const planned = render(
    <ReliefBitContext.Provider value={6}>
      <PartCutDialog document={document} step={step(document.parts[0]!.id)} onSave={() => {}} onClose={() => {}} />
    </ReliefBitContext.Provider>
  );
  fireEvent.change(screen.getByRole('combobox', { name: 'Corner relief' }), { target: { value: 'dogbone' } });
  expect((screen.getByRole('textbox', { name: 'Cutter diameter' }) as HTMLInputElement).value).toBe('6');
  planned.unmount();
  // Outside a job, the app's default bit.
  render(<PartCutDialog document={document} step={step(document.parts[0]!.id)} onSave={() => {}} onClose={() => {}} />);
  fireEvent.change(screen.getByRole('combobox', { name: 'Corner relief' }), { target: { value: 'dogbone' } });
  expect((screen.getByRole('textbox', { name: 'Cutter diameter' }) as HTMLInputElement).value).toBe('3.175');
});
