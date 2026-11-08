import { design, type DesignEdit, type PartEdit } from '@wbcnc/cad-script';

/**
 * A wall cupboard as a cabinet maker builds it. The top and bottom sit in rebates across the sides' ends, the back sits
 * in rebates along their back edges, and the shelf rests on pins in two 32 mm rows. Each part is drawn on a plane of
 * the studio, and the rebates are cut by the parts that sit in them, so they follow those parts' sizes and places.
 * Studio: X left to right, Y front to back, Z up.
 */
export const cupboard =
  ({ width = '600mm', height = '720mm', depth = '300mm', board = '18mm' } = {}) =>
  (d: DesignEdit) => {
    d.variable('width', width);
    d.variable('height', height);
    d.variable('depth', depth);
    d.variable('board', board);
    d.variable('back', '6mm');
    // How far a panel reaches into a side's rebate.
    d.variable('housing', '8mm');
    d.variable('pin', '5mm');
    // The 32 mm system: pin rows start this far above the bottom panel and stop as far below the top.
    d.variable('pitch', '32mm');
    d.variable('margin', '80mm');

    // The sides, on the right plane: sketch x runs front to back, y up, and the thickness grows towards +x, inwards.
    const side = d.part('Side', { thickness: 'board' });
    side.profile.rect({ at: [0, 0], w: 'depth', h: 'height' });
    side.drawOn('right');
    // Pin rows 37 mm in from the front and from the back's rebate, from the bottom up, as many as fit.
    const pins = side.sketchOn('top');
    pins.pattern([pins.circle({ at: [37, 'board + margin'], d: 'pin' })], {
      count: '(height - 2*board - 2*margin)/pitch + 1',
      step: [0, 'pitch'],
      rows: { count: 2, step: ['depth - back - 74mm', 0] },
    });
    // Cutting the first pin cuts every copy, including those the pattern gains when the height changes.
    side.cut(pins.regionAt(37, d.value('board + margin')), { depth: 12 });
    side.expect({ size: [d.value('depth'), d.value('height')], thickness: d.value('board'), freedom: 0 });
    // The right side is the left's mirror image: its inside faces left, with the front and the pins where they are.
    side.copy({ at: ['width', 0, 0], x: '-y', y: '+z', mirrored: true, name: 'Right side' });

    // Top and bottom, on the top plane: x left to right, y front to back. They reach `housing` into each side and stop
    // at the back panel.
    const panel = (name: string, offset: string | number): PartEdit => {
      const part = d.part(name, { thickness: 'board' });
      part.profile.rect({ at: ['board - housing', 0], w: 'width - 2*board + 2*housing', h: 'depth - back' });
      part.drawOn('top', { offset });
      part.expect({ freedom: 0 });
      return part;
    };
    const bottom = panel('Bottom', 0);
    const top = panel('Top', 'height - board');

    // The back, on the front plane: x left to right, y up. That plane looks towards -y, so the back is drawn `depth - back`
    // behind it and grows inwards, towards +y.
    const back = d.part('Back', { thickness: 'back' });
    back.profile.rect({ at: ['board - housing', 0], w: 'width - 2*board + 2*housing', h: 'height' });
    back.drawOn('front', { offset: '-(depth - back)', inward: true });

    // Every rebate in the sides: where the top, bottom and back reach into them.
    d.cutParts(side, { with: [top, bottom, back] });

    // The shelf has 1 mm to spare at each side and 10 mm at the back, and rests on the sixth pins up.
    const shelf = d.part('Shelf', { thickness: 'board' });
    shelf.profile.rect({ at: ['board + 1mm', 0], w: 'width - 2*board - 2mm', h: 'depth - back - 10mm' });
    shelf.drawOn('top', { offset: 'board + margin + 5*pitch + pin/2' });
    shelf.expect({ freedom: 0 });
  };

export default design(cupboard());
