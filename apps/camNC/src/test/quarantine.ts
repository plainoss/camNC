import { beforeEach, inject } from 'vitest';
import { quarantineEntry, type QuarantineEntry } from '../../../../scripts/quarantine.mjs';

declare module 'vitest' {
  interface ProvidedContext {
    quarantine: QuarantineEntry[];
  }
}

type Task = { name: string; suite?: Task; file?: { name: string } };
const fullName = (task: Task): string => {
  const names: string[] = [];
  for (let at: Task | undefined = task; at && at !== task.file; at = at.suite) if (at.name) names.unshift(at.name);
  return [task.file?.name, ...names].filter(Boolean).join(' > ');
};

// Merge-queue batches skip the tests that have an open flaky-test issue (scripts/test-quarantine.mjs). Every other run
// gets an empty list and runs them.
const entries = inject('quarantine') ?? [];
if (entries.length) {
  beforeEach(context => {
    const entry = quarantineEntry(fullName(context.task as Task), entries);
    if (!entry) return;
    console.warn(`QUARANTINED ${fullName(context.task as Task)} (flaky-test issue #${entry.issue})`);
    context.skip();
  });
}
