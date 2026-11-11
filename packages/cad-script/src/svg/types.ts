/** Exact sketch geometry in millimetres, with CAD's upward-positive Y axis. */
export type SvgPoint = [number, number];
export type SvgSegment =
  | { kind: 'line'; points: [SvgPoint, SvgPoint] }
  | { kind: 'bezier'; points: SvgPoint[] }
  | { kind: 'conic'; points: [SvgPoint, SvgPoint, SvgPoint]; rho: number };
export interface SvgContour {
  segments: SvgSegment[];
  closed: boolean;
  /** Filled contours belonging to one SVG graphics element. */
  group: number;
  fillRule: 'nonzero' | 'evenodd';
}
export interface SvgBounds {
  at: SvgPoint;
  size: SvgPoint;
}
export interface SvgSketchAsset {
  version: 1;
  units: 'mm';
  contours: SvgContour[];
  bounds: SvgBounds;
  warnings: string[];
}
export interface SvgPlacement {
  /** Desired drawn-geometry bounds, not the SVG viewport. */
  width?: number;
  height?: number;
  /** Lower-left of the drawn geometry; defaults to the origin. */
  at?: SvgPoint;
  /** Uniform contain scaling by default. Set false explicitly to stretch. */
  preserveAspect?: boolean;
}
export const SVG_LIMITS = { bytes: 1_000_000, elements: 1024, depth: 32, segments: 1024, coordinate: 1_000_000, assets: 16 } as const;
export function finite(value: number, label = 'SVG coordinate'): number {
  if (!Number.isFinite(value) || Math.abs(value) > SVG_LIMITS.coordinate)
    throw new Error(`${label} is outside the supported finite range.`);
  return value;
}
