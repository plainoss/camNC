import { design } from '@wbcnc/cad-script';

export default design(d => {
  d.variable('width', '1100mm');
  d.variable('seatCorner', '30mm');

  const seat = d.part('Seat');
  const prof = seat.profile;
  // front corners: (10,0) and (890,0) in sketch coords
  console.error(Object.keys(prof));
  const divider = d.part('Divider', { thickness: 'board' });
  divider.profile.rect({ at: [0, 'shelfHeight + board'], w: 'depth', h: 'height - 2*board - shelfHeight - board' });
  divider.drawOn('right', { offset: 'width/2 - board/2' });
  divider.expect({ freedom: 0 });
});
