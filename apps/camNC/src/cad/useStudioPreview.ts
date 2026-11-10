import { useCallback, useState } from 'react';
import { resolveExtrudeSteps, type CadDocument } from '@wbcnc/cad';

/** A dialog candidate belongs to its opening document and dialog instance, never to history or the next dialog. */
export function useStudioPreview(document: CadDocument, owner: object | null) {
  const [preview, setPreview] = useState<{ base: CadDocument; owner: object; document: CadDocument } | null>(null);
  const update = useCallback(
    (candidate: CadDocument | null) => {
      setPreview(candidate && owner ? { base: document, owner, document: resolveExtrudeSteps(candidate) } : null);
    },
    [document, owner]
  );
  return {
    update,
    document: preview?.base === document && preview.owner === owner ? preview.document : document,
  };
}
