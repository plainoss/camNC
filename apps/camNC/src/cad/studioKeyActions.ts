import { designSteps, type CadDocument } from '@wbcnc/cad';
import type { Dispatch, RefObject, SetStateAction } from 'react';
import { planesToggled } from './planesShortcut';

type Visibility = Readonly<Record<string, boolean>>;

/**
 * What the Part Studio's view keys do to the feature list: P shows or hides the planes, Shift+H every sketch, and the
 * up and down arrows move the rollback bar one step.
 */
export function studioKeyActions(
  documentRef: RefObject<CadDocument>,
  shown: (id: string) => boolean,
  setVisibility: Dispatch<SetStateAction<Visibility>>,
  setRolledTo: Dispatch<SetStateAction<string | null>>
) {
  return {
    togglePlanes: () => setVisibility(visibility => planesToggled(visibility, documentRef.current, shown)),
    /** Every sketch hidden when any is shown, otherwise all shown again, by their eyes. */
    toggleSketches: () =>
      setVisibility(visibility => {
        const ids = designSteps(documentRef.current)
          .filter(step => step.kind === 'sketch')
          .map(step => step.id);
        const show = !ids.some(shown);
        return { ...visibility, ...Object.fromEntries(ids.map(id => [id, show])) };
      }),
    /** Up rolls back over the last step still built, down brings the next one back; below the last is no rollback. */
    moveRollback: (by: -1 | 1) =>
      setRolledTo(rolled => {
        const ids = designSteps(documentRef.current).map(step => step.id);
        if (!ids.length) return null;
        const at = rolled === null ? ids.length - 1 : Math.max(0, ids.indexOf(rolled));
        const next = Math.min(ids.length - 1, Math.max(0, at + by));
        return next === ids.length - 1 ? null : ids[next]!;
      }),
  };
}
