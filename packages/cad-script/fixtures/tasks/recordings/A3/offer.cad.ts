import { design, type PartEdit } from '@wbcnc/cad-script';

// A second cupboard of the same kind, 400 wide, standing against the right of the first.
// The first cupboard's parts and variables (width, ...) are not touched; this one has its own width2
// and starts at x2 = the first cupboard's width. Height, depth, board etc. are shared.
export default design(d => {
  d.variable('width2', '400mm');
  d.variable('x2', 'width');

  const side = d.newPart('Side 2', { thickness: 'board' });
  side.profile.rect({ at: [0, 0], w: 'depth', h: 'height' });
  side.drawOn('right', { offset: 'x2' });
  const pins = side.sketchOn('top');
  pins.pattern([pins.circle({ at: [37, 'board + margin'], d: 'pin' })], {
    count: '(height - 2*board - 2*margin)/pitch + 1',
    step: [0, 'pitch'],
    rows: { count: 2, step: ['depth - back - 74mm', 0] },
  });
  side.cut(pins.regionAt(37, d.value('board + margin')), { depth: 12 });
  side.copy({ at: ['x2 + width2', 0, 0], x: '-y', y: '+z', mirrored: true, name: 'Right side 2' });

  const panel = (name: string, offset: string | number): PartEdit => {
    const part = d.newPart(name, { thickness: 'board' });
    part.profile.rect({ at: ['x2 + board - housing', 0], w: 'width2 - 2*board + 2*housing', h: 'depth - back' });
    part.drawOn('top', { offset });
    return part;
  };
  const bottom = panel('Bottom 2', 0);
  const top = panel('Top 2', 'height - board');

  const back = d.newPart('Back 2', { thickness: 'back' });
  back.profile.rect({ at: ['x2 + board - housing', 0], w: 'width2 - 2*board + 2*housing', h: 'height' });
  back.drawOn('front', { offset: '-(depth - back)', inward: true });

  d.cutParts(side, { with: [top, bottom, back] });

  const shelf = d.newPart('Shelf 4', { thickness: 'board' });
  shelf.profile.rect({ at: ['x2 + board + 1mm', 0], w: 'width2 - 2*board - 2mm', h: 'depth - back - 10mm' });
  shelf.drawOn('top', { offset: 'board + gap' });
  shelf.pattern({ axis: 'z', count: 'shelves', spacing: 'gap + board' });
});
