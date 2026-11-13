import type { CadDocument } from '@wbcnc/cad';
import { basePlaneViews } from './basePlanes';

/**
 * The planes after P: all of them hidden when any is shown, otherwise all shown again. It sets their Feature list eyes,
 * so the list greys their rows as the view hides them.
 */
export function planesToggled(
  visibility: Readonly<Record<string, boolean>>,
  document: CadDocument,
  shown: (id: string) => boolean
): Readonly<Record<string, boolean>> {
  const ids = basePlaneViews(document).map(plane => plane.id);
  const show = !ids.some(shown);
  return { ...visibility, ...Object.fromEntries(ids.map(id => [id, show])) };
}
