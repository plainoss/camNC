import type { ComponentProps } from 'react';
import { createPlateDocument } from '@wbcnc/cad';
import { act, cleanup, render, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { StudioStepDialogs } from './StudioStepDialogs';

afterEach(cleanup);

it('forwards a mirror plane pick through the shared dialog wrapper into its live candidate', async () => {
  const document = createPlateDocument();
  const setDirectionPicker = vi.fn<ComponentProps<typeof StudioStepDialogs>['setDirectionPicker']>();
  const onPreview = vi.fn<ComponentProps<typeof StudioStepDialogs>['onPreview']>();
  const commit = vi.fn();
  render(
    <StudioStepDialogs
      document={document}
      variables={{}}
      transform={null}
      variable={null}
      plane={null}
      mirror={{ partId: document.parts[0]!.id }}
      fillet={null}
      commit={commit}
      onPreview={onPreview}
      onConnectorsChange={() => {}}
      setTransform={() => {}}
      setVariable={() => {}}
      setPlane={() => {}}
      setMirror={() => {}}
      setFillet={() => {}}
      setDirectionPicker={setDirectionPicker}
      pickPoint={() => {}}
    />
  );
  const pick = setDirectionPicker.mock.calls.at(-1)?.[0];
  expect(pick).toBeTypeOf('function');
  act(() => pick?.({ plane: 'front' }));
  await waitFor(() => expect(onPreview.mock.calls.at(-1)?.[0]?.parts[0]?.copies?.[0]?.mirror).toEqual({ across: { plane: 'front' } }));
  expect(commit).not.toHaveBeenCalled();
});
