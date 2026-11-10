/** Handwritten stool recipe: a 230 mm radius dodecagonal seat and 60 mm wide upright legs. */
export interface RadialStoolIntent {
  board: number;
  radius: number;
  legs: number;
  height: number;
  opposite: boolean;
  suppressed: boolean;
}

/** Exact local contours make equal area and equal envelope insufficient to pass the material gate. */
export function radialStoolProfiles(height: number) {
  const sort = (points: number[][]) => points.sort((a, b) => a[0]! - b[0]! || a[1]! - b[1]!);
  return [
    {
      name: 'Seat',
      points: sort(Array.from({ length: 12 }, (_, i) => [230 * Math.cos((i * Math.PI) / 6), 230 * Math.sin((i * Math.PI) / 6)])),
    },
    {
      name: 'Leg',
      points: sort([
        [-30, 0],
        [30, 0],
        [30, height],
        [-30, height],
      ]),
    },
  ];
}

export function radialStoolExpected(intent: RadialStoolIntent) {
  const { board, radius, height } = intent;
  return [
    {
      name: 'Seat',
      at: [-230, -230, height],
      size: [460, 460, board],
      center: [0, 0, height + board / 2],
      x: [1, 0, 0],
      y: [0, 1, 0],
      volume: 3 * 230 ** 2 * board,
    },
    ...Array.from({ length: intent.suppressed ? 1 : intent.legs }, (_, i) => {
      // A full ring has no repeated endpoint; the seed remains in its original slot.
      const angle = ((intent.opposite ? -1 : 1) * 2 * Math.PI * i) / intent.legs,
        c = Math.cos(angle),
        s = Math.sin(angle),
        halfX = 30 * Math.abs(c) + (board / 2) * Math.abs(s),
        halfY = 30 * Math.abs(s) + (board / 2) * Math.abs(c);
      return {
        name: i ? `Leg ${i + 1}` : 'Leg',
        at: [radius * c - halfX, radius * s - halfY, 0],
        size: [2 * halfX, 2 * halfY, height],
        center: [radius * c, radius * s, height / 2],
        x: [c, s, 0],
        y: [0, 0, 1],
        volume: 60 * height * board,
      };
    }),
  ];
}
