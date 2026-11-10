import { design } from '@wbcnc/cad-script';

export default design(d => {
  d.variable('cableHole', '60mm');
  const shelf = d.part('Shelf');
  const sk = shelf.sketchOn('top');
  sk.circle({ at: ['width/2', 'depth - back - 10mm - 40mm'], d: 'cableHole' });
  shelf.cut(sk.regionAt(400, 244), { depth: 'through' });
});
