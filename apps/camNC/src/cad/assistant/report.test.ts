import { expect, it } from 'vitest';
import { readAssistantReport, summarizeAssistantReport } from './report';

it('scopes sketch detail while retaining global diagnostics, lost openings, cuts, physical copies and assembly', () => {
  const sketch = { ref: 's', freedom: 0, status: 'solved', entities: [{ ref: 'e', type: 'circle', d: 60 }] };
  const report = {
    ok: false,
    status: 'conflict',
    errors: [{ code: 'parts-collide' }],
    warnings: [{ code: 'floor', part: 'Other' }],
    costs: ['A housing was lost.'],
    parts: [
      {
        name: 'Shelf',
        ref: 'abc',
        cuts: [{ ref: 'hole', through: true }],
        sketches: [sketch],
        copyFeatures: [{ name: 'Shelf 2', cuts: [{ ref: 'copy-hole' }] }],
      },
      {
        name: 'Other',
        ref: 'def',
        cuts: [{ ref: 'groove', from: 0, to: 6 }],
        sketches: [sketch],
        toolpaths: { operations: [{ label: 'heavy detail' }], warnings: ['small bit'], blocked: ['tab missing'] },
      },
    ],
    assembly: { collisions: [{ parts: ['Shelf', 'Other'] }], parts: [{ name: 'Shelf 2', size: [1, 2, 3] }] },
    steps: [{ kind: 'cutParts', openings: [] }],
    featureList: [{ ref: 'feature', label: 'Extrude' }],
  };
  const summary = summarizeAssistantReport(report, { partId: 'abc-full-id', partName: 'Shelf' });
  expect(summary.errors).toEqual(report.errors);
  expect(summary.warnings).toEqual(report.warnings);
  expect(summary.costs).toEqual(report.costs);
  expect(summary.assembly).toEqual(report.assembly);
  expect(summary.steps).toEqual(report.steps);
  const parts = summary.parts as typeof report.parts;
  expect(parts[0]).toEqual(report.parts[0]);
  expect(parts[1]!.sketches[0]).not.toHaveProperty('entities');
  expect(parts[1]!.cuts).toEqual(report.parts[1]!.cuts);
  expect(parts[1]!.toolpaths).toEqual({ warnings: ['small bit'], blocked: ['tab missing'] });
  expect(readAssistantReport(report, { part: 'def' })).toEqual({
    parts: [report.parts[1]],
    errors: report.errors,
    warnings: report.warnings,
  });
  expect(readAssistantReport(report, { section: 'parts' })).toEqual(report.parts);
  expect(readAssistantReport(report, { part: 'unknown' })).toHaveProperty('error');
  expect(readAssistantReport(report, { section: 'unknown' })).toHaveProperty('error');
});
