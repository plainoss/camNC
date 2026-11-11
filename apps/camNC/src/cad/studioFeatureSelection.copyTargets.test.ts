import { createCadDocument, type CadDocument } from '@wbcnc/cad';
import { expect, it, vi } from 'vitest';
import type { FeatureEntry } from './FeatureList';
import { featureRowParts, selectStudioFeature } from './studioFeatureSelection';

type Step = Extract<FeatureEntry, { kind: 'step' }>['step'];
const selection = () => ({ sketch: vi.fn(), face: vi.fn(), part: vi.fn(), entities: vi.fn() });
const design = (targets: string[]): CadDocument => ({
  ...createCadDocument(),
  partCuts: [{ id: 'notch', tools: ['chase'], targets, clearance: 0 }],
});
const cut = (copyId?: string): Step => ({
  id: 'notch',
  kind: 'partCut',
  label: 'Cut Shelf with Chase',
  partId: 'shelf',
  partCutId: 'notch',
  ...(copyId && { copyId }),
});
const row = (step: Step): FeatureEntry => ({ kind: 'step', step });

it('selects the saved copy target when its Cut parts feature is picked', () => {
  const picked = selection();
  selectStudioFeature(design(['shelf:pattern:1']), () => false, picked)(row(cut('pattern:1')));
  expect(picked.part).toHaveBeenCalledExactlyOnceWith('shelf', 'pattern:1', ['shelf:pattern:1']);
  expect(picked.entities).toHaveBeenCalledOnce();
});

it('keeps a source target as a family selection', () => {
  const picked = selection();
  selectStudioFeature(design(['shelf']), () => false, picked)(row(cut()));
  expect(picked.part).toHaveBeenCalledExactlyOnceWith('shelf', undefined, ['shelf']);
});

it('stands for every target of a Cut parts row, not only the first it is listed under', () => {
  const document = design(['shelf:pattern:1', 'shelf:pattern:2']);
  expect(featureRowParts(document, cut('pattern:1'))).toEqual(['shelf:pattern:1', 'shelf:pattern:2']);
  const picked = selection();
  selectStudioFeature(document, () => false, picked)(row(cut('pattern:1')));
  expect(picked.part).toHaveBeenCalledExactlyOnceWith('shelf', 'pattern:1', ['shelf:pattern:1', 'shelf:pattern:2']);
});

it.each(['faceSketch', 'cut', 'copy'] as const)('stands for only the copy a %s row works on', kind => {
  const family: Step = { id: 'row', kind, label: 'Row', partId: 'side' };
  expect(featureRowParts(createCadDocument(), { ...family, copyId: 'right' })).toEqual(['side:right']);
  expect(featureRowParts(createCadDocument(), family)).toEqual(['side']);
});

it('lets an active whole-sketch profile picker consume a sketch row before changing physical selection', () => {
  const picked = selection(),
    profile = vi.fn(() => true);
  selectStudioFeature(createCadDocument(), profile, picked)(row({ id: 'sketch', kind: 'sketch', partId: 'shelf', label: 'Sketch' }));
  expect(profile).toHaveBeenCalledExactlyOnceWith('shelf');
  for (const callback of Object.values(picked)) expect(callback).not.toHaveBeenCalled();
});
