import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { SvgImportDialog } from './SvgImportDialog';
const rectangle =
  '<svg xmlns="http://www.w3.org/2000/svg" width="100mm" height="50mm" viewBox="0 0 100 50"><rect width="100" height="50"/></svg>';
afterEach(cleanup);
function upload(source = rectangle, name = 'tray.svg') {
  const transfer = new DataTransfer();
  transfer.items.add(new File([source], name, { type: 'image/svg+xml' }));
  const input = screen.getByLabelText('SVG file') as HTMLInputElement;
  input.files = transfer.files;
  fireEvent.change(input);
}
it('previews a geometry-only import and returns explicit placement without editing a design', async () => {
  const onImport = vi.fn(),
    onClose = vi.fn();
  render(<SvgImportDialog onImport={onImport} onClose={onClose} />);
  upload();
  await screen.findByLabelText('Imported geometry preview');
  expect(onImport).not.toHaveBeenCalled();
  fireEvent.change(screen.getByLabelText('Width'), { target: { value: '280' } });
  fireEvent.change(screen.getByLabelText('Height'), { target: { value: '190' } });
  expect(screen.getByText('280.000 × 140.000 mm · 1 closed contours')).toBeDefined();
  fireEvent.click(screen.getByLabelText('Keep proportions (fit within width and height)'));
  expect(screen.getByText('280.000 × 190.000 mm · 1 closed contours')).toBeDefined();
  fireEvent.click(screen.getByRole('button', { name: 'Review import' }));
  await waitFor(() => expect(onImport).toHaveBeenCalledTimes(1));
  expect(onImport.mock.calls[0][0]).toMatchObject({
    source: rectangle,
    name: 'tray.svg',
    placement: { width: 280, height: 190, at: [0, 0], preserveAspect: false },
  });
  await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
});
it('rejects executable SVG without rendering it', async () => {
  const onImport = vi.fn();
  render(<SvgImportDialog onImport={onImport} onClose={() => {}} />);
  upload('<svg xmlns="http://www.w3.org/2000/svg"><script>window.bad=true</script></svg>');
  await screen.findByText('Unsupported SVG element script.');
  expect(document.querySelector('.cad-svg-import script')).toBeNull();
  expect(onImport).not.toHaveBeenCalled();
  expect(screen.queryByLabelText('Imported geometry preview')).toBeNull();
});
it('ignores stale asynchronous file reads after a newer selection', async () => {
  let finish: ((source: string) => void) | undefined;
  render(<SvgImportDialog onImport={() => {}} onClose={() => {}} />);
  const first = new File([''], 'old.svg', { type: 'image/svg+xml' });
  Object.defineProperty(first, 'text', {
    value: () =>
      new Promise<string>(resolve => {
        finish = resolve;
      }),
  });
  fireEvent.change(screen.getByLabelText('SVG file'), { target: { files: [first] } });
  upload(rectangle, 'new.svg');
  await screen.findByLabelText('Imported geometry preview');
  finish!('<svg>broken</svg>');
  await waitFor(() => expect((screen.getByLabelText('Width') as HTMLInputElement).value).toBe('100'));
  expect(screen.queryByText(/Expected an SVG root/)).toBeNull();
});
