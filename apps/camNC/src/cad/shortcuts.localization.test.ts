import { expect, it, vi } from 'vitest';
import { studioSketchShortcuts } from './shortcuts';

vi.mock('@wbcnc/i18n', async importOriginal => {
  const actual = await importOriginal<typeof import('@wbcnc/i18n')>();
  return { ...actual, t: actual.i18n.getFixedT('fr') };
});

it('keeps sketch confirmation shortcuts when section titles are French', () => {
  const sketch = studioSketchShortcuts.find(section => section.id === 'sketch-session');
  expect(sketch?.title).toBe('Esquisse');
  expect(sketch?.items).toContainEqual({ label: 'Valider l’esquisse', key: 'Ctrl/⌘+Enter' });
  expect(sketch?.items).toContainEqual({ label: 'Valider l’esquisse et l’extruder', key: 'Shift+E' });
});
