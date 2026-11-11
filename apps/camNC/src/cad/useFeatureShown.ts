import type { CadDocument } from '@wbcnc/cad';
import { useCallback } from 'react';
import { featureShownByDefault } from './sketchShown';

/**
 * Whether a feature list row's feature shows in the view: its eye if toggled, else as the design is shown (rolled back
 * to its sketch, a part isn't extruded yet, so its sketch shows). Steps below the bar the user rolled to are left out
 * whatever their eye says, as the 3D sketch lines come from the full document.
 */
export function useFeatureShown(
  visibility: Readonly<Record<string, boolean>>,
  shownDocument: CadDocument,
  pastRollback: ReadonlySet<string>
): (id: string) => boolean {
  return useCallback(
    (id: string) => {
      if (pastRollback.has(id)) return false;
      return id in visibility ? visibility[id]! : featureShownByDefault(shownDocument, id);
    },
    [visibility, shownDocument, pastRollback]
  );
}
