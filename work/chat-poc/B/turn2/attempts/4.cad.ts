import { design } from '@wbcnc/cad-script';

export default design(d => {
  d.variable('width', '1100mm');
  d.variable('seatCorner', '30mm');

  // Seat's two front corners (y = 0): the ends of its front edge.
  const seat = d.part('Seat');
  seat.profile.fillet([seat.profile.find('5cc1'), seat.profile.find('f0e9')], 'seatCorner');

  // Upright divider, between the shelf's top and the seat's underside, centred across the width.
  const divider = d.part('Divider', { thickness: 'board' });
  divider.profile.rect({ at: [0, 'shelfHeight + board'], w: 'depth', h: 'height - 2*board - shelfHeight' });
  divider.drawOn('right', { offset: 'width/2 - board/2' });
  divider.expect({ freedom: 0 });
});
