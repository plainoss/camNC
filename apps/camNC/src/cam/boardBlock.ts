import { t as translate } from '@wbcnc/i18n';
import { spacingProblem } from './boards';
import type { PlanResult } from './camTypes';
import type { JobBoard, MissingPart } from './useJobBoards';

/** Why a board can't be cut: the Plan step's buttons and the machine queue ask the same functions. */
export interface BlockContext {
  /** The job's main bit. */
  bit: number;
  /** Parts that don't fit their board and aren't left out on purpose, of all boards. */
  missing: MissingPart[];
  sourceKey?: string;
}

/** Broken safety rules of the guided programs after the board's cutting. */
export const releaseProblems = (plan: PlanResult | undefined) => plan?.release?.flatMap(r => r.safety) ?? [];

/** Parts that would come loose: tabs were placed for them, but too few hold. */
export function loose(plan: PlanResult | undefined) {
  if (!plan?.hold) return [];
  return plan.hold.filter(h => !h.ok && ((h.id ? plan.holding?.find(x => x.id === h.id)?.how : undefined) ?? 'placed') === 'placed');
}

/** Stock that would turn or lift during the job, a part that comes loose, or a screw or clamp in the bit's way. */
export function unstable(plan: PlanResult | undefined) {
  return !!plan && ((plan.timeline ?? []).some(e => e.block) || (plan.holdClash ?? []).length > 0);
}

/** Keep this condition independent of the localized explanation shown to the operator. */
export function cutFromEarlierDesign(b: Pick<JobBoard, 'board'>, sourceKey?: string): boolean {
  return !!(b.board.cut?.sourceKey && sourceKey && b.board.cut.sourceKey !== sourceKey);
}

/** What's wrong with the board's layout, whatever its programs are. */
export function layoutBlock(
  b: Pick<JobBoard, 'board' | 'nest' | 'carvingProblem'>,
  { bit, missing, sourceKey }: BlockContext
): string | null {
  if (b.carvingProblem) return b.carvingProblem;
  if (cutFromEarlierDesign(b, sourceKey))
    return translate('This board was cut from an earlier design. Start over on Boards with a new physical sheet before using this design.');
  const sizeProblem = boardSizeProblem(b);
  if (sizeProblem) return sizeProblem;
  const own = missing.filter(m => m.board === b.board.name);
  if (own.length)
    return translate('boardPartsDoNotFit', {
      names: own.map(m => m.name).join(', '),
      count: own.length,
      board: b.board.name,
    });
  return spacingProblem(b.board, b.nest, bit);
}

export function boardSizeProblem(b: Pick<JobBoard, 'board' | 'nest'>): string | null {
  return b.nest.machineFits === false
    ? translate('Board {{value1}} is larger than the machine work area. Resize the board or use a larger machine before cutting.', {
        value1: b.board.name,
      })
    : null;
}

/** What's wrong with the board's programs: side A, side B and the guided ones after them. */
export function planBlock(plan: PlanResult): string | null {
  if (!plan.ops.length) return translate('Nothing to cut: its parts have no outline, hole or pocket this bit can cut.');
  const broken = [...plan.safety, ...(plan.sideB?.safety ?? []).map(s => `Side B: ${s}`), ...releaseProblems(plan)];
  if (broken.length)
    return translate('A safety check failed: {{value1}}{{value2}}', {
      value1: broken[0],
      value2: broken.length > 1 ? translate('andMore', { count: broken.length - 1 }) : '',
    });
  if (plan.flip?.problem) return plan.flip.problem;
  const looseParts = loose(plan);
  if (looseParts.length)
    return translate('{{value1}} would come loose: too few of the tabs hold.', { value1: looseParts.map(h => h.part).join(', ') });
  const pivot = plan.timeline?.find(e => e.block);
  if (pivot) return pivot.message;
  const clashes = plan.holdClash?.length ?? 0;
  if (clashes)
    return translate('{{value1}} in the bit’s way or on a part.', {
      value1: clashes === 1 ? translate('A screw or clamp is') : translate('{{value1}} screws or clamps are', { value1: clashes }),
    });
  return null;
}

/** Why the board can't be cut, or null. `plan`: its programs, when it has any. */
export function boardBlock(
  b: Pick<JobBoard, 'board' | 'nest' | 'carvingProblem'>,
  plan: PlanResult | undefined,
  context: BlockContext
): string | null {
  return layoutBlock(b, { ...context, sourceKey: context.sourceKey ?? plan?.sourceKey }) ?? (plan ? planBlock(plan) : null);
}
