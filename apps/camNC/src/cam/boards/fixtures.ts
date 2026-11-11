import type { HoldPoint } from '@wbcnc/cam/holdPoints';
import type { BoardSide, Fixture } from '@wbcnc/cam/settle';
import type { HoldHardware } from '@wbcnc/cam-settings';
import { ceilMm } from './fitBoard';

/** The fixture as a hold point on a board of this size. */
export function holdPointOf(f: Fixture, board: { w: number; h: number }, hw: HoldHardware, nutAbove: number): HoldPoint {
  if (f.kind === 'screw') return { x: f.x, y: f.y, kind: 'screw', d: f.d ?? hw.screw.d, height: f.height ?? hw.screw.height, nutAbove };
  const [d, w, height] = [f.d ?? hw.clamp.d, f.w ?? hw.clamp.w, f.height ?? hw.clamp.height];
  const [at, dir] =
    f.side === 'left'
      ? [
          { x: d / 2, y: f.at },
          { x: 1, y: 0 },
        ]
      : f.side === 'right'
        ? [
            { x: board.w - d / 2, y: f.at },
            { x: -1, y: 0 },
          ]
        : f.side === 'bottom'
          ? [
              { x: f.at, y: d / 2 },
              { x: 0, y: 1 },
            ]
          : [
              { x: f.at, y: board.h - d / 2 },
              { x: 0, y: -1 },
            ];
  return { ...at, kind: 'clamp', d, w, height, dir, nutAbove };
}

/** The hold point as a fixture: the edge it grips, or where it sits, and the sizes it has apart from `hw`'s. */
export function fixtureOf(h: Pick<HoldPoint, 'kind' | 'x' | 'y' | 'dir' | 'd' | 'w' | 'height'>, hw: HoldHardware): Fixture {
  const round = (v: number) => Math.round(v * 10) / 10;
  const own = <K extends string>(key: K, v: number | undefined, base: number) =>
    v !== undefined && v !== base ? ({ [key]: v } as Record<K, number>) : {};
  if (h.kind === 'screw')
    return { kind: 'screw', x: round(h.x), y: round(h.y), ...own('d', h.d, hw.screw.d), ...own('height', h.height, hw.screw.height) };
  const side: BoardSide = h.dir?.x === 1 ? 'left' : h.dir?.x === -1 ? 'right' : h.dir?.y === 1 ? 'bottom' : 'top';
  return {
    kind: 'clamp',
    side,
    at: round(side === 'left' || side === 'right' ? h.y : h.x),
    ...own('d', h.d, hw.clamp.d),
    ...own('w', h.w, hw.clamp.w),
    ...own('height', h.height, hw.clamp.height),
  };
}

/** The fixtures on a board of this size: clamps slid back along their edge, screws off it gone. */
export function fixturesOn(fixtures: Fixture[] | undefined, size: { w: number; h: number }, hw: HoldHardware): Fixture[] {
  return (fixtures ?? []).flatMap((f): Fixture[] => {
    if (f.kind === 'screw') {
      const r = (f.d ?? hw.screw.d) / 2;
      return f.x >= r && f.y >= r && f.x <= size.w - r && f.y <= size.h - r ? [f] : [];
    }
    const len = f.side === 'left' || f.side === 'right' ? size.h : size.w;
    const half = (f.w ?? hw.clamp.w) / 2;
    return [{ ...f, at: Math.max(half, Math.min(len - half, f.at)) }];
  });
}

/** The size a fitted board can't get below without leaving a fixture off it. */
export function fixturesNeed(fixtures: Fixture[] | undefined, hw: HoldHardware) {
  let [w, h] = [0, 0];
  for (const f of fixtures ?? []) {
    if (f.kind === 'screw') {
      const r = (f.d ?? hw.screw.d) / 2;
      [w, h] = [Math.max(w, f.x + r), Math.max(h, f.y + r)];
    } else if (f.side === 'left' || f.side === 'right') h = Math.max(h, f.at + (f.w ?? hw.clamp.w) / 2);
    else w = Math.max(w, f.at + (f.w ?? hw.clamp.w) / 2);
  }
  return { w: ceilMm(w), h: ceilMm(h) };
}
