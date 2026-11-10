import { CamInputError } from './validation';

/** Refine only a component whose actual paths left reachable floor unproved; selected stepovers stay upper bounds. */
export function nextPocketFloorSpacing(spacing: number, established: number, attempt: number): number {
  if (attempt >= 12)
    throw new CamInputError([{ field: 'stepoverFactor', message: 'cannot resolve reachable pocket floor coverage within 12 refinements' }]);
  // Try the established layout before adding paths. If it too has diagonal gaps, refine that component instead of accepting them.
  return attempt === 0 && spacing !== established ? established : spacing / 2;
}
