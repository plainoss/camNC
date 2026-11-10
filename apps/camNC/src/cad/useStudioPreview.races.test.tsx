import { createPlateDocument, type CadDocument, type CadSolveResult } from '@wbcnc/cad';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { solveCadDocument } from './solveCad';
import { useStudioPreview } from './useStudioPreview';

vi.mock('./solveCad', () => ({ solveCadDocument: vi.fn() }));
afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});
function pending() {
  let resolve!: (result: CadSolveResult) => void;
  const promise = new Promise<CadSolveResult>(done => {
    resolve = done;
  });
  return { promise, resolve: (document: CadDocument) => resolve({ document, status: 'solved', diagnostics: [], parts: [], sketches: [] }) };
}
const candidate = (source: CadDocument, value: number) => ({ ...source, parts: source.parts.map(part => ({ ...part, thickness: value })) });

it('coalesces draft solves and discards cancelled results without hiding a newer dialog candidate', async () => {
  const source = createPlateDocument(),
    owner = {};
  const first = pending(),
    latest = pending(),
    cancelled = pending(),
    nextOwner = pending();
  vi.mocked(solveCadDocument)
    .mockReturnValueOnce(first.promise)
    .mockReturnValueOnce(latest.promise)
    .mockReturnValueOnce(cancelled.promise)
    .mockReturnValueOnce(nextOwner.promise);
  const { result, rerender } = renderHook(({ owner }) => useStudioPreview(source, owner), {
    initialProps: { owner: owner as object | null },
  });
  act(() => result.current.update(candidate(source, 25)));
  act(() => result.current.update(candidate(source, 30)));
  act(() => result.current.update(candidate(source, 35)));
  expect(solveCadDocument).toHaveBeenCalledTimes(1);
  await act(async () => {
    first.resolve(candidate(source, 26));
    await first.promise;
  });
  expect(result.current.document.parts[0]!.thickness).toBe(35);
  await waitFor(() => expect(solveCadDocument).toHaveBeenCalledTimes(2));
  expect(vi.mocked(solveCadDocument).mock.calls[1]![0].parts[0]!.thickness).toBe(35);
  await act(async () => {
    latest.resolve(candidate(source, 36));
    await latest.promise;
  });
  expect(result.current.document.parts[0]!.thickness).toBe(36);
  act(() => result.current.update(candidate(source, 40)));
  const oldUpdate = result.current.update;
  act(() => result.current.update(null));
  rerender({ owner: {} });
  act(() => result.current.update(candidate(source, 50)));
  await act(async () => {
    cancelled.resolve(candidate(source, 41));
    await cancelled.promise;
  });
  expect(result.current.document.parts[0]!.thickness).toBe(50);
  act(() => oldUpdate(candidate(source, 42)));
  expect(result.current.document.parts[0]!.thickness).toBe(50);
  await act(async () => {
    nextOwner.resolve(candidate(source, 51));
    await nextOwner.promise;
  });
  expect(result.current.document.parts[0]!.thickness).toBe(51);
  expect(solveCadDocument).toHaveBeenCalledTimes(4);
});
