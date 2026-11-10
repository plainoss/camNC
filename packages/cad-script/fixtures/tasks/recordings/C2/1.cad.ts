import { design } from '@wbcnc/cad-script';

export default design(d => {
  d.variable('pin', '5mm');
  d.variable('pitch', '32mm');
  const side = d.part('Side');
  const pins = side.sketchOn('top');
  const y0 = 'board + gap - pin/2 - 4*pitch';
  pins.pattern([pins.circle({ at: [37, y0], d: 'pin' })], {
    count: `(height - board - 30mm - (${y0}))/pitch + 1`,
    step: [0, 'pitch'],
    rows: { count: 2, step: ['depth - back - 74mm', 0] },
  });
  side.cut(pins.regionAt(37, d.value(y0)), { depth: 12 });
});
