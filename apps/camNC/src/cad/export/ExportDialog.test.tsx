import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { createPlateDocument, type CadDocument } from '@wbcnc/cad';
import { userEvent } from '@vitest/browser/context';
import { afterEach, expect, it, vi } from 'vitest';
import { StudioFeatureList } from '../StudioFeatureList';
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

function setup(document: CadDocument) {
  const onAction = vi.fn();
  render(
    <div className="cad-editor" style={{ width: 280 }}>
      <StudioFeatureList
        document={document}
        currentDocument={{ current: document }}
        commit={() => {}}
        onRefusal={() => {}}
        workspace
        selectedPartId={null}
        onSelect={() => {}}
        onAction={onAction}
      />
    </div>
  );
  return onAction;
}

it('exports a sketch from its row as DXF in the design’s unit, or as SVG in another', async () => {
  const document = { ...createPlateDocument({ width: 120, height: 80, thickness: 18 }), lengthUnit: 'in' as const };
  const onAction = setup(document);
  const files = captureDownloads();
  const row = screen.getByRole('button', { name: /^Sketch · / });
  const rowName = 'Sketch · Plate';

  fireEvent.contextMenu(row, { clientX: 10, clientY: 10 });
  await userEvent.click(screen.getByRole('menuitem', { name: 'Export as DXF/SVG…' }));
  const dialog = screen.getByRole('dialog', { name: 'Export sketch' });
  expect(within(dialog).getByRole<HTMLInputElement>('textbox', { name: 'File name' }).value).toBe(rowName);
  expect(within(dialog).getByRole<HTMLSelectElement>('combobox', { name: 'Units' }).value).toBe('in');
  expect(within(dialog).getByRole('checkbox', { name: 'Export splines as polylines' })).toBeTruthy();
  await userEvent.click(within(dialog).getByRole('button', { name: 'Download' }));
  expect(screen.queryByRole('dialog', { name: 'Export sketch' })).toBeNull();
  expect(files.map(file => file.name)).toEqual([`${rowName}.dxf`]);
  const dxf = await files[0]!.text;
  expect(dxf).toMatch(/\$INSUNITS\n70\n1\n/);
  // A 120 mm wide plate is 4.724… in.
  expect(dxf).toMatch(/\n11\n4\.72440944\d*\n/);

  fireEvent.contextMenu(row, { clientX: 10, clientY: 10 });
  await userEvent.click(screen.getByRole('menuitem', { name: 'Export as DXF/SVG…' }));
  const again = screen.getByRole('dialog', { name: 'Export sketch' });
  await userEvent.selectOptions(within(again).getByRole('combobox', { name: 'Format' }), 'svg');
  await userEvent.selectOptions(within(again).getByRole('combobox', { name: 'Units' }), 'mm');
  expect(within(again).queryByRole('checkbox', { name: 'Export splines as polylines' })).toBeNull();
  await userEvent.click(within(again).getByRole('button', { name: 'Download' }));
  expect(files.map(file => file.name)).toEqual([`${rowName}.dxf`, `${rowName}.svg`]);
  expect(await files[1]!.text).toMatch(/<svg [^>]*width="120mm" height="80mm"/);
  // The list's own actions don't see the export.
  expect(onAction).not.toHaveBeenCalled();
});

it('offers export only on sketch rows', async () => {
  setup(createPlateDocument({ width: 120, height: 80, thickness: 18 }));
  fireEvent.contextMenu(screen.getByRole('button', { name: /^Extrude · / }), { clientX: 10, clientY: 10 });
  expect(screen.getByRole('menuitem', { name: 'Roll to here' })).toBeTruthy();
  expect(screen.queryByRole('menuitem', { name: 'Export as DXF/SVG…' })).toBeNull();
});
