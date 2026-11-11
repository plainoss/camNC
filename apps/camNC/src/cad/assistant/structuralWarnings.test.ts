import type { CadReport } from '@wbcnc/cad-script';
import { expect, it } from 'vitest';
import { structuralWarnings } from './structuralWarnings';

const report = (parts: { name: string; at: number[]; size: number[] }[]) => ({ assembly: { parts } }) as unknown as CadReport;
const codes = (input: CadReport) => structuralWarnings(input).map(warning => `${warning.code}:${warning.part ?? ''}`);

it('flags a part that touches nothing, a tall narrow piece and a thin stick', () => {
  const tall = report([
    { name: 'Left', at: [0, 0, 0], size: [18, 250, 1800] },
    { name: 'Right', at: [282, 0, 0], size: [18, 250, 1800] },
    { name: 'Shelf', at: [18, 0, 900], size: [264, 250, 18] },
    { name: 'Loose', at: [1000, 0, 0], size: [20, 20, 650] },
  ]);
  expect(codes(tall)).toEqual(['floating-part:Loose', 'may-tip:', 'slender-part:Loose']);
});

it('stays quiet for a sturdy cupboard and for a single board', () => {
  const cupboard = report([
    { name: 'Left', at: [0, 0, 0], size: [18, 400, 700] },
    { name: 'Right', at: [582, 0, 0], size: [18, 400, 700] },
    { name: 'Top', at: [18, 0, 682], size: [564, 400, 18] },
  ]);
  expect(codes(cupboard)).toEqual([]);
  expect(codes(report([{ name: 'Side', at: [0, 0, 0], size: [18, 300, 1200] }]))).toEqual([]);
});
