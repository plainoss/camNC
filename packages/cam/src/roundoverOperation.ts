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
    // A finishing pass over an edge, not an outline: nothing holding a part, cutting it free or tabbed reads it as one.
    feature: 'pocket',
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

/** The scallop a ball end leaves between its laps over a round, mm: finer than the wood's grain shows. */
const kRoundScallop = 0.01;

/**
 * A round finished with a ball end mill, as a 3D finishing pass: laps around the edge, each one a step of the quarter
 * circle further from the wall and up into the face, the ball's tip on the round all the way. It needs the wall below
 * the edge cut first, and room beside it for the ball, in the waste a pocket or the outline cleared.
 */
export function ballRoundOperation(name: string, round: PartRound, bit: Tool, settings: CamSettings): Operation | { problem: string } {
  const s = cuttingWith(bit, settings);
  if (!round.down) return { problem: `${name}: a round on the underside needs the part turned over` };
  const r = round.radius,
    ball = bit.diameter / 2;
  // Out of the material, into the waste: outside an outline, inside an opening.
  const outward = round.material === 'inside' ? 1 : -1;
  // Steps along the round's surface that leave a scallop no higher than kRoundScallop: a ball on a convex round leaves
  // about step² / 8 · (1 / ball + 1 / r).
  const along = Math.sqrt((8 * kRoundScallop) / (1 / ball + 1 / r));
  // Each lap a little deeper than the last: where nothing is cut beside the round yet, the ball cuts its full width,
  // so a lap takes at most a quarter of its diameter (less if the bit's own stepdown says so). Down the steepest part,
  // a lap goes (r + ball) · step deeper.
  const deepest = Math.min(bit.diameter / 4, bit.stepdown ?? Infinity);
  const laps = Math.max(
    4,
    Math.min(180, Math.max(Math.ceil(((Math.PI / 2) * r) / along), Math.ceil(((Math.PI / 2) * (r + ball)) / deepest)))
  );
  const climbCcw = (round.material === 'outside') === s.climb;
  const feed = s.finishFeed ?? s.feed;
  const passes: Operation['passes'] = [];
  // From the face down the round to the wall, each lap a little deeper: the ball never dives beside the wall.
  for (let k = laps; k >= 0; k--) {
    const angle = ((Math.PI / 2) * k) / laps;
    // The ball's centre stays r + ball from the round's axis, which runs r in from the edge and r below it.
    const out = (r + ball) * Math.cos(angle) - r;
    const tip = round.z - r + (r + ball) * Math.sin(angle) - ball;
    const paths = Math.abs(out) < 1e-9 ? [round.loop] : offset([round.loop], outward * out, offsetToleranceFor(s));
    const path = paths.sort((a, b) => Math.abs(areaD(b)) - Math.abs(areaD(a)))[0];
    if (!path || path.length < 3) return { problem: `${name}: the ${bit.diameter} mm ball end doesn't fit beside the round` };
    const loop: PathD = areaD(path) > 0 === climbCcw ? path : [...path].reverse();
    const pts: Vec3[] = [...loop, loop[0]!].map(p => [p.x, p.y, tip]);
    passes.push({
      pts,
      feeds: [s.plungeFeed, ...pts.slice(1).map(() => feed)],
      materialSide: s.climb ? 'right' : 'left',
      phase: 'finish',
      entry: 'plunge',
      link: 'retract',
    });
  }
  return {
    name,
    kind: 'profile',
    // A finishing pass over an edge, not an outline: nothing holding a part, cutting it free or tabbed reads it as one.
    feature: 'pocket',
    tool: bit,
    title: `R${+r.toFixed(2)} round, ball end ⌀${+bit.diameter.toFixed(2)}`,
    passes,
  };
}
