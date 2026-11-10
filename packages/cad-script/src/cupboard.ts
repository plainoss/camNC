import type { CadScript, PartEdit } from './editTypes';
import { fail } from './editExisting';

export interface CupboardOptions {
  name?: string;
  width?: string;
  height?: string;
  depth?: string;
  board?: string;
  shelves?: number;
  at?: readonly [number, number, number];
}

/** Inserts ordinary source steps and variables once. Later edits never rerun this function. */
export function cupboard(options: CupboardOptions = {}): CadScript {
  const keys = ['name', 'width', 'height', 'depth', 'board', 'shelves', 'at'];
  if (!options || typeof options !== 'object' || Array.isArray(options))
    return fail(`cupboard needs an options object. Available options: ${keys.join(', ')}.`);
  for (const key of Object.keys(options))
    if (!keys.includes(key)) return fail(`cupboard has no option ${key}. Available options: ${keys.join(', ')}.`);
  const { name = 'Cupboard', width = '600mm', height = '720mm', depth = '300mm', board = '18mm', shelves = 3, at = [0, 0, 0] } = options;
  for (const [key, value] of Object.entries({ name, width, height, depth, board }))
    if (typeof value !== 'string' || !value.trim()) return fail(`cupboard.${key} must be a non-empty string.`);
  if (!Number.isInteger(shelves) || shelves < 1 || shelves > 200) return fail('cupboard.shelves must be a whole number from 1 to 200.');
  if (!Array.isArray(at) || at.length !== 3 || at.some(value => typeof value !== 'number' || !Number.isFinite(value)))
    return fail('cupboard.at must contain three finite millimetre coordinates.');
  return design =>
    design.folder(name, d => {
      d.variable('width', width);
      d.variable('height', height);
      d.variable('depth', depth);
      d.variable('board', board);
      d.variable('shelves', String(shelves));
      d.variable('originX', `${at[0]}mm`);
      d.variable('originY', `${at[1]}mm`);
      d.variable('originZ', `${at[2]}mm`);
      d.variable('back', '6mm');
      d.variable('housing', '8mm');
      d.variable('pin', '5mm');
      d.variable('pitch', '32mm');
      d.variable('margin', '80mm');
      // Every shelf rests on a pin row. Count edits keep ordinary pattern identities and never rerun a generator.
      d.variable('shelfSpacing', 'max(pitch; floor((height - 2*board - 2*margin)/(max(1; shelves - 1)*pitch))*pitch)');

      const side = d.newPart('Side', { thickness: 'board' });
      side.profile.rect({ at: ['originY', 'originZ'], w: 'depth', h: 'height' });
      side.drawOn('right', { offset: 'originX' });
      const pins = side.sketchOn('top');
      pins.pattern([pins.circle({ at: ['originY + 37mm', 'originZ + board + margin'], d: 'pin' })], {
        count: '(height - 2*board - 2*margin)/pitch + 1',
        step: [0, 'pitch'],
        rows: { count: 2, step: ['depth - back - 74mm', 0] },
      });
      side.cut(pins.regionAt(d.value('originY + 37mm'), d.value('originZ + board + margin')), { depth: 12 });
      side.expect({ size: ['depth', 'height'], thickness: 'board', freedom: 0 });
      side.copy({ at: ['originX + width', 0, 0], x: '-y', y: '+z', mirrored: true, name: 'Right side' });

      const panel = (name: string, offset: string): PartEdit => {
        const part = d.newPart(name, { thickness: 'board' });
        part.profile.rect({ at: ['originX + board - housing', 'originY'], w: 'width - 2*board + 2*housing', h: 'depth - back' });
        part.drawOn('top', { offset: `originZ + ${offset}` });
        part.expect({ freedom: 0 });
        return part;
      };
      const bottom = panel('Bottom', '0mm'),
        top = panel('Top', 'height - board');
      const back = d.newPart('Back', { thickness: 'back' });
      back.profile.rect({ at: ['originX + board - housing', 'originZ'], w: 'width - 2*board + 2*housing', h: 'height' });
      back.drawOn('front', { offset: '-(originY + depth - back)', inward: true });
      d.cutParts(side, { with: [top, bottom, back] });

      const shelf = d.newPart('Shelf', { thickness: 'board' });
      shelf.profile.rect({ at: ['originX + board + 1mm', 'originY'], w: 'width - 2*board - 2mm', h: 'depth - back - 10mm' });
      shelf.drawOn('top', { offset: 'originZ + board + margin + pin/2' });
      shelf.pattern({ axis: 'z', count: 'shelves', spacing: 'shelfSpacing' });
      shelf.expect({ freedom: 0 });
    });
}
