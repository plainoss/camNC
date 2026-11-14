import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { addCircle, cadVariableScope, createCadPart, createPlateDocument, type CadDocument } from '@wbcnc/cad';
import { afterEach, expect, it, vi } from 'vitest';
import { LinearPatternDialog } from './LinearPatternDialog';
import type { CadConnectorPick } from './PartFeatureDialogs';

afterEach(cleanup);

function design(): CadDocument {
  const document = createPlateDocument({ width: 100, height: 40, thickness: 10 });
  const board = document.parts[0]!;
  const pocket = {
    ...createCadPart('Part 2', 10),
    id: 'pocket',
    remove: { depth: 5 },
    drawnOn: { on: { partId: board.id, face: 'top' as const }, offset: 0 },
  };
  pocket.sketch = addCircle(pocket.sketch, { x: 20, y: 20, radius: 5 });
  return { ...document, parts: [board, pocket] };
}

it('patterns a picked Remove along a picked edge, positive along it, Distance apart, Instance count times', async () => {
  const document = design();
  const onChange = vi.fn(),
    onOk = vi.fn();
  let picker: ((pick: CadConnectorPick) => void) | null = null;
  const view = (pick: { partId: string; seq: number } | null) => (
    <LinearPatternDialog
      document={document}
      part={document.parts[0]!}
      variables={cadVariableScope(document)}
      onChange={onChange}
      onOk={onOk}
      onCancel={() => {}}
      pickPoint={picked => (picker = picked)}
      partPicks={{ pick, select: () => {} }}
    />
  );
  const { rerender } = render(view(null));
  expect(screen.getByRole('combobox', { name: 'Pattern type' })).toHaveValue('part');
  expect((screen.getByRole('textbox', { name: 'Distance' }) as HTMLInputElement).value).toBe('25');
  expect((screen.getByRole('textbox', { name: 'Instance count' }) as HTMLInputElement).value).toBe('2');
  fireEvent.change(screen.getByRole('combobox', { name: 'Pattern type' }), { target: { value: 'feature' } });
  rerender(view({ partId: 'pocket', seq: 1 }));
  await waitFor(() => expect(screen.getByRole('group', { name: 'Features to pattern' }).textContent).toMatch(/Extrude 2/));
  fireEvent.click(screen.getByRole('group', { name: 'Direction' }));
  // The edge found from its far end still points along +x.
  picker!({ partId: document.parts[0]!.id, point: [50, 0, 10], normal: [0, 0, 1], edge: { a: [100, 0, 10], b: [0, 0, 10] } });
  fireEvent.change(screen.getByRole('textbox', { name: 'Distance' }), { target: { value: '30' } });
  fireEvent.change(screen.getByRole('textbox', { name: 'Instance count' }), { target: { value: '3' } });
  fireEvent.click(screen.getByRole('button', { name: 'OK' }));
  await waitFor(() => expect(onOk).toHaveBeenCalled());
  const saved = onChange.mock.calls[0]![0](document) as CadDocument;
  expect(saved.parts[1]!.pattern).toMatchObject({ vector: [1, 0, 0], spacing: 30, count: 3 });
});
