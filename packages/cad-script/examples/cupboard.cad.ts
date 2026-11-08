import { design, type DesignEdit, type PartEdit } from '@wbcnc/cad-script';

/**
 * A wall cupboard as a cabinet maker builds it. The top and bottom sit in rebates across the sides' ends, the back sits
 * in rebates along their back edges, and the shelf rests on pins in two 32 mm rows. Assembly: X left to right, Y front
 * to back, Z up.
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
    const housing = d.value('housing');

    // The sides: sketch x runs front to back, y bottom to top, and the top face is the inside.
    const side = (() => {
      const part = d.part('Side', { thickness: 'board' });
      part.profile.rect({ at: [0, 0], w: 'depth', h: 'height' });
      // Rebates run 5 mm past the part, so their ends are open.
      const ends = part.sketchOn('top');
      ends.rect({ at: [-5, -5], w: 'depth + 10mm', h: 'board + 5mm' });
      ends.rect({ at: [-5, 'height - board'], w: 'depth + 10mm', h: 'board + 5mm' });
      part.cut(ends.regionAt(d.value('depth') / 2, d.value('board') / 2), { depth: 'housing' });
      part.cut(ends.regionAt(d.value('depth') / 2, d.value('height') - d.value('board') / 2), { depth: 'housing' });
      const back = part.sketchOn('top');
      back.rect({ at: ['depth - back', -5], w: 'back + 5mm', h: 'height + 10mm' });
      part.cut(back.regionAt(d.value('depth') - d.value('back') / 2, d.value('height') / 2), { depth: 'housing' });
      // Pin rows 37 mm in from the front and from the back's rebate, centred on the height so both sides are alike.
      const pins = part.sketchOn('top');
      const count = Math.floor((d.value('height') - 2 * d.value('board') - 160) / 32) + 1;
      const first = (d.value('height') - (count - 1) * 32) / 2;
      const gap = d.value('depth') - d.value('back') - 74;
      pins.pattern([pins.circle({ at: [37, first], d: 'pin' })], { count, step: [0, 32], rows: { count: 2, step: [gap, 0] } });
      for (let row = 0; row < 2; row++)
        for (let i = 0; i < count; i++) part.cut(pins.regionAt(37 + row * gap, first + i * 32), { depth: 12 });
      part.expect({ size: [d.value('depth'), d.value('height')], thickness: d.value('board'), freedom: 0 });
      return { part, pinAt: (i: number) => first + i * 32, count };
    })();
    side.part.place({ at: [0, 0, 0], x: '+y', y: '+z' });
    // The right side is the same part turned over end for end, so its inside faces left. The pins are centred on the
    // height, so it needs no mirror image.
    side.part.copy({ at: ['width', 0, 'height'], x: '+y', y: '-z' });

    // Top and bottom: sketch x runs left to right, y front to back. They stop at the back panel.
    const panel = (name: string): PartEdit => {
      const part = d.part(name, { thickness: 'board' });
      part.profile.rect({ at: [0, 0], w: 'width - 2*board + 2*housing', h: 'depth - back' });
      part.expect({ size: [d.value('width') - 2 * d.value('board') + 2 * housing, d.value('depth') - d.value('back')], freedom: 0 });
      return part;
    };
    panel('Bottom').place({ at: ['board - housing', 0, 0] });
    panel('Top').place({ at: ['board - housing', 0, 'height - board'] });

    const back = d.part('Back', { thickness: 'back' });
    back.profile.rect({ at: [0, 0], w: 'width - 2*board + 2*housing', h: 'height' });
    back.place({ at: ['board - housing', 'depth', 0], x: '+x', y: '+z' });

    // The shelf has 1 mm to spare at each side and 10 mm at the back, and rests on the middle pins.
    const shelf = d.part('Shelf', { thickness: 'board' });
    shelf.profile.rect({ at: [0, 0], w: 'width - 2*board - 2mm', h: 'depth - back - 10mm' });
    const rest = side.pinAt(Math.floor(side.count / 2)) + d.value('pin') / 2;
    shelf.place({ at: ['board + 1mm', 0, rest] });
    shelf.expect({ freedom: 0 });
  };

export default design(cupboard());
