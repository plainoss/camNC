import { expect, it, vi } from 'vitest';
import type { FeatureEntry } from './FeatureList';
import { selectStudioFeature } from './studioFeatureSelection';

const selection = () => ({ sketch: vi.fn(), face: vi.fn(), part: vi.fn(), entities: vi.fn() });
const cut = (copyId?: string): FeatureEntry => ({
  kind: 'step',
  step: { id: 'notch', kind: 'partCut', label: 'Cut Shelf with Chase', partId: 'shelf', partCutId: 'notch', ...(copyId && { copyId }) },
});

it('selects the saved copy target when its Cut parts feature is picked', () => {
  const picked = selection();
  selectStudioFeature(() => false, picked)(cut('pattern:1'));
  expect(picked.part).toHaveBeenCalledExactlyOnceWith('shelf', 'pattern:1');
  expect(picked.entities).toHaveBeenCalledOnce();
});

it('keeps a source target as a family selection', () => {
  const picked = selection();
  selectStudioFeature(() => false, picked)(cut());
  expect(picked.part).toHaveBeenCalledExactlyOnceWith('shelf');
});

it('lets an active whole-sketch profile picker consume a sketch row before changing physical selection', () => {
  const picked = selection(),
    profile = vi.fn(() => true);
  selectStudioFeature(profile, picked)({ kind: 'step', step: { id: 'sketch', kind: 'sketch', partId: 'shelf', label: 'Sketch' } });
  expect(profile).toHaveBeenCalledExactlyOnceWith('shelf');
  for (const callback of Object.values(picked)) expect(callback).not.toHaveBeenCalled();
});
