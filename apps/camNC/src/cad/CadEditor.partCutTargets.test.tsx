import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react';
import { userEvent } from '@vitest/browser/context';
import {
  addPartCut,
  addRectangle,
  createCadDocument,
  createCadPart,
  evaluateCadDocument,
  evaluatedPartCopy,
  setPartPattern,
  type CadDocument,
} from '@wbcnc/cad';
import { endCadSession } from '@wbcnc/cad-editor/session';
import { afterEach, expect, it, vi } from 'vitest';
import { ModelViewport } from '@/cam/model/ModelViewport';
import { CadEditor } from './CadEditor';

vi.mock('@/cam/model/ModelViewport', { spy: true });
const sessions: string[] = [];
afterEach(() => {
  cleanup();
  sessions.splice(0).forEach(endCadSession);
});

function source() {
  const base = createCadPart('Base', 12),
    divider = createCadPart('Divider', 12);
  base.sketch = addRectangle(base.sketch, { x: 0, y: 0, width: 300, height: 200, dimensioned: true, positioned: true });
  base.drawnOn = { on: { plane: 'top' }, offset: 0 };
  divider.sketch = addRectangle(divider.sketch, { x: 20, y: 8, width: 160, height: 72, dimensioned: true, positioned: true });
  divider.drawnOn = { on: { plane: 'right' }, offset: 70 };
  const document = setPartPattern({ ...createCadDocument(), parts: [base, divider] }, divider.id, { axis: 'x', count: 3, spacing: 80 });
  return addPartCut(document, [base.id], [divider.id], { value: 0 }).document;
}

it.each(['list', 'viewport'] as const)(
  'cuts only the exact target picked in the %s and reopens its saved identity',
  async where => {
    const document = source(),
      changed = vi.fn<(document: CadDocument) => void>();
    sessions.push(document.id);
    render(
      <div style={{ height: 700, display: 'flex' }}>
        <CadEditor document={document} startIn3D onDraftChange={changed} onFinish={async () => {}} onCancel={() => {}} />
      </div>
    );
    const latest = () => changed.mock.calls.at(-1)?.[0] ?? document;
    const settled = () =>
      waitFor(() => expect(globalThis.document.querySelector('.cad-editor')!.getAttribute('aria-busy')).toBe('false'), { timeout: 20_000 });
    // The lazy viewport must mount before this test exercises physical-instance picks.
    await screen.findByTestId('workspace-3d', {}, { timeout: 20_000 });
    await settled();
    await userEvent.dblClick(
      within(screen.getByRole('region', { name: 'Features' })).getByRole('button', { name: /^Cut Divider with Base/ })
    );
    const dialog = await screen.findByRole('dialog', { name: 'Cut parts' });
    await userEvent.click(within(dialog).getByRole('button', { name: 'Take Divider out of targets' }));
    await userEvent.click(within(dialog).getByRole('group', { name: 'Targets' }));
    const divider = latest().parts[1]!,
      copy = divider.copies![1]!,
      key = `${divider.id}/${copy.id}`;
    const props = () =>
      vi
        .mocked(ModelViewport)
        .mock.calls.filter(call => call[0].instanceIds?.includes(key))
        .at(-1)![0];
    if (where === 'list')
      await userEvent.click(within(screen.getByRole('list', { name: 'Parts' })).getByRole('button', { name: 'Divider 3' }));
    else {
      await waitFor(() => expect(props().instanceIds).toContain(key));
      act(() => props().onSelect?.(divider.id, props().instanceIds!.indexOf(key)));
    }
    expect(within(within(dialog).getByRole('group', { name: 'Targets' })).getByText('Divider 3')).toBeDefined();
    await waitFor(() => expect(props().selectedIndexes).toEqual([0, props().instanceIds!.indexOf(key)]));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Cut parts' })).toBeNull());
    await settled();
    expect(latest().partCuts![0]!.targets).toEqual([`${divider.id}:${copy.id}`]);
    const evaluated = evaluateCadDocument(latest()).parts.find(part => part.partId === divider.id)!;
    expect(evaluated.cuts ?? []).toEqual([]);
    expect(evaluatedPartCopy(evaluated, divider.copies![0]!).cuts ?? []).toEqual([]);
    expect(evaluated.copyCuts?.[copy.id]?.[0]?.opening).toEqual({ x0: 20, y0: 8, x1: 180, y1: 12 });
    const feature = within(screen.getByRole('region', { name: 'Features' })).getByRole('button', { name: /^Cut Divider 3 with Base/ });
    await userEvent.click(feature);
    await waitFor(() => expect(props().selectedIndexes).toEqual([props().instanceIds!.indexOf(key)]));
    await userEvent.dblClick(feature);
    expect(within(screen.getByRole('group', { name: 'Targets' })).getByText('Divider 3')).toBeDefined();
  },
  40_000
);
