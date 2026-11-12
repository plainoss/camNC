import type { CadPart, CadPartCut } from './types';

/** Validate the bounded source setting before either loading or evaluating a design. */
export function partCutReliefIssue(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  if (!value || typeof value !== 'object' || Array.isArray(value)) return 'Invalid Cut parts corner relief.';
  const setting = value as { diameter?: unknown; diameterExpression?: unknown };
  if (
    Object.keys(setting).some(key => key !== 'diameter' && key !== 'diameterExpression') ||
    typeof setting.diameter !== 'number' ||
    !Number.isFinite(setting.diameter) ||
    setting.diameter <= 0 ||
    (setting.diameterExpression !== undefined && (typeof setting.diameterExpression !== 'string' || !setting.diameterExpression.trim()))
  )
    return 'Cut parts corner relief needs a positive finite cutter diameter and a valid expression.';
  return null;
}

/** An explicit Off must not fall back to the part-wide setting. */
export const effectivePartCutRelief = (step: CadPartCut, target: CadPart) =>
  step.cornerRelief === undefined ? target.cornerRelief : step.cornerRelief;
