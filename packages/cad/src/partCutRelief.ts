import type { CadDocument, CadPart, CadPartCut } from './types';

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

/**
 * The smallest bit any of a part's corners is relieved for: its own setting, or a Cut parts step's override on its
 * openings. A split joint relieves both of its parts. CAM warns when the board's bit is wider than this.
 */
export function smallestCornerRelief(document: CadDocument, partId: string): number | undefined {
  const ofPart = (id: string) => id.split(':')[0] === partId;
  // Steps switched off on their own or in a suppressed folder cut nothing.
  const folderCuts = new Set(document.folders?.filter(folder => folder.suppressed).flatMap(folder => folder.partCutIds ?? []));
  const diameters = [
    document.parts.find(part => part.id === partId)?.cornerRelief?.diameter,
    ...(document.partCuts ?? [])
      .filter(step => !step.suppressed && !folderCuts.has(step.id))
      .filter(step => step.targets.some(ofPart) || (step.split !== undefined && step.tools.some(ofPart)))
      .map(step => step.cornerRelief?.diameter),
  ].filter((diameter): diameter is number => diameter !== undefined);
  return diameters.length ? Math.min(...diameters) : undefined;
}
