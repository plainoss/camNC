import { planAccuracy } from './accuracy';
import type { CamSettings } from './toolpathTypes';
import { CamInputError } from './validation';

/** Pass endpoints survive arc fitting; only output and controller quantization displace their commanded poses. */
export function pocketEndpointDeviation(settings: CamSettings): number {
  const budget = planAccuracy(settings.geometryTolerance, settings.sourceTolerance).budget;
  return budget.outputRounding + budget.controllerRounding;
}

/** Established fallback when the tighter spacing cannot prove coverage of the actual pocket geometry. */
export function conservativePocketRingSpacing(settings: CamSettings, diameter: number): number {
  const budget = planAccuracy(settings.geometryTolerance, settings.sourceTolerance).budget;
  const reserve = 2 * (budget.fitting + budget.outputRounding + budget.controllerRounding) + 0.001;
  const selected = settings.stepoverFactor * diameter;
  return selected > 2 * reserve ? selected - reserve : selected;
}

export function pocketRingSpacing(settings: CamSettings, diameter: number): number {
  const budget = planAccuracy(settings.geometryTolerance, settings.sourceTolerance).budget;
  const endpoints = budget.outputRounding + budget.controllerRounding;
  const selected = settings.stepoverFactor * diameter;
  const reserve = 2 * endpoints + 0.001;
  const hop = selected > 2 * reserve ? selected - reserve : selected;
  // Fitted ring interiors can deviate independently. Near a full-diameter stepover,
  // their worst-case separation must still overlap rather than leave an uncut strip.
  const margin = diameter - 2 * (budget.fitting + endpoints);
  if (margin <= 0)
    throw new CamInputError([{ field: 'geometryTolerance', message: 'leaves no positive pocket coverage margin for this cutter' }]);
  const coverage = margin - Math.min(0.001, margin / 2);
  return Math.min(hop, coverage);
}
