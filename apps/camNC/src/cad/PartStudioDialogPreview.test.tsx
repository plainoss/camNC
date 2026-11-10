import { createPlateDocument, setCadVariable, type CadDocument } from '@wbcnc/cad';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { VariableDialog } from './VariableDialog';
import { PlaneDialog } from './PlaneDialog';
import { MirrorDialog } from './MirrorDialog';
import { FilletDialog } from './FilletDialog';
import { PartCutDialog } from './PartCutDialog';

afterEach(cleanup);
const callbacks = () => ({ onPreview: vi.fn<(document: CadDocument | null) => void>(), onSave: vi.fn(), onCancel: vi.fn() });

it('previews variable expressions while typing without saving and discards invalid text', async () => {
  const made = setCadVariable(createPlateDocument(), { name: 'stock', expression: '18' });
  if ('error' in made) throw new Error(made.error);
  made.document.parts[0]!.thicknessExpression = '#stock';
  const handlers = callbacks();
  render(<VariableDialog document={made.document} variableId={made.id} {...handlers} />);
  fireEvent.change(screen.getByRole('textbox', { name: 'Value' }), { target: { value: '24' } });
  await waitFor(() => expect(handlers.onPreview.mock.calls.at(-1)?.[0]?.variables?.[0]?.expression).toBe('24'));
  expect(handlers.onPreview.mock.calls.at(-1)?.[0]?.parts[0]?.thickness).toBe(24);
  expect(handlers.onSave).not.toHaveBeenCalled();
  fireEvent.change(screen.getByRole('textbox', { name: 'Value' }), { target: { value: '24 +' } });
  await waitFor(() => expect(handlers.onPreview.mock.calls.at(-1)?.[0]).toBeNull());
});

it('previews a plane offset before blur with the same identity across edits and save', async () => {
  const handlers = callbacks();
  render(<PlaneDialog document={createPlateDocument()} preselected={{ plane: 'top' }} {...handlers} />);
  fireEvent.change(screen.getByRole('textbox', { name: 'Offset' }), { target: { value: '25' } });
  await waitFor(() => expect(handlers.onPreview.mock.calls.at(-1)?.[0]?.planes?.[0]?.offset).toBe(25));
  const id = handlers.onPreview.mock.calls.at(-1)![0]!.planes![0]!.id;
  fireEvent.change(screen.getByRole('textbox', { name: 'Offset' }), { target: { value: '40' } });
  await waitFor(() => expect(handlers.onPreview.mock.calls.at(-1)?.[0]?.planes?.[0]).toMatchObject({ id, offset: 40 }));
  fireEvent.click(screen.getByRole('button', { name: 'OK' }));
  await waitFor(() =>
    expect(handlers.onSave).toHaveBeenCalledWith(expect.objectContaining({ planes: [expect.objectContaining({ id, offset: 40 })] }))
  );
});

it('previews a mirror as soon as its plane is picked', async () => {
  const document = createPlateDocument(),
    handlers = callbacks();
  const pickPlane = vi.fn();
  render(<MirrorDialog document={document} partId={document.parts[0]!.id} pickPlane={pickPlane} {...handlers} />);
  pickPlane.mock.calls.at(-1)![0]({ plane: 'front' });
  await waitFor(() =>
    expect(handlers.onPreview.mock.calls.at(-1)?.[0]?.parts[0]?.copies).toEqual([
      expect.objectContaining({ mirror: { across: { plane: 'front' } } }),
    ])
  );
  expect(handlers.onSave).not.toHaveBeenCalled();
});

it('previews an edited fillet radius while typing', async () => {
  const document = createPlateDocument(),
    handlers = callbacks();
  document.parts[0]!.fillets = [{ id: 'round', radius: 5, corners: ['corner'] }];
  render(<FilletDialog document={document} partId={document.parts[0]!.id} filletId="round" {...handlers} />);
  fireEvent.change(screen.getByRole('textbox', { name: 'Radius' }), { target: { value: '8' } });
  await waitFor(() => expect(handlers.onPreview.mock.calls.at(-1)?.[0]?.parts[0]?.fillets?.[0]?.radius).toBe(8));
  expect(handlers.onSave).not.toHaveBeenCalled();
});

it('previews cut clearance without confirming the dialog', async () => {
  const document = createPlateDocument(),
    handlers = callbacks();
  const step = { id: 'cut', tools: ['tool'], targets: [document.parts[0]!.id], clearance: 0.2 };
  document.partCuts = [step];
  render(<PartCutDialog document={document} step={step} {...handlers} onClose={handlers.onCancel} />);
  fireEvent.change(screen.getByRole('textbox', { name: 'Clearance' }), { target: { value: '0.5' } });
  await waitFor(() => expect(handlers.onPreview.mock.calls.at(-1)?.[0]?.partCuts?.[0]?.clearance).toBe(0.5));
  expect(handlers.onSave).not.toHaveBeenCalled();
});
