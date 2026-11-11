import type { CarvingGenerationConstraints } from '../generation';

export interface CarvingToolHint {
  angleDeg: number;
  diameterMm: number;
  maxDepthMm: number;
}

const round = (n: number, digits = 2) => Number(n.toFixed(digits));

/**
 * The physical limits of the selected V-bit, in mm and in the units of a recommended viewBox for the requested
 * envelope, so the model can size strokes and gaps it would otherwise guess at.
 */
export function toolGuidance(constraints: CarvingGenerationConstraints, tool: CarvingToolHint) {
  const slope = Math.tan((tool.angleDeg * Math.PI) / 360);
  const depthCapMm = Math.min(tool.maxDepthMm, tool.diameterMm / 2 / slope);
  const halfWidthAtDepthMm = depthCapMm * slope;
  const minBlackStrokeMm = Math.max(2 * constraints.minFeatureMm, 1);
  const minWhiteLandMm = Math.max(2 * constraints.minFeatureMm, halfWidthAtDepthMm);
  const long = Math.max(constraints.widthMm, constraints.heightMm);
  const unitsPerMm = 1000 / long;
  const units = (mm: number) => Math.ceil(mm * unitsPerMm);
  return {
    vBit: { angleDeg: tool.angleDeg, diameterMm: tool.diameterMm, maxDepthMm: round(depthCapMm) },
    widestVCutMm: round(2 * halfWidthAtDepthMm),
    minBlackStrokeMm: round(minBlackStrokeMm),
    minWhiteLandMm: round(minWhiteLandMm),
    recommendedViewBox: `0 0 ${Math.round(constraints.widthMm * unitsPerMm)} ${Math.round(constraints.heightMm * unitsPerMm)}`,
    unitsPerMm: round(unitsPerMm, 3),
    minBlackStrokeUnits: units(minBlackStrokeMm),
    minWhiteLandUnits: units(minWhiteLandMm),
  };
}

export const toolInstructions = `
The request includes "tool": the V-bit and its limits for this exact size. Use its recommendedViewBox so the given unit sizes apply.
Every black stroke, dot, tail, whisker and tapering tip must be at least minBlackStrokeUnits wide along its whole length; end strokes round, never as hairline points.
Every white gap, land, eye highlight and space between two black shapes must be at least minWhiteLandUnits wide; merge or drop details that would be narrower.
Black areas wider than widestVCutMm are fine: they are cleared flat at the maximum depth.`;
