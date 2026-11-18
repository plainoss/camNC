import { addCircle, createCadDocument, createCadPart, type CadDocument, type CadPart } from '@wbcnc/cad';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { FilletDialog } from './FilletDialog';
import type { CadConnectorPick } from './PartFeatureDialogs';

afterEach(cleanup);

/** A cup: a Ø77.8 × 20 cylinder with a Ø67.2 pocket 16 deep from its top, leaving a 5.3 rim and a 4 mm floor. */
function cup(): CadDocument {
  const body: CadPart = { ...createCadPart('Part 1', 20), id: 'body', placement: { position: [0, 0, 0], rotation: [0, 0, 0, 1] } };
  body.sketch = addCircle(body.sketch, { x: 0, y: 0, radius: 38.9 });
  const pocket: CadPart = { ...createCadPart('Pocket', 20), id: 'pocket', drawnOn: { on: { partId: 'body', face: 'top' }, offset: 0 } };
  pocket.sketch = addCircle(pocket.sketch, { x: 0, y: 0, radius: 33.6 });
  return { ...createCadDocument(), parts: [body, { ...pocket, remove: { depth: 16 } }] };
}

function setup() {
  const document = cup();
  const preview = vi.fn<(document: CadDocument | null) => void>(),
    save = vi.fn<(document: CadDocument) => void>();
  let picked: ((pick: CadConnectorPick) => void) | null = null;
  render(
    <FilletDialog
      document={document}
      pickEdge={callback => {
        picked = callback;
      }}
      onPreview={preview}
      onSave={save}
      onCancel={() => {}}
    />
  );
  const pick = (value: Omit<CadConnectorPick, 'partId'>) => act(() => picked?.({ partId: 'body', ...value }));
  const along = (radius: number, z: number) =>
    pick({
      point: [radius, 0, z],
      normal: [0, 0, 1],
      edge: { a: [radius, 0, z], b: [radius * Math.cos(0.05), radius * Math.sin(0.05), z] },
    });
  const radius = (value: string) => fireEvent.change(screen.getByRole('textbox', { name: 'Radius' }), { target: { value } });
  const latest = () => preview.mock.calls.at(-1)?.[0];
  return { pick, along, radius, latest, save };
}

it('picks a cup’s rim face as both of its edges, and refuses a radius the rim can’t take', async () => {
  const view = setup();
  view.pick({ point: [-26, 26, 20], normal: [0, 0, 1] });
  expect(screen.getByRole('list', { name: 'Selected edges' }).textContent).toMatch(/^Face of /);
  expect(view.latest()?.parts[0]?.fillets?.[0]?.rims).toEqual([
    { side: 'top', loops: ['outline', expect.stringContaining(':cut:')], face: true },
  ]);
  view.radius('3');
  // Rounds that run into each other turn the title red and say so on hovering it, with no line of text in the dialog.
  const title = () => screen.getByRole('dialog').querySelector('h3')!;
  expect(screen.queryByRole('alert')).toBeNull();
  expect(title().getAttribute('title')).toMatch(/did not regenerate properly: Overlapping fillets\.$/);
  view.radius('1');
  expect(title().getAttribute('title')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'OK' }));
  await waitFor(() => expect(view.save).toHaveBeenCalledTimes(1));
  expect(view.save.mock.calls[0]![0].parts[0]!.fillets).toMatchObject([{ radius: 1, corners: [], rims: [{ side: 'top', face: true }] }]);
});

it('picks the rim’s edges one by one, named for the steps that made them, and refuses the pocket’s inside edge', () => {
  const view = setup();
  view.along(33.6, 20);
  view.along(38.9, 20);
  const chips = screen.getByRole('list', { name: 'Selected edges' }).querySelectorAll('li');
  expect([...chips].map(chip => chip.querySelector('span')!.textContent)).toEqual(['Edge of Extrude · Pocket', 'Edge of Extrude 1']);
  expect(view.latest()?.parts[0]?.fillets?.[0]?.rims).toEqual([
    { side: 'top', loops: [expect.stringContaining(':cut:')] },
    { side: 'top', loops: ['outline'] },
  ]);
  // Picked again, an edge comes off the list.
  view.along(38.9, 20);
  expect(screen.getByRole('list', { name: 'Selected edges' }).querySelectorAll('li')).toHaveLength(1);
  view.along(33.6, 4);
  expect(screen.getByRole('alert').textContent).toMatch(/inside edge/);
  view.pick({ point: [0, 0, 4], normal: [0, 0, 1] });
  expect(screen.getByRole('alert').textContent).toMatch(/pocket’s floor/);
});
