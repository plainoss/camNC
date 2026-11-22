import { afterEach, describe, expect, it, vi } from 'vitest';
import { getLanguage, i18n, resolveLanguage, t, workerLanguageName, languageFromWorkerName } from './index';
import en from './locales/en.json';
import fr from './locales/fr.json';

afterEach(async () => {
  await i18n.changeLanguage('en');
});

describe('language selection', () => {
  it('uses the first supported preference and handles regional tags', () => {
    expect(resolveLanguage(['de-DE', 'fr-CA', 'en-US'])).toBe('fr');
    expect(resolveLanguage(['en-GB', 'fr'])).toBe('en');
    expect(resolveLanguage(['FR_fr'])).toBe('fr');
    expect(resolveLanguage(['', 'invalid', 'ja'])).toBe('en');
    expect(resolveLanguage([])).toBe('en');
  });
});

describe('worker locale', () => {
  it('passes an explicit locale without changing worker messages', async () => {
    await i18n.changeLanguage('fr');
    expect(languageFromWorkerName(workerLanguageName('solver'))).toBe('fr');
    expect(languageFromWorkerName('solver:camnc-language=zz')).toBeUndefined();
    expect(languageFromWorkerName('solver')).toBeUndefined();
  });
});

describe('offline catalogs', () => {
  it('has a nonempty French translation for every English message', () => {
    expect(Object.keys(fr).sort()).toEqual(Object.keys(en).sort());
    for (const [key, text] of Object.entries(fr)) {
      expect(text.trim(), key).not.toBe('');
      const placeholders = (s: string) => [...s.matchAll(/{{\s*([^}]+)\s*}}/g)].map(m => m[1]).sort();
      expect(placeholders(text), key).toEqual(placeholders(en[key as keyof typeof en]));
    }
  });
  it('translates controls, tooltips and errors, retaining firmware command names', async () => {
    await i18n.changeLanguage('fr');
    expect(getLanguage()).toBe('fr');
    expect(t('Pause')).toBe('Pause');
    expect(t('Probe Z?')).toBe('Palper Z ?');
    expect(t('Home all axes ($H)')).toBe('Référencer tous les axes ($H)');
    expect(t('Could not list SD files')).toBe('Impossible de lister les fichiers SD');
  });
  it('interpolates data without treating it as translated text or markup', async () => {
    await i18n.changeLanguage('fr');
    expect(t('Could not run {{value1}}', { value1: '<my-file>.nc' })).toBe('Impossible d’exécuter <my-file>.nc');
    expect(t('Unsupported plane: {{plane}}', { plane: 'G99' })).toBe('Plan non pris en charge : G99');
  });
  it('uses language-specific plural rules', async () => {
    await i18n.changeLanguage('fr');
    expect(t('partCount', { count: 0 })).toBe('0 pièce');
    expect(t('partCount', { count: 1 })).toBe('1 pièce');
    expect(t('partCount', { count: 2 })).toBe('2 pièces');
    await i18n.changeLanguage('en');
    expect(t('partCount', { count: 0 })).toBe('0 parts');
  });
  it('falls back safely for missing languages and messages', async () => {
    await i18n.changeLanguage('zz');
    expect(t('Could not list SD files')).toBe('Could not list SD files');
    expect(t('An untranslated new message')).toBe('An untranslated new message');
  });
});

it('keeps CLI stdout clean when initialized', async () => {
  const log = vi.spyOn(console, 'info');
  vi.resetModules();
  await import('./index');
  expect(log).not.toHaveBeenCalled();
  log.mockRestore();
});
