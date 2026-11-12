import { areaD, type PathD, type PathsD } from 'clipper2-ts';
import { difference, intersect, offset, polyArea, union } from './geom';
import { components } from './passPlanning';

/**
 * How far (× the allowance) a gap the allowance closes must reach past where it closes to count as a notch: a square
 * inside corner's gap reaches 0.41× (1/sin(θ/2) − 1), a 40° one 1.9×, so ordinary corners keep their allowance.
 */
const kNotchReach = 2;
/** The smallest gap piece that counts, in mm²: below it, a rounding speck of the offsets. */
const kMinArea = 1e-6;

const positive = (p: PathD): PathD => (areaD(p) < 0 ? [...p].reverse() : p);
const largest = (paths: PathsD) => paths.sort((a, b) => Math.abs(areaD(b)) - Math.abs(areaD(a)))[0];
const some = (paths: PathsD) => paths.length > 0 && Math.abs(polyArea(paths)) > kMinArea;

/**
 * The roughing loop around a profile, given the bit's final loop and the loop that leaves the allowance (`rough`).
 * A notch just wider than the bit (less than the bit plus twice the allowance) has room for the final path but not
 * for the allowance: the allowance loop runs straight across it, and the finish pass would slot it at full width.
 * There the roughing follows the final path into the notch instead, as a hole hardly wider than the bit is roughed on
 * its final path. `inside`: a hole's loop, the bit inside it. Returns `rough` when no notch needs it.
 */
export function roughAroundNotches(final: PathD, rough: PathD, leaveStock: number, inside: boolean, tolerance: number): PathD {
  if (!(leaveStock > 0)) return rough;
  // Regions the loops enclose: for an outline the material side, for a hole the bit's side.
  const [F, R] = [[positive(final)], [positive(rough)]];
  // Grows the bit's side of a loop by `d`.
  const free = (paths: PathsD, d: number) => offset(paths, inside ? d : -d, tolerance);
  // Where the bit's middle may go on the final path but not once the allowance loop is grown back by the allowance:
  // the gaps the allowance closes off. Inside corners leave slivers here too; only the far-reaching pieces are notches.
  const gaps = inside ? difference(F, free(R, leaveStock)) : difference(free(R, leaveStock), F);
  if (!some(gaps)) return rough;
  const beyond = free(R, (1 + kNotchReach) * leaveStock);
  const notches = components(gaps).filter(piece => some(inside ? difference(piece, beyond) : intersect(piece, beyond)));
  if (!notches.length) return rough;
  // Open each notch up to the allowance loop (it lies the allowance away from it), and keep the final wall.
  const opening = offset(notches.flat(), 2 * leaveStock, tolerance);
  const region = inside ? intersect(union(R, opening), F) : union(difference(R, opening), F);
  return largest(region) ?? rough;
}
