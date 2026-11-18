import { kVariableMissing, sketchOwnerId, type CadDocument } from '@wbcnc/cad';
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
  unbuilt?: readonly string[],
  /** Why each part wasn't built: one failing only on a variable that's gone keeps its sketch hidden, as the reference does. */
  problems?: Readonly<Record<string, string>>
): (id: string) => boolean {
  return useCallback(
    (id: string) => {
      if (pastRollback.has(id)) return false;
      if (id in visibility) return visibility[id]!;
      const partId = id.endsWith(':sketch') ? id.slice(0, -':sketch'.length) : null;
      const reveals = !!partId && !!unbuilt?.includes(partId) && problems?.[partId] !== kVariableMissing;
      return reveals || featureShownByDefault(shownDocument, id);
    },
    [visibility, shownDocument, pastRollback, unbuilt, problems]
  );
}

/**
 * The eyes once an extrude is confirmed: the sketch it's made from goes back to hidden, as a sketch an extrude uses is,
 * whether it was shown to pick from or is a new one.
 */
export function withMadeSketchHidden(visibility: Readonly<Record<string, boolean>>, document: CadDocument, partId: string) {
  const made = document.parts.find(part => part.id === partId);
  if (!made) return visibility;
  const { [`${sketchOwnerId(made)}:sketch`]: _shown, ...rest } = visibility;
  return rest;
}
