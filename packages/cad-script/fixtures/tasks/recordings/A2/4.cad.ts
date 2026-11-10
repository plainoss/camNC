import { design } from '@wbcnc/cad-script';

export default design(d => {
  d.variable('cableHole', '60mm');
  const tool = d.part('Cable hole tool', { thickness: 'board' });
  tool.profile.circle({ at: ['width/2', 'depth - back - 10mm - 40mm'], d: 'cableHole' });
  tool.drawOn('top', { offset: 'board + gap + gap + board + board' });
  const mid = d.part('Shelf 2');
  d.cutParts(mid, { with: tool });
});
