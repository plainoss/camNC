import { design } from '@wbcnc/cad-script';

/** A cupboard side: a housing groove running edge to edge for a shelf, and a row of shelf-pin holes. */
export default design(d => {
  const side = d.newPart('Side', { thickness: 18 });
  side.profile.rect({ at: [0, 0], w: 300, h: 720 });
  for (let i = 0; i < 6; i++) side.profile.circle({ at: [37, 200 + i * 32], d: 5 });
  const inside = side.sketchOn('top');
  inside.rect({ at: [-5, 450], w: 310, h: 18.2 });
  side.cut(inside.regionAt(150, 459), { depth: 6 });
  side.expect({ size: [300, 720], holes: 6, depths: [6], freedom: 0 });
});
