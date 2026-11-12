/** Words only, no geometry: the app reads these notes back without loading the planner. */

const round1 = (v: number) => +v.toFixed(1);

/** The note for an outline with `notches` the bit can't enter, the narrowest `width` mm wide. */
export function outlineNotchNote(index: number, notches: number, width: number, diameter: number): string {
  const count = notches === 1 ? '1 notch' : `${notches} notches`;
  return `outline ${index + 1}: ${count} about ${round1(width)} mm wide, narrower than the bit D=${diameter}: the outline runs straight across ${notches === 1 ? 'it' : 'them'}`;
}

/** What such a note (with or without its part's name in front) says. */
export function readOutlineNotchNote(warning: string): { notches: number; width: number; diameter: number } | undefined {
  const m = /outline \d+: (\d+) notch(?:es)? about ([\d.]+) mm wide, narrower than the bit D=([\d.]+)/.exec(warning);
  return m ? { notches: +m[1]!, width: +m[2]!, diameter: +m[3]! } : undefined;
}
