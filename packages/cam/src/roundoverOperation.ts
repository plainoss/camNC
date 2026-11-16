import { areaD, type PathD } from 'clipper2-ts';
import type { PartRound } from './features';
import { offset, type Vec3 } from './geom';
import { cuttingWith, offsetToleranceFor } from './passPlanning';
import type { CamSettings, Operation, Tool } from './toolpathTypes';

/** How far, in mm, a roundover bit's radius may be from the round's for it to cut that round. */
export const kRoundoverRadiusMatch = 0.05;

/** The roundover bit that cuts a round: one whose radius is the round's. */
export function roundoverBitFor(round: Pick<PartRound, 'radius'>, bits: readonly Tool[] = []): Tool | undefined {
  return bits.find(bit => bit.shape === 'roundover' && Math.abs((bit.radius ?? 0) - round.radius) <= kRoundoverRadiusMatch);
}

/**
 * One lap of a roundover bit around a rounded edge: its tip runs along the wall below the edge, at the foot of the
 * round, so its quarter-circle flank cuts the round from the wall into the face. The edge's wall must be cut first: the
 * bit goes down beside it, in the waste a pocket or the outline cleared.
 */
export function roundoverOperation(name: string, round: PartRound, bit: Tool, settings: CamSettings): Operation | { problem: string } {
  const s = cuttingWith(bit, settings);
  if (!round.down) return { problem: `${name}: a round on the underside needs the part turned over` };
  const tip = (bit.tipDiameter ?? 0) / 2;
  // The bit's axis keeps the tip's radius off the wall, in the waste: outside an outline, inside an opening.
  const outward = round.material === 'inside' ? 1 : -1;
  const paths = tip ? offset([round.loop], outward * tip, offsetToleranceFor(s)) : [round.loop];
  const path = paths.sort((a, b) => Math.abs(areaD(b)) - Math.abs(areaD(a)))[0];
  if (!path || path.length < 3) return { problem: `${name}: the ${round.radius} mm roundover bit's tip doesn't fit in the opening` };
  // Climb, as the profiles cut: material on the right, so clockwise around an outline and counterclockwise in a hole.
  const ccw = areaD(path) > 0;
  const wantCcw = (round.material === 'outside') === s.climb;
  const loop: PathD = ccw === wantCcw ? path : [...path].reverse();
  const z = round.z - round.radius;
  const pts: Vec3[] = [...loop, loop[0]!].map(p => [p.x, p.y, z]);
  const feed = s.finishFeed ?? s.feed;
  return {
    name,
    kind: 'profile',
    feature: round.material === 'inside' ? 'outline' : 'pocket',
    tool: bit,
    title: `R${+round.radius.toFixed(2)} roundover`,
    passes: [
      {
        pts,
        feeds: [s.plungeFeed, ...pts.slice(1).map(() => feed)],
        materialSide: s.climb ? 'right' : 'left',
        phase: 'finish',
        entry: 'plunge',
        link: 'retract',
      },
    ],
  };
}
