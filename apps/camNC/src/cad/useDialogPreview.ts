import type { CadDocument } from '@wbcnc/cad';
import { useEffect, useRef } from 'react';

/** Publishes a dialog's valid candidate without saving it or putting it in history. */
export function useDialogPreview(candidate: CadDocument | null, onPreview?: (document: CadDocument | null) => void) {
  const publish = useRef(onPreview);
  publish.current = onPreview;
  // Callers may supply inline callbacks; their identity must not repeatedly publish the same candidate.
  useEffect(() => publish.current?.(candidate), [candidate]);
}
