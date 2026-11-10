import { design } from '@wbcnc/cad-script';

export default design(d => {
  d.variable('width', '900mm');
  d.variable('height', '450mm');
  d.variable('depth', '350mm');
  d.variable('board', '18mm');
  // How far the seat and shelf reach into the sides' housings.
  d.variable('housing', '8mm');
  // Height of the shelf's underside above the floor.
  d.variable('shelfHeight', '150mm');

  const side = d.newPart('Side', { thickness: 'board' });
  side.profile.rect({ at: [0, 0], w: 'depth', h: 'height' });
  side.drawOn('right');
  side.expect({ size: [d.value('depth'), d.value('height')], thickness: d.value('board'), freedom: 0 });
  side.copy({ at: ['width', 0, 0], x: '-y', y: '+z', mirrored: true, name: 'Right side' });

  const seat = d.newPart('Seat', { thickness: 'board' });
  seat.profile.rect({ at: ['board - housing', 0], w: 'width - 2*board + 2*housing', h: 'depth' });
  seat.drawOn('top', { offset: 'height - board' });
  seat.expect({ freedom: 0 });

  const shelf = d.newPart('Shelf', { thickness: 'board' });
  shelf.profile.rect({ at: ['board - housing', 0], w: 'width - 2*board + 2*housing', h: 'depth' });
  shelf.drawOn('top', { offset: 'shelfHeight' });
  shelf.expect({ freedom: 0 });

  d.cutParts(side, { with: [seat, shelf] });
});
