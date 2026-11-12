import { beforeEach, inject } from 'vitest';
import { quarantineEntry, type QuarantineEntry } from '../../../../scripts/quarantine.mjs';

declare module 'vitest' {
  interface ProvidedContext {
    quarantine: QuarantineEntry[];
    quarantineOnly: boolean;
  }
}

type Task = { name: string; suite?: Task; file?: { name: string } };
const fullName = (task: Task): string => {
  const names: string[] = [];
  for (let at: Task | undefined = task; at && at !== task.file; at = at.suite) if (at.name) names.unshift(at.name);
  return [task.file?.name, ...names].filter(Boolean).join(' > ');
};

// Merge-queue batches skip the tests that have an open flaky-test issue (scripts/test-quarantine.mjs), then run only
// those in a step that doesn't gate the batch (`quarantineOnly`), which reports their failures. Every other run gets an
// empty list and runs everything.
const entries = inject('quarantine') ?? [];
const only = inject('quarantineOnly') ?? false;
if (entries.length) {
  beforeEach(context => {
    const name = fullName(context.task as Task);
    const entry = quarantineEntry(name, entries);
    if (only ? entry : !entry) return;
    if (entry) console.warn(`QUARANTINED ${name} (flaky-test issue #${entry.issue})`);
    context.skip();
  });
}
