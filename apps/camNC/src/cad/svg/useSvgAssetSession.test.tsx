import { StrictMode, useEffect } from 'react';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import { documentSvgAssets, svgAssetsForDocument } from './svgAssets';
import { useSvgAssetSession } from './useSvgAssetSession';

const source = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 10"><rect width="20" height="10"/></svg>';
function Editor({ id, dock = false }: { id: string; dock?: boolean }) {
  useSvgAssetSession(id);
  return <section>{dock && <span>Assistant dock</span>}</section>;
}
afterEach(async () => {
  cleanup();
  await Promise.resolve();
  documentSvgAssets.clear();
});

it('releases imported source across more than sixteen sequential document sessions', async () => {
  const view = render(<Editor id="doc-0" />);
  for (let i = 0; i < 32; i++) {
    const store = svgAssetsForDocument(`doc-${i}`),
      asset = store.register(source);
    expect(store.get(asset.handle).contours).toHaveLength(1);
    view.rerender(<Editor id={`doc-${i + 1}`} />);
    await waitFor(() => expect(store.list()).toEqual([]));
  }
  view.unmount();
});

it('retains manual SVG assets when the assistant dock closes and clears them when the document leaves', async () => {
  const view = render(<Editor id="manual-document" dock />),
    store = svgAssetsForDocument('manual-document'),
    asset = store.register(source, 'Manual outline');
  expect(screen.getByText('Assistant dock')).toBeDefined();
  view.rerender(<Editor id="manual-document" />);
  await Promise.resolve();
  expect(screen.queryByText('Assistant dock')).toBeNull();
  expect(svgAssetsForDocument('manual-document').get(asset.handle).contours).toHaveLength(1);
  view.unmount();
  await waitFor(() => expect(store.list()).toEqual([]));
  expect(() => svgAssetsForDocument('manual-document').get(asset.handle)).toThrow(/Unknown SVG/);
});

it('keeps shared source until the final view of a document unmounts', async () => {
  const first = render(<Editor id="shared-document" />),
    second = render(<Editor id="shared-document" />);
  const store = svgAssetsForDocument('shared-document'),
    asset = store.register(source);
  first.unmount();
  await Promise.resolve();
  expect(store.get(asset.handle).contours).toHaveLength(1);
  second.unmount();
  await waitFor(() => expect(store.list()).toEqual([]));
});

it('does not discard assets during StrictMode effect cleanup and replay', async () => {
  let handle = '';
  function ImportingEditor() {
    useSvgAssetSession('strict-document');
    useEffect(() => {
      handle = svgAssetsForDocument('strict-document').register(source).handle;
    }, []);
    return null;
  }
  const view = render(
    <StrictMode>
      <ImportingEditor />
    </StrictMode>
  );
  await Promise.resolve();
  const store = svgAssetsForDocument('strict-document');
  expect(store.list()).toHaveLength(1);
  expect(store.get(handle).contours).toHaveLength(1);
  view.unmount();
  await waitFor(() => expect(store.list()).toEqual([]));
});
