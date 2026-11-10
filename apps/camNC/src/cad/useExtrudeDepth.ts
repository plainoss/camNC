import { useEffect, useRef, useState } from 'react';
import { resolveExtrudeSteps, type CadDocument } from '@wbcnc/cad';
import { extrudeDepthView, withExtrudeDepth, type ExtrudeDepthControl } from './extrudeDepth';

/** Preview geometry without writing undo entries; releasing the arrow commits one user command. */
export function useExtrudeDepth(document: CadDocument, partId: string | undefined, commit: (document: CadDocument) => void) {
  const [preview, setPreview] = useState<CadDocument | null>(null);
  const [dragging, setDragging] = useState(false);
  const base = useRef<CadDocument | null>(null);
  const dragPart = useRef<string | undefined>(undefined);
  useEffect(() => {
    base.current = null;
    setPreview(null);
    setDragging(false);
  }, [document, partId]);
  const cancel = () => {
    base.current = null;
    setPreview(null);
    setDragging(false);
  };
  return {
    document: base.current === document && dragPart.current === partId ? (preview ?? document) : document,
    control(shown: CadDocument): ExtrudeDepthControl | null {
      const view = partId && extrudeDepthView(shown, partId);
      if (!view || !partId) return null;
      return {
        ...view,
        dragging,
        onStart: () => {
          if (!view.editable) return;
          base.current = document;
          dragPart.current = partId;
          setDragging(true);
        },
        onPreview: depth => {
          if (view.editable && base.current === document && dragPart.current === partId)
            setPreview(resolveExtrudeSteps(withExtrudeDepth(base.current, partId, depth)));
        },
        onFinish: depth => {
          if (!view.editable) return cancel();
          const before = base.current ?? document;
          cancel();
          if (before.parts.find(part => part.id === partId)?.thickness !== depth) commit(withExtrudeDepth(before, partId, depth));
        },
        onCancel: cancel,
      };
    },
  };
}
