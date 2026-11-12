import { describe, expect, it } from 'vitest';
import type { PartFeatures } from './features';
import { polyArea } from './geom';
import { camPart } from './toolpaths';

type Pt = { x: number; y: number };

/** A 200 x 60 board whose right end has `count` fingers along its 60 mm, 12 mm deep: every other one cut away. */
function fingerBoard(count: number): Pt[] {
  const w = 60 / count;
  const end: Pt[] = [];
  for (let i = 0; i < count; i++) {
    const x = i % 2 ? 188 : 200;
    end.push({ x, y: i * w }, { x, y: (i + 1) * w });
  }
  return [{ x: 0, y: 0 }, ...end, { x: 0, y: 60 }];
}

function part(outline: Pt[]): PartFeatures {
  const area = Math.abs(polyArea([outline]));
  return {
    thickness: 12,
    footprint: [outline],
    outlines: [outline],
    throughHoles: [],
    levels: [{ z: 12, region: [outline], area }],
    pockets: [],
    bottomFaces: [],
    slopedArea: 0,
  };
}

const bit6 = { tools: [{ number: 1, diameter: 6, name: 'flat end mill' }] };
const notchWarnings = (warnings: string[]) => warnings.filter(w => w.includes('narrower than the bit'));

describe('outline notches narrower than the bit', () => {
  it('a finger joint with 4 mm fingers and a 6 mm bit is a plan problem: its slots would stay uncut', () => {
    // 15 fingers of 4 mm: 7 slots.
    const { warnings } = camPart(part(fingerBoard(15)), bit6);
    expect(notchWarnings(warnings)).toEqual([
      'outline 1: 7 notches about 4 mm wide, narrower than the bit D=6: the outline runs straight across them',
    ]);
  });

  it('fingers wider than the bit are cut, and inside corners alone are no problem', () => {
    // 5 fingers of 12 mm: the bit enters each slot.
    expect(notchWarnings(camPart(part(fingerBoard(5)), bit6).warnings)).toEqual([]);
    // An L-shaped part: its inside corner stays rounded, as any inside corner does.
    const l = [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 100, y: 40 },
      { x: 40, y: 40 },
      { x: 40, y: 100 },
      { x: 0, y: 100 },
    ];
    expect(notchWarnings(camPart(part(l), bit6).warnings)).toEqual([]);
  });

  it('a smaller bit fits the same fingers', () => {
    const { warnings } = camPart(part(fingerBoard(15)), { tools: [{ number: 1, diameter: 3.175, name: 'flat end mill' }] });
    expect(notchWarnings(warnings)).toEqual([]);
  });
});
