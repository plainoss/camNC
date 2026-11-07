import { design } from '@wbcnc/cad-script';

export default design(d => {
  const plate = d.part('Plate', { thickness: 18 });
  plate.profile.rect({ at: [0, 0], w: 400, h: 300 });
  for (const at of [
    [30, 30],
    [370, 30],
    [30, 270],
    [370, 270],
  ] as const)
    plate.profile.circle({ at, d: 8 });
  const top = plate.sketchOn('top');
  top.rect({ at: [100, 75], w: 200, h: 150 });
  plate.cut(top.regionAt(200, 150), { depth: 6 });
  plate.expect({ size: [400, 300], holes: 4, pockets: 1, depths: [6], freedom: 0 });
});
