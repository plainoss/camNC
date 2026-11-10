import { design } from '@wbcnc/cad-script';

export default design(d => {
  d.variable('width', '1100mm');
  d.variable('seatCorner', '30mm');

  // Seat front corners: the seat's tongues sit in the sides' housings and must stay square-cornered, so the
  // rounding is cut from the outside corner of each, from the side's inner face outwards.
  const seat = d.part('Seat');
  const sk = seat.sketchOn('top');
  const left = sk
    .path(['board - housing', 0])
    .lineTo(['board + seatCorner', 0])
    .arcTo(['board', 'seatCorner'], { r: 'seatCorner', clockwise: true })
    .lineTo(['board - housing', 'seatCorner'])
    .close();
  const right = sk
    .path(['width - board + housing', 0])
    .lineTo(['width - board + housing', 'seatCorner'])
    .lineTo(['width - board', 'seatCorner'])
    .arcTo(['width - board - seatCorner', 0], { r: 'seatCorner', clockwise: true })
    .close();
  seat.cut(sk.regionAt(15, 5), { depth: 'through' });
  seat.cut(sk.regionAt(1085, 5), { depth: 'through' });

  // Upright divider, between the shelf's top and the seat's underside, centred across the width.
  const divider = d.part('Divider', { thickness: 'board' });
  divider.profile.rect({ at: [0, 'shelfHeight + board'], w: 'depth', h: 'height - 2*board - shelfHeight' });
  divider.drawOn('right', { offset: 'width/2 - board/2' });
  divider.expect({ freedom: 0 });
});
