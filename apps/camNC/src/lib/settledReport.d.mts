export interface SettledReportSnapshot {
  revision: number;
  pending: Record<string, number>;
}
export function describeSettled(snapshot: SettledReportSnapshot | null): string;
export function notSettled(timeout: number, snapshot: SettledReportSnapshot | null): Error;
