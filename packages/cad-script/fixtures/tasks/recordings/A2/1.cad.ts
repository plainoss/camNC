import { design } from '@wbcnc/cad-script';

export default design(d => {
  d.variable('cableHole', '60mm');
  const mid = d.part('Shelf 2');
  const sk = mid.sketchOn('top');
  sk.circle({ at: ['width/2', 'depth - back - 10mm - 40mm'], d: 'cableHole' });
  mid.cut(sk.regionAt(400, 234), { depth: 'through' });
});
