import { describe, expect, it } from 'vitest';
import { checkStudio } from './adapters/studioModel.mjs';

const actual = {
  features: [
    { name: 'Sketch 1', state: [] },
    { name: 'Extrude 1', state: ['suppressed'] },
    { name: 'Sketch 2', state: ['hidden', 'rolled back'] },
  ],
  parts: [{ name: 'Part 1', hidden: false }, { name: 'Part 2', hidden: true }],
  dialog: null,
};

describe('Part Studio end state', () => {
  it('checks the Feature list rows in order, and their state only where named', () => {
    expect(checkStudio({ features: ['Sketch 1', { name: 'Extrude 1', state: ['suppressed'] }, { name: 'Sketch 2', state: ['rolled back', 'hidden'] }] }, actual)).toEqual([]);
    expect(checkStudio({ features: ['Sketch 1', 'Extrude 1'] }, actual)).toEqual(['studio/features: wanted rows ["Sketch 1","Extrude 1"], got ["Sketch 1","Extrude 1","Sketch 2"]']);
    expect(checkStudio({ features: ['Sketch 1', { name: 'Extrude 1', state: [] }, 'Sketch 2'] }, actual)).toEqual(['studio/features/Extrude 1/state: wanted [], got ["suppressed"]']);
    expect(checkStudio({ features: [] }, { features: null })).toHaveLength(1);
  });
  it('checks the Parts list rows, their count and hidden parts', () => {
    expect(checkStudio({ parts: ['Part 1', { name: 'Part 2', hidden: true }] }, actual)).toEqual([]);
    expect(checkStudio({ parts: ['Part 1'] }, actual)).toHaveLength(1);
    expect(checkStudio({ parts: ['Part 1', { name: 'Part 2', hidden: false }] }, actual)).toEqual(['studio/parts/Part 2/hidden: wanted false, got true']);
  });
  it('checks that no dialog is open', () => {
    expect(checkStudio({ dialog: null }, actual)).toEqual([]);
    expect(checkStudio({ dialog: null }, { dialog: 'Extrude · Part 1' })).toHaveLength(1);
  });
});
