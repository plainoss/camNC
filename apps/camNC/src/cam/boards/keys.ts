import type { PartPosition } from '../boards';

export const thicknessKey = (t: number) => +t.toFixed(1);

export const letter = (i: number) => (i < 26 ? String.fromCharCode(65 + i) : `B${i + 1}`);

/** The spots of these bodies only. */
export const onlyFor = (at: Record<string, PartPosition>, ids: string[]) =>
  Object.fromEntries(Object.entries(at).filter(([id]) => ids.includes(id)));
