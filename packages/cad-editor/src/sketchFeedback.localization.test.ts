import { afterEach, expect, it } from 'vitest';
import { i18n } from '@wbcnc/i18n';
import { sketchDofStatus } from './sketchFeedback';
afterEach(async () => {
  await i18n.changeLanguage('en');
});
it('uses French degree-of-freedom labels and plurals', async () => {
  await i18n.changeLanguage('fr');
  expect(sketchDofStatus(1, false)).toBe('1 degré de liberté');
  expect(sketchDofStatus(2, false)).toBe('2 degrés de liberté');
  expect(sketchDofStatus(0, false)).toBe('Entièrement contrainte');
});
