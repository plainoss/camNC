import { cleanup, render, screen, within } from '@testing-library/react';
import { addRectangle, createCadDocument, createCadPart, sketchRegions, solveCadDocument } from '@wbcnc/cad';
import { sketchFeedback } from '@wbcnc/cad-editor/sketchFeedback';
import { afterEach, expect, it } from 'vitest';
import { FeatureList } from './FeatureList';

afterEach(cleanup);

it('marks an Extrude broken when its picked regions no longer touch, while its sketch still closes', async () => {
  const part = { ...createCadPart('Plate', 18), drawnOn: { on: { plane: 'top' as const }, offset: 0 } };
  // Two outlines apart, both picked: every region is still there, but they no longer make one part.
  part.sketch = addRectangle(part.sketch, { x: 0, y: 0, width: 100, height: 50 });
  part.sketch = addRectangle(part.sketch, { x: 200, y: 0, width: 100, height: 50 });
  part.regions = sketchRegions(part.sketch).map(region => region.id);
  expect(part.regions).toHaveLength(2);
  const document = { ...createCadDocument(), parts: [part] };
  const feedback = sketchFeedback(await solveCadDocument(document));
  const message = 'The picked regions don’t touch. Extrude each into a part of its own.';
  expect(feedback).toMatchObject({ problems: [message], sketchProblems: [], featureProblems: { [part.id]: message } });
  render(
    <FeatureList
      document={document}
      selectedPartId={null}
      onSelect={() => {}}
      onAction={() => {}}
      onRename={() => {}}
      featureProblems={feedback.featureProblems}
    />
  );
  const features = screen.getByRole('region', { name: 'Features' });
  expect(
    within(features)
      .getByRole('button', { name: /Extrude · Plate/ })
      .closest('.cad-feature-broken')
  ).not.toBeNull();
  expect(
    within(features)
      .getByRole('button', { name: /Sketch · Plate/ })
      .closest('.cad-feature-broken')
  ).toBeNull();
});
