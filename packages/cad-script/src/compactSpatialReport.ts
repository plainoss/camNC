import type { CadSpatialReport } from './spatialReport';

export interface CadCompactSpatialStage {
  /** Actual physical output count at this operation, including unplaced pieces. */
  physicalCount: number;
  placedCount: number;
  diagnosticCodes: string[];
  /** Number of reported openings; it does not imply an occupied volume or combined cut shape. */
  openingCount?: number;
}

/** Keep the final physical state once; model-facing history contains no repeated per-copy geometry. */
export function compactSpatialReport(report: CadSpatialReport) {
  return {
    ...report,
    operations: report.operations.map(({ after, ...operation }) => {
      const summary: CadCompactSpatialStage = {
        physicalCount: after.physical.length,
        placedCount: after.physical.filter(body => body.placement !== null).length,
        diagnosticCodes: [...after.diagnosticCodes],
        ...(after.openings && { openingCount: after.openings.length }),
      };
      return { ...operation, after: summary };
    }),
  };
}

export type CadCompactSpatialReport = ReturnType<typeof compactSpatialReport>;
