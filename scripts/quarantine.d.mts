export type QuarantineEntry = { test: string; issue: number; prefix: boolean };
export const QUARANTINE_MS: number;
export function quarantinedTests(issues: { title: string; number: number; updated_at: string; labels?: { name: string }[]; pull_request?: unknown }[], now: number): QuarantineEntry[];
export function quarantineEntry(fullName: string, entries: readonly QuarantineEntry[]): QuarantineEntry | undefined;
