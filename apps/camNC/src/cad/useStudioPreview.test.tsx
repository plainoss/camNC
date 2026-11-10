import { createPlateDocument } from '@wbcnc/cad';
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import { useStudioPreview } from './useStudioPreview';

afterEach(cleanup);

it('scopes an unsaved candidate to its opening document and dialog, including late callbacks after cancel', () => {
  const source = createPlateDocument();
  const owner = {};
  const { result, rerender } = renderHook(({ document, owner }) => useStudioPreview(document, owner), {
    initialProps: { document: source, owner: owner as object | null },
  });
  const candidate = { ...source, parts: source.parts.map(part => ({ ...part, thickness: 29 })) };
  const oldUpdate = result.current.update;
  act(() => oldUpdate(candidate));
  expect(result.current.document.parts[0]!.thickness).toBe(29);
  expect(source.parts[0]!.thickness).toBe(18);
  act(() => result.current.update(null));
  expect(result.current.document).toBe(source);
  act(() => oldUpdate(candidate));
  rerender({ document: source, owner: null });
  expect(result.current.document).toBe(source);
  act(() => oldUpdate(candidate));
  expect(result.current.document).toBe(source);
  const nextOwner = {};
  rerender({ document: source, owner: nextOwner });
  expect(result.current.document).toBe(source);
  act(() => result.current.update(candidate));
  expect(result.current.document.parts[0]!.thickness).toBe(29);
  act(() => oldUpdate({ ...candidate, parts: candidate.parts.map(part => ({ ...part, thickness: 31 })) }));
  expect(result.current.document.parts[0]!.thickness).toBe(29);
  const changed = { ...source, revision: source.revision + 1 };
  rerender({ document: changed, owner: nextOwner });
  expect(result.current.document).toBe(changed);
  act(() => oldUpdate(candidate));
  expect(result.current.document).toBe(changed);
});
