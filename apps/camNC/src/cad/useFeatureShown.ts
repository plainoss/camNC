import type { CadDocument } from '@wbcnc/cad';
import { useCallback } from 'react';
import { featureShownByDefault } from './sketchShown';

/**
 * Whether a feature list row's feature shows in the view: its eye if toggled, else as the design is shown (rolled back
 * to its sketch, a part isn't extruded yet, so its sketch shows). Steps below the bar the user rolled to are left out
 * whatever their eye says, as the 3D sketch lines come from the full document. A sketch whose extrude wasn't built shows
 * again, as there's no part to show instead.
 */
export function useFeatureShown(
  visibility: Readonly<Record<string, boolean>>,
  shownDocument: CadDocument,
  pastRollback: ReadonlySet<string>,
  broken?: Readonly<Record<string, string>>
): (id: string) => boolean {
  return useCallback(
    (id: string) => {
      if (pastRollback.has(id)) return false;
      if (id in visibility) return visibility[id]!;
      return (id.endsWith(':sketch') && !!broken?.[id.slice(0, -':sketch'.length)]) || featureShownByDefault(shownDocument, id);
    },
    [visibility, shownDocument, pastRollback, broken]
  );
}
