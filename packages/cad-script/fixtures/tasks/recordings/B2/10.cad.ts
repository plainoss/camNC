import { design } from '@wbcnc/cad-script';

export default design(d => {
  d.variable('width', '1100mm');
  d.variable('seatCorner', '30mm');
  // The seat's tongues (housing) reach into the sides, and rounded corners would make them non-square so the
  // sides' rebates could not follow. With no tongue the seat sits between the sides and its corners can be rounded.
  d.variable('housing', '0mm');

  const seat = d.part('Seat');
  seat.profile.fillet([seat.profile.find('5cc1'), seat.profile.find('f0e9')], 'seatCorner');

  const divider = d.newPart('Divider', { thickness: 'board' });
  divider.profile.rect({ at: [0, 'shelfHeight + board'], w: 'depth', h: 'height - 2*board - shelfHeight' });
  divider.drawOn('right', { offset: 'width/2 - board/2' });
  divider.expect({ freedom: 0 });
});
