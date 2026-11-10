import { createPlateDocument, parseCadDocument } from '@wbcnc/cad';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { SvgInsert } from './SvgInsert';
import { documentSvgAssets, svgAssetsForDocument } from './svgAssets';
const source =
  '<svg xmlns="http://www.w3.org/2000/svg" width="100mm" height="50mm" viewBox="0 0 100 50"><ellipse cx="50" cy="25" rx="50" ry="25"/></svg>';
afterEach(() => {
  cleanup();
  documentSvgAssets.clear();
});
function upload() {
  const transfer = new DataTransfer();
  transfer.items.add(new File([source], 'tray.svg', { type: 'image/svg+xml' }));
  const input = screen.getByLabelText('SVG file') as HTMLInputElement;
  input.files = transfer.files;
  fireEvent.change(input);
}
it('offers a checked proposal while retaining source locally without applying it', async () => {
  const document = createPlateDocument(),
    before = structuredClone(document),
    onProposal = vi.fn();
  render(
    <details open>
      <summary>Insert</summary>
      <SvgInsert document={document} onProposal={onProposal} />
    </details>
  );
  fireEvent.click(screen.getByRole('button', { name: 'SVG…' }));
  await screen.findByRole('dialog', { name: 'Import SVG into sketch' });
  upload();
  await screen.findByLabelText('Imported geometry preview');
  fireEvent.change(screen.getByLabelText('Width'), { target: { value: '280' } });
  fireEvent.change(screen.getByLabelText('Height'), { target: { value: '190' } });
  fireEvent.click(screen.getByLabelText('Keep proportions (fit within width and height)'));
  fireEvent.click(screen.getByRole('button', { name: 'Review import' }));
  await waitFor(() => expect(onProposal).toHaveBeenCalledTimes(1), { timeout: 20_000 });
  const proposal = onProposal.mock.calls[0][0];
  expect(proposal.base).toEqual(before);
  expect(document).toEqual(before);
  expect(proposal.document.id).toBe(document.id);
  expect(proposal.document.parts).toHaveLength(2);
  const reloaded = parseCadDocument(JSON.parse(JSON.stringify(proposal.document)));
  expect(reloaded.parts[1].sketch.entities.filter(e => e.type === 'conic')).toHaveLength(4);
  expect(reloaded.parts[1].sketch.entities.map(e => e.id)).toEqual(
    proposal.document.parts[1].sketch.entities.map((e: { id: string }) => e.id)
  );
  const store = svgAssetsForDocument(document.id);
  expect(store.list()).toHaveLength(1);
  expect(store.list()[0].name).toBe('tray.svg');
  expect(JSON.stringify(proposal.document)).not.toContain('<svg');
}, 30_000);
it('disables import during an active edit', () => {
  render(<SvgInsert document={createPlateDocument()} disabled onProposal={() => {}} />);
  expect((screen.getByRole('button', { name: 'SVG…' }) as HTMLButtonElement).disabled).toBe(true);
});
