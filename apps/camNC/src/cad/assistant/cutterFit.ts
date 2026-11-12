import type { CadDocument } from '@wbcnc/cad';
import type { CadReport } from '@wbcnc/cad-script';
import type { AssistantRequirementCheck } from './requirements';

/** The bit inspection plans with when a check names none, mm. */
export const kDefaultCheckBit = 3.175;

/** Joints a square part fits into, where the cutter's radius decides whether the corners seat. */
const kMortiseRequest = /\b(?:mortises?|tenons?|dados?|finger[- ]joints?|box joints?|housings?|slots?)\b/i;
const kCutterWord = String.raw`(?:flat\s+|end\s*|router\s+|spiral\s+|upcut\s+|downcut\s+)*(?:mill|cutter|bit|tool)`;
/** "6 mm end mill", "a 3.175mm bit", "cutter: 6 mm", "bit of 1/4 inch". */
const kCutterPatterns: [RegExp, (match: RegExpExecArray) => number][] = [
  [new RegExp(String.raw`(\d+(?:[.,]\d+)?)\s*mm\s+${kCutterWord}`, 'gi'), m => Number(m[1]!.replace(',', '.'))],
  [
    new RegExp(String.raw`${kCutterWord}\s*(?:of|is|:|=|diameter|⌀)?\s*⌀?\s*(\d+(?:[.,]\d+)?)\s*mm`, 'gi'),
    m => Number(m[1]!.replace(',', '.')),
  ],
  [new RegExp(String.raw`(\d+)\s*/\s*(\d+)\s*(?:"|in(?:ch)?)\s+${kCutterWord}`, 'gi'), m => (Number(m[1]) / Number(m[2])) * 25.4],
];

/** The cutter diameter the user named, mm: the last one they gave, as a later message can change it. */
export function requestedCutter(requests: readonly string[]): number | undefined {
  let found: { at: number; diameter: number } | undefined;
  requests.forEach((text, index) => {
    for (const [pattern, diameter] of kCutterPatterns)
      for (const match of text.matchAll(pattern)) {
        const value = diameter(match as RegExpExecArray);
        const at = index * 1e6 + match.index!;
        if (value >= 0.5 && value <= 25 && (!found || at > found.at)) found = { at, diameter: Math.round(value * 1000) / 1000 };
      }
  });
  return found?.diameter;
}

/** Whether the design adds or changes a Cut parts step: the openings a corner-reach check is about. */
function changesCutParts(base: CadDocument, document: CadDocument): boolean {
  const before = new Map((base.partCuts ?? []).map(step => [step.id, JSON.stringify(step)]));
  return (document.partCuts ?? []).some(step => before.get(step.id) !== JSON.stringify(step));
}
const applies = (requests: readonly string[], base: CadDocument, document: CadDocument) =>
  requests.some(text => kMortiseRequest.test(text)) && changesCutParts(base, document);

/**
 * For a mortise-and-tenon request with a cutter the user named, a check counts only when it was made with that bit:
 * the mating corners are then measured against the cutter that will cut them, not the default one.
 */
export function cutterCheck(
  requests: readonly string[],
  base: CadDocument,
  document: CadDocument,
  bit: number | undefined
): AssistantRequirementCheck | undefined {
  const cutter = requestedCutter(requests);
  if (cutter === undefined || !applies(requests, base, document) || (bit !== undefined && Math.abs(bit - cutter) < 1e-3)) return undefined;
  return {
    requirement: 'cutter',
    passed: false,
    expected: cutter,
    actual: bit ?? kDefaultCheckBit,
    message: `The user cuts with a ⌀${cutter} mm bit. Check this design with bit: ${cutter}, so its mortise corners are measured for that cutter.`,
  };
}

/**
 * What a proposal must say about the fit of its mortises, from the trusted check: that the cutter was unknown and only
 * the default bit was checked, and each opening whose corners the bit doesn't reach, by the part that cuts it.
 */
export function cutterFitNotes(
  requests: readonly string[],
  base: CadDocument,
  document: CadDocument,
  report: CadReport | undefined
): string[] {
  if (!applies(requests, base, document)) return [];
  const notes: string[] = [];
  if (requestedCutter(requests) === undefined)
    notes.push(
      `No cutter diameter was given, so the mortise corners were checked only for the default ⌀${kDefaultCheckBit} mm bit. Say which bit you cut with to check them for it.`
    );
  for (const warning of report?.warnings ?? []) if (warning.code === 'corner-unreachable') notes.push(warning.message);
  return notes;
}
