import { design, type PartEdit } from '@wbcnc/cad-script';

export default design(d => {
  d.variable('width', '800mm');
  d.variable('height', '1000mm');
  d.variable('depth', '220mm');
  d.variable('board', '18mm');
  d.variable('back', '6mm');
  d.variable('housing', '6mm');
  d.variable('shelves', '4');
  // Clear gap between boards, so the shelves are evenly spaced.
  d.variable('gap', '(height - (shelves + 2)*board)/(shelves + 1)');

  const side = d.part('Side', { thickness: 'board' });
  side.profile.rect({ at: [0, 0], w: 'depth', h: 'height' });
  side.drawOn('right');
  side.copy({ at: ['width', 0, 0], x: '-y', y: '+z', mirrored: true, name: 'Right side' });

  const panel = (name: string, offset: string | number): PartEdit => {
    const part = d.part(name, { thickness: 'board' });
    part.profile.rect({ at: ['board - housing', 0], w: 'width - 2*board + 2*housing', h: 'depth - back' });
    part.drawOn('top', { offset });
    return part;
  };
  const bottom = panel('Bottom', 0);
  const top = panel('Top', 'height - board');
  const shelf = panel('Shelf', 'board + gap');
  const copies = shelf.pattern({ axis: 'z', count: 'shelves', spacing: 'gap + board' });

  const back = d.part('Back', { thickness: 'back' });
  back.profile.rect({ at: ['board - housing', 0], w: 'width - 2*board + 2*housing', h: 'height' });
  back.drawOn('front', { offset: '-(depth - back)', inward: true });

  d.cutParts(side, { with: [top, bottom, back, shelf] });
});
