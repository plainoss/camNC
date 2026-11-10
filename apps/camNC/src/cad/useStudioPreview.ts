import { useCallback, useEffect, useRef, useState } from 'react';
import { resolveDatumPlanes, resolveDrawnPlacements, resolveExtrudeSteps, resolvePartPatterns, type CadDocument } from '@wbcnc/cad';
import { solveCadDocument } from './solveCad';

/** Keep viewport candidates and accepted steps on the same current datum, part and copy placements. */
export function prepareStudioPreview(document: CadDocument): CadDocument {
  return resolvePartPatterns(resolveDrawnPlacements(resolveExtrudeSteps(resolveDatumPlanes(document))).document);
}

/** A dialog candidate belongs to its opening document and dialog instance, never to history or the next dialog. */
export function useStudioPreview(document: CadDocument, owner: object | null) {
  const [preview, setPreview] = useState<{ base: CadDocument; owner: object; candidate: CadDocument; document: CadDocument } | null>(null);
  const latest = useRef({ document, owner });
  latest.current = { document, owner };
  const sequence = useRef(0);
  const mounted = useRef(true);
  const running = useRef(false);
  const pending = useRef<(() => Promise<void>) | null>(null);
  useEffect(() => {
    mounted.current = true;
    const cancelPending = () => {
      sequence.current++;
    };
    return () => {
      mounted.current = false;
      pending.current = null;
      cancelPending();
    };
  }, []);
  const drain = useCallback(async () => {
    if (running.current) return;
    running.current = true;
    try {
      // Keep at most the latest queued draft while the worker solves the previous one.
      while (pending.current) {
        const task = pending.current;
        pending.current = null;
        await task();
      }
    } finally {
      running.current = false;
    }
  }, []);
  const update = useCallback(
    (candidate: CadDocument | null) => {
      // A callback retained by a closed dialog must not displace the current dialog's candidate.
      if (!mounted.current || latest.current.document !== document || latest.current.owner !== owner) return;
      const request = ++sequence.current;
      pending.current = null;
      if (!candidate || !owner) return setPreview(null);
      setPreview({ base: document, owner, candidate, document: prepareStudioPreview(candidate) });
      if (candidate === document) return;
      const current = () =>
        mounted.current && sequence.current === request && latest.current.document === document && latest.current.owner === owner;
      pending.current = async () => {
        if (!current()) return;
        try {
          // Moves and variable edits can both change dependent sketches, even when their own constraint bytes do not change.
          // Used vertices read source placements before the worker's final placement pass.
          const placed = prepareStudioPreview(candidate);
          const result = await solveCadDocument(placed);
          if (!current()) return;
          // An unrelated unfinished extrusion can make the whole result invalid after its sketches have solved.
          setPreview(previous =>
            previous?.candidate !== candidate
              ? previous
              : result.status === 'solved' || result.sketches.some(sketch => sketch.status === 'solved')
                ? { ...previous, document: prepareStudioPreview(result.document) }
                : previous
          );
        } catch {
          // Keep the direct candidate if the worker stops; acceptance still runs the editor's normal validation.
        }
      };
      void drain();
    },
    [document, owner, drain]
  );
  return {
    update,
    document: preview?.base === document && preview.owner === owner ? preview.document : document,
  };
}
