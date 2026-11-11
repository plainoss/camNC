import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { addPartCopy, createCadPart, createPlateDocument, type CadDocument } from '@wbcnc/cad';
import { userEvent } from '@vitest/browser/context';
import { afterEach, expect, it, vi } from 'vitest';
import { PartsList } from '../PartsList';
import { saveShownState } from '../shownState';
import { StudioExportButton } from './StudioExportButton';
import '../cad.css';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

/** Captures what the browser is handed to download instead of saving it. */
function captureDownloads() {
  const files: { name: string; text: Promise<string> }[] = [];
  const blobs = new Map<string, Blob>();
  vi.spyOn(URL, 'createObjectURL').mockImplementation(blob => {
    const url = `blob:test/${blobs.size}`;
    blobs.set(url, blob as Blob);
    return url;
  });
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
    files.push({ name: this.download, text: blobs.get(this.href)!.text() });
  });
  return files;
}

/** A plate and a shelf, the plate with one copy beside it. */
function design(): CadDocument {
  const plate = createPlateDocument({ name: 'Box', width: 120, height: 80, thickness: 18 });
  const shelf = {
    ...createCadPart('Shelf', 12),
    placement: { position: [0, 200, 0] as [number, number, number], rotation: [0, 0, 0, 1] as [number, number, number, number] },
  };
  const withShelf = { ...plate, parts: [...plate.parts, shelf] };
  return addPartCopy(withShelf, plate.parts[0]!.id, { offset: { position: [300, 0, 0], rotation: [0, 0, 0, 1] } }).document;
}
const products = (text: string) => [...text.matchAll(/=PRODUCT\('([^']*)'/g)].map(match => match[1]);

it('exports one part, or one copy, from its row in the Parts list', async () => {
  const document = design();
  const files = captureDownloads();
  const [plate] = document.parts;
  const copyId = plate!.copies![0]!.id;
  render(
    <PartsList
      rows={[
        { key: plate!.id, part: plate!, name: plate!.name },
        { key: `${plate!.id}/${copyId}`, part: plate!, name: 'Plate copy' },
      ]}
      document={document}
      hidden={false}
      studio
      selectedKey={undefined}
      hiddenParts={new Set()}
      onToggleHidden={() => undefined}
      trouble={() => null}
      onPick={() => undefined}
      onRename={() => undefined}
    />
  );
  fireEvent.contextMenu(screen.getByRole('button', { name: new RegExp(`^${plate!.name}(?! copy)`) }), { clientX: 10, clientY: 10 });
  await userEvent.click(screen.getByRole('menuitem', { name: 'Export…' }));
  const dialog = screen.getByRole('dialog', { name: 'Export parts' });
  expect(within(dialog).getByRole<HTMLSelectElement>('combobox', { name: 'Format' }).value).toBe('step');
  expect(within(dialog).queryByRole('checkbox', { name: 'Include construction geometry' })).toBeNull();
  await userEvent.click(within(dialog).getByRole('button', { name: 'Download' }));
  expect(files.map(file => file.name)).toEqual([`${plate!.name}.step`]);
  expect(products(await files[0]!.text)).toEqual([plate!.name]);

  fireEvent.contextMenu(screen.getByRole('button', { name: /^Plate copy/ }), { clientX: 10, clientY: 10 });
  await userEvent.click(screen.getByRole('menuitem', { name: 'Export…' }));
  await userEvent.click(within(screen.getByRole('dialog', { name: 'Export parts' })).getByRole('button', { name: 'Download' }));
  const copy = await files[1]!.text;
  expect(files[1]!.name).toBe('Plate copy.step');
  expect(products(copy)).toHaveLength(1);
  // The copy sits 300 mm along x.
  expect(copy).toMatch(/CARTESIAN_POINT\('',\(3\d\d\./);
});

it('exports every shown part of the studio from Export…, in the unit picked', async () => {
  const document = design();
  const files = captureDownloads();
  const shelf = document.parts[1]!;
  saveShownState(document.id, { hiddenParts: [shelf.id], featureVisibility: {} });
  render(<StudioExportButton design={() => document} />);
  await userEvent.click(screen.getByRole('button', { name: 'Export…' }));
  const dialog = screen.getByRole('dialog', { name: 'Export parts' });
  await userEvent.selectOptions(within(dialog).getByRole('combobox', { name: 'Units' }), 'in');
  await userEvent.click(within(dialog).getByRole('button', { name: 'Download' }));
  expect(files.map(file => file.name)).toEqual(['Box.step']);
  const text = await files[0]!.text;
  // The plate and its copy; the hidden shelf is left out.
  expect(products(text)).toHaveLength(2);
  expect(products(text)).not.toContain('Shelf');
  expect(text).toContain("CONVERSION_BASED_UNIT('INCH'");
});

it('names the parts a studio export leaves out, and downloads the rest only when asked again', async () => {
  const source = design();
  const broken = { ...createCadPart('Broken', 12), sketch: { id: 'broken-sketch', entities: [], constraints: [] } };
  const document = { ...source, parts: [...source.parts, broken] };
  const files = captureDownloads();
  render(<StudioExportButton design={() => document} />);
  await userEvent.click(screen.getByRole('button', { name: 'Export…' }));
  const dialog = screen.getByRole('dialog', { name: 'Export parts' });
  await userEvent.click(within(dialog).getByRole('button', { name: 'Download' }));
  expect(within(dialog).getByRole('alert').textContent).toMatch(/left out:.*Broken/);
  expect(files).toEqual([]);
  await userEvent.click(within(dialog).getByRole('button', { name: 'Download without them' }));
  expect(files.map(file => file.name)).toEqual(['Box.step']);
  expect(products(await files[0]!.text)).not.toContain('Broken');
});

it('says why when there is nothing to export', async () => {
  const document = { ...createPlateDocument({ name: 'Empty' }), parts: [] };
  const files = captureDownloads();
  render(<StudioExportButton design={() => document} />);
  await userEvent.click(screen.getByRole('button', { name: 'Export…' }));
  const dialog = screen.getByRole('dialog', { name: 'Export parts' });
  await userEvent.click(within(dialog).getByRole('button', { name: 'Download' }));
  expect(within(dialog).getByRole('alert').textContent).toMatch(/no parts/i);
  expect(files).toEqual([]);
});
