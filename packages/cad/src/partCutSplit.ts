import type { CadPartCut } from './types';

/** Whether a split describes alternating segments that can form a joint. */
export function validPartCutSplit(split: unknown): split is CadPartCut['split'] {
  return (
    split === undefined ||
    split === 'half' ||
    (!!split &&
      typeof split === 'object' &&
      'fingers' in split &&
      Number.isInteger(split.fingers) &&
      (split.fingers as number) >= 2 &&
      (!('fingersExpression' in split) || split.fingersExpression === undefined || typeof split.fingersExpression === 'string'))
  );
}
