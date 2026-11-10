import { createPlateDocument, setPartPattern } from '@wbcnc/cad';
import { describe, expect, it } from 'vitest';
import { canonicalJson, fullCadReport } from './fullReport';

describe('part pattern diagnostics', () => {
  it('reports the actual circular line, angular settings and expressions instead of stale linear settings', async () => {
    let document = createPlateDocument({ width: 20, height: 30, thickness: 18 });
    document.parts[0]!.placement = { position: [100, 0, 0], rotation: [0, 0, 0, 1] };
    document.variables = [
      { id: 'arc', name: 'arc', expression: '120deg' },
      { id: 'instances', name: 'instances', expression: '3' },
    ];
    document = setPartPattern(document, document.parts[0]!.id, {
      axis: 'x',
      spacing: 1234,
      count: 3,
      countExpression: 'instances',
      circular: { origin: [11, 22, 33], axis: [2, 1, 0], angle: 120, angleExpression: 'arc', equalSpacing: false, opposite: true },
    });
    const report = await fullCadReport(document),
      feature = report.features.find(f => f.kind === 'pattern')!;
    expect(canonicalJson(feature.settings)).toEqual({
      count: { value: 3, expression: 'instances' },
      circular: {
        origin: [11, 22, 33],
        axis: [2, 1, 0],
        angle: { value: 120, expression: 'arc' },
        equalSpacing: false,
        opposite: true,
      },
    });
    expect(feature.result).toHaveProperty('copies');
  });

  it('makes circular spacing and direction defaults explicit in portable reports', async () => {
    let document = createPlateDocument({ width: 20, height: 30, thickness: 18 });
    document.parts[0]!.placement = { position: [100, 0, 0], rotation: [0, 0, 0, 1] };
    document = setPartPattern(document, document.parts[0]!.id, {
      axis: 'x',
      spacing: 100,
      count: 4,
      circular: { origin: [0, 0, 0], axis: [0, 0, 1], angle: 360 },
    });
    const report = await fullCadReport(document);
    expect(canonicalJson(report.features.find(f => f.kind === 'pattern')!.settings)).toEqual({
      count: { value: 4 },
      circular: { origin: [0, 0, 0], axis: [0, 0, 1], angle: { value: 360 }, equalSpacing: true, opposite: false },
    });
  });
});
