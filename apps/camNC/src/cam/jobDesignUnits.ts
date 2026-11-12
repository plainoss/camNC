import { migrateDesignUnitNumbers, type CadDocument } from '@wbcnc/cad';
import type { CamJobV1 } from './jobDb';

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const migrated = (document: CadDocument) => {
  const next = migrateDesignUnitNumbers(document);
  return same(next, document) ? document : next;
};

/**
 * A stored design job, with `migrateDesignUnitNumbers` applied to its draft and accepted design: an inch or cm design
 * saved before plain numbers took the design's unit says `t + 0.125 mm` where it meant mm. The same job when there's
 * nothing to change, so a caller can tell whether to store it.
 */
export function withDesignUnitNumbers(job: CamJobV1): CamJobV1 {
  if (!job.design) return job;
  const draft = migrated(job.design.draft),
    accepted = job.design.accepted && migrated(job.design.accepted);
  if (draft === job.design.draft && accepted === job.design.accepted) return job;
  return { ...job, design: { ...job.design, draft, ...(accepted && { accepted }) } };
}
