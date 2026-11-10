import { createPlateDocument } from '@wbcnc/cad';
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { useExtrudeDepth } from './useExtrudeDepth';
afterEach(cleanup);

it('discards cancelled depth previews and expressions without publishing history', () => {
  const source = createPlateDocument({ width: 60, height: 80, thickness: 25 });
  const id = source.parts[0]!.id;
  source.parts[0]!.thicknessExpression = '25';
  const commit = vi.fn();
  const { result, rerender } = renderHook(({ document, partId }) => useExtrudeDepth(document, partId, commit), {
    initialProps: { document: source, partId: id as string | undefined },
  });
  const control = () => result.current.control(result.current.document)!;
  act(() => control().onStart());
  act(() => control().onPreview(65.7));
  expect(result.current.document.parts[0]!.thickness).toBe(65.7);
  expect(result.current.document.parts[0]!.thicknessExpression).toBeUndefined();
  expect(commit).not.toHaveBeenCalled();
  act(() => control().onCancel());
  expect(result.current.document).toBe(source);
  expect(control().dragging).toBe(false);
  act(() => control().onStart());
  act(() => control().onPreview(44));
  rerender({ document: source, partId: undefined });
  expect(result.current.document).toBe(source);
  expect(commit).not.toHaveBeenCalled();
});
