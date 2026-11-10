import { design } from '@wbcnc/cad-script';

/** An L bracket with a rounded inside corner, two mounting holes and an adjustment slot. */
export default design(d => {
  const bracket = d.newPart('Bracket', { thickness: 12 });
  const l = bracket.profile.polygon([
    [0, 0],
    [120, 0],
    [120, 30],
    [30, 30],
    [30, 100],
    [0, 100],
  ]);
  bracket.profile.fillet([l.corners[3]!], 10);
  bracket.profile.circle({ at: [15, 80], d: 6 });
  bracket.profile.circle({ at: [105, 15], d: 6 });
  const slot = bracket.profile;
  const lower = slot.line([50, 10], [80, 10]);
  const upper = slot.line([80, 20], [50, 20]);
  const right = slot.arc({ at: [80, 15], r: 5, from: -90, to: 90 });
  const left = slot.arc({ at: [50, 15], r: 5, from: 90, to: 270 });
  for (const end of [right, left]) {
    slot.relate('tangent', lower, end);
    slot.relate('tangent', upper, end);
  }
  slot.relate('horizontal', lower);
  slot.relate('equal', left, right);
  slot.radius(left, 5);
  slot.place(left.center, [50, 15]);
  slot.distance(left.center, right.center, 30);
  bracket.expect({ size: [120, 100], holes: 3, freedom: 0 });
});
