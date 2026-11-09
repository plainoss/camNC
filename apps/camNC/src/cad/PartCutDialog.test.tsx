import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { cadVariableScope, createCadPart, createPlateDocument, type CadDocument, type CadPartCut } from '@wbcnc/cad';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PartCutDialog } from './PartCutDialog';

afterEach(cleanup);

function design(): CadDocument {
  const document = createPlateDocument({ width: 300, height: 600, thickness: 18 });
  document.parts[0]!.name = 'Side';
  return { ...document, parts: [...document.parts, { ...createCadPart('Back', 6), id: 'back' }] };
}

describe('the cut parts dialog', () => {
  it('picks clicked parts into the box being filled, and cuts the tools out of the targets with the design’s fit', async () => {
    const document = design();
    const side = document.parts[0]!.id;
    const onSave = vi.fn(),
      onPicked = vi.fn();
    const dialog = (pick: { partId: string; seq: number } | null) => (
      <PartCutDialog
        document={document}
        tool="back"
        pick={pick}
        variables={{ fit: { value: 0.3, kind: 'length' } }}
        onPicked={onPicked}
        onSave={onSave}
        onClose={() => {}}
      />
    );
    const view = render(dialog(null));
    expect(screen.getByLabelText('Clearance')).toHaveProperty('value', 'fit');
    // The selected part is the tool, and the targets box is the one being filled.
    expect(within(screen.getByRole('group', { name: 'Tools' })).getByText('Back')).toBeDefined();
    expect(screen.getByRole('group', { name: 'Targets' }).hasAttribute('data-active')).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Cut' }));
    await waitFor(() => expect(screen.getByRole('alert').textContent).toMatch(/at least one part/));
    view.rerender(dialog({ partId: side, seq: 1 }));
    expect(within(screen.getByRole('group', { name: 'Targets' })).getByText('Side')).toBeDefined();
    expect(onPicked).toHaveBeenLastCalledWith({ tools: ['back'], targets: [side] });
    fireEvent.click(screen.getByRole('button', { name: 'Cut' }));
    await waitFor(() =>
      expect(onSave).toHaveBeenCalledWith({
        tools: ['back'],
        targets: [side],
        clearance: 0.3,
        clearanceExpression: 'fit',
        split: undefined,
      })
    );
    // A second click on a picked part takes it out again, and its cross does too.
    view.rerender(dialog({ partId: side, seq: 2 }));
    expect(within(screen.getByRole('group', { name: 'Targets' })).queryByText('Side')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Take Back out of tools' }));
    expect(within(screen.getByRole('group', { name: 'Tools' })).queryByText('Back')).toBeNull();
  });

  it('won’t cut a part out of itself, or with less than no room', async () => {
    const document = design();
    const onSave = vi.fn();
    const dialog = (pick: { partId: string; seq: number } | null) => (
      <PartCutDialog document={document} tool="back" pick={pick} onSave={onSave} onClose={() => {}} />
    );
    const view = render(dialog(null));
    view.rerender(dialog({ partId: 'back', seq: 1 }));
    fireEvent.click(screen.getByRole('button', { name: 'Cut' }));
    await waitFor(() => expect(screen.getByRole('alert').textContent).toMatch(/itself/));
    view.rerender(dialog({ partId: document.parts[0]!.id, seq: 2 }));
    fireEvent.change(screen.getByLabelText('Clearance'), { target: { value: '-1' } });
    fireEvent.click(screen.getByRole('button', { name: 'Cut' }));
    await waitFor(() => expect(screen.getByRole('alert').textContent).toMatch(/less than nothing/));
    expect(onSave).not.toHaveBeenCalled();
  });

  it.each([
    ['Cut out', 'none', undefined],
    ['Half lap', 'half', 'half'],
    ['Finger joint', 'fingers', { fingers: 5 }],
  ] as const)('saves a new %s step', async (_label, value, split) => {
    const document = design();
    const onSave = vi.fn();
    const dialog = (pick: { partId: string; seq: number } | null) => (
      <PartCutDialog document={document} tool="back" pick={pick} onSave={onSave} onClose={() => {}} />
    );
    const view = render(dialog(null));
    expect(screen.getByLabelText('Joint')).toHaveProperty('value', 'none');
    expect(screen.queryByLabelText('Fingers')).toBeNull();
    view.rerender(dialog({ partId: document.parts[0]!.id, seq: 1 }));
    fireEvent.change(screen.getByLabelText('Joint'), { target: { value } });
    if (value === 'fingers') expect(screen.getByLabelText('Fingers')).toHaveProperty('value', '5');
    fireEvent.click(screen.getByRole('button', { name: 'Cut' }));
    await waitFor(() =>
      expect(onSave).toHaveBeenCalledWith({
        tools: ['back'],
        targets: [document.parts[0]!.id],
        clearance: 0.2,
        clearanceExpression: undefined,
        split,
      })
    );
  });

  it('uses the tools up when Keep tools is unticked', async () => {
    const document = design();
    const onSave = vi.fn();
    const dialog = (pick: { partId: string; seq: number } | null) => (
      <PartCutDialog document={document} tool="back" pick={pick} onSave={onSave} onClose={() => {}} />
    );
    const view = render(dialog(null));
    view.rerender(dialog({ partId: document.parts[0]!.id, seq: 1 }));
    expect(screen.getByRole('checkbox', { name: 'Keep tools' })).toHaveProperty('checked', true);
    fireEvent.click(screen.getByRole('checkbox', { name: 'Keep tools' }));
    fireEvent.click(screen.getByRole('button', { name: 'Cut' }));
    await waitFor(() => expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ consumeTools: true })));
  });

  function edit(split: CadPartCut['split'], withVariable = false) {
    const document = design();
    if (withVariable) document.variables = [{ id: 'count', name: 'count', expression: '7' }];
    const step: CadPartCut = { id: 'cut', tools: ['back'], targets: [document.parts[0]!.id], clearance: 0.2, split };
    document.partCuts = [step];
    const onSave = vi.fn();
    render(<PartCutDialog document={document} step={step} variables={cadVariableScope(document)} onSave={onSave} onClose={() => {}} />);
    return onSave;
  }

  it('saves a number variable as the finger count expression', async () => {
    const onSave = edit({ fingers: 5 }, true);
    fireEvent.change(screen.getByLabelText('Fingers'), { target: { value: '#count' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() =>
      expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ split: { fingers: 7, fingersExpression: '#count' } }))
    );
  });

  it.each(['2.5', '1', 'garbage', '2 mm'])('rejects an invalid finger count %s until it is corrected', async value => {
    const onSave = edit({ fingers: 5 });
    fireEvent.change(screen.getByLabelText('Fingers'), { target: { value } });
    expect(screen.getByRole('alert').textContent).toBeTruthy();
    expect(screen.getByLabelText('Fingers').getAttribute('aria-invalid')).toBe('true');
    expect(screen.getByRole('button', { name: 'Save' })).toHaveProperty('disabled', true);
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(onSave).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText('Fingers'), { target: { value: '6' } });
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.getByRole('button', { name: 'Save' })).toHaveProperty('disabled', false);
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ split: { fingers: 6 } })));
  });

  it.each([
    [{ fingers: 7 }, '7'],
    [{ fingers: 7, fingersExpression: '#count' }, '#count'],
  ] as const)('opens an existing finger split %j', (split, text) => {
    edit(split, true);
    expect(screen.getByLabelText('Joint')).toHaveProperty('value', 'fingers');
    expect(screen.getByRole('option', { name: 'Finger joint' })).toHaveProperty('selected', true);
    expect(screen.getByLabelText('Fingers')).toHaveProperty('value', text);
  });

  it.each(['half', { fingers: 5 }] as const)('clears an existing split %j when choosing Cut out', async split => {
    const onSave = edit(split);
    expect(screen.getByLabelText('Joint')).toHaveProperty('value', split === 'half' ? 'half' : 'fingers');
    fireEvent.change(screen.getByLabelText('Joint'), { target: { value: 'none' } });
    expect(screen.queryByLabelText('Fingers')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ split: undefined })));
  });
});
