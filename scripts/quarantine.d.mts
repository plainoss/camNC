export type QuarantineEntry = { test: string; issue: number; prefix: boolean };
export function quarantinedTests(issues: { title: string; number: number; pull_request?: unknown }[]): QuarantineEntry[];
export function quarantineEntry(fullName: string, entries: readonly QuarantineEntry[]): QuarantineEntry | undefined;
