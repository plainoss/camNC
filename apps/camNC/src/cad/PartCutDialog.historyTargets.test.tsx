import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { createCadPart, createPlateDocument, type CadPartCut } from '@wbcnc/cad';
import { afterEach, expect, it, vi } from 'vitest';
import { PartCutDialog } from './PartCutDialog';

afterEach(cleanup);
function history(exact: boolean) {
  const document = createPlateDocument({ width: 300, height: 200, thickness: 18 });
  const target = document.parts[0]!;
  target.name = 'Target';
  target.pattern = { id: 'repeat', axis: 'x', count: 2, spacing: 400 };
  target.copies = [{ id: 'repeat:1', pattern: 'repeat' }];
  const tool = createCadPart('Tool'),
    laterTarget = createCadPart('Later target');
  document.parts.push(tool, laterTarget);
  const step: CadPartCut = { id: 'earlier', tools: [tool.id], targets: [exact ? `${target.id}:repeat:1` : target.id], clearance: 0 };
  document.partCuts = [step, { id: 'later', tools: [target.id], targets: [laterTarget.id], consumeTools: true, clearance: 0 }];
  return { document, target, step };
}

it.each([false, true])('edits an earlier target consumed by a later cut (exact copy: %s)', async exact => {
  const { document, step } = history(exact),
    onSave = vi.fn(),
    before = JSON.stringify(document);
  render(<PartCutDialog document={document} step={step} onSave={onSave} onClose={() => {}} />);
  const dialog = screen.getByRole('dialog', { name: 'Cut parts' });
  fireEvent.change(within(dialog).getByRole('textbox', { name: 'Clearance' }), { target: { value: '0.4' } });
  fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
  expect(within(dialog).queryByRole('alert')).toBeNull();
  await waitFor(() => expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ targets: step.targets, clearance: 0.4 })));
  expect(JSON.stringify(document)).toBe(before);
});

it.each(['missing copy', 'suppressed copy', 'suppressed pattern', 'suppressed part', 'sketch'] as const)(
  'still refuses a %s target rather than treating every saved reference as available',
  async state => {
    const { document, target, step } = history(true),
      onSave = vi.fn();
    if (state === 'missing copy') target.copies = [];
    else if (state === 'suppressed copy') target.copies![0]!.suppressed = true;
    else if (state === 'suppressed pattern') target.pattern!.suppressed = true;
    else if (state === 'suppressed part') target.suppressed = true;
    else target.extrude = false;
    const before = JSON.stringify(document);
    render(<PartCutDialog document={document} step={step} onSave={onSave} onClose={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(screen.getByRole('alert').textContent).toMatch(/target copy or part is not present/i));
    expect(onSave).not.toHaveBeenCalled();
    expect(JSON.stringify(document)).toBe(before);
  }
);
