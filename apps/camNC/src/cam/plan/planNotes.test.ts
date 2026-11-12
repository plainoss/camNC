import { camPart } from '@wbcnc/cam';
import { describe, expect, it } from 'vitest';
import { friendly } from './planNotes';

/** A 200 x 60 x 12 board whose right end has 15 fingers of 4 mm, every other one cut 12 mm deep. */
function fingerBoard() {
  const end = Array.from({ length: 15 }, (_, i) => [
    { x: i % 2 ? 188 : 200, y: i * 4 },
    { x: i % 2 ? 188 : 200, y: (i + 1) * 4 },
  ]).flat();
  const outline = [{ x: 0, y: 0 }, ...end, { x: 0, y: 60 }];
  return {
    thickness: 12,
    footprint: [outline],
    outlines: [outline],
    throughHoles: [],
    levels: [{ z: 12, region: [outline], area: 200 * 60 - 7 * 4 * 12 }],
    pockets: [],
    bottomFaces: [],
    slopedArea: 0,
  };
}

describe('Plan notes', () => {
  it('fingers narrower than the bit: names the part and the width against the bit', () => {
    const { warnings } = camPart(fingerBoard(), { tools: [{ number: 1, diameter: 6, name: 'flat end mill' }] });
    // The board puts the part's name in front of each of its notes.
    const notes = warnings.map(w => friendly(`Front: ${w}`)).filter(w => w.includes('narrower than'));
    expect(notes).toEqual([
      'Front: 7 notches about 4 mm wide, such as a finger joint’s fingers, are narrower than the ⌀6 bit and won’t be cut: the outline runs straight across. Choose a smaller bit, or make the fingers wider.',
    ]);
  });
});
