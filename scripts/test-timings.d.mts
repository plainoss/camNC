import type { Reporter } from 'vitest/reporters';
export default class TimingReporter implements Reporter {
  constructor(options?: { suite?: string });
}
