import { createInstance, type i18n as I18n } from 'i18next';
import en from './locales/en.json';
import fr from './locales/fr.json';

export const languages = { en: 'English', fr: 'Français' } as const;
export type Language = keyof typeof languages;
export const languageStorageKey = 'camnc.language';

export function resolveLanguage(preferences: readonly string[]): Language {
  for (const preference of preferences) {
    const base = preference.toLowerCase().split(/[-_]/)[0];
    if (base && Object.hasOwn(languages, base)) return base as Language;
  }
  return 'en';
}

/** Worker names carry only a locale, so isolated workers need no storage access or extra protocol messages. */
export function workerLanguageName(name = 'camNC'): string {
  return `${name}:camnc-language=${getLanguage()}`;
}

export function languageFromWorkerName(name: string): Language | undefined {
  const value = name.match(/:camnc-language=([a-z]+)$/)?.[1];
  return value && Object.hasOwn(languages, value) ? (value as Language) : undefined;
}

function initialLanguage(): Language {
  // Node CLI reports are machine-readable and remain English; browsers/workers choose their UI locale.
  if (typeof window === 'undefined' && typeof self === 'undefined') return 'en';
  if (typeof document === 'undefined' && typeof self !== 'undefined') {
    const workerLanguage = languageFromWorkerName(self.name ?? '');
    if (workerLanguage) return workerLanguage;
  }
  try {
    const saved = globalThis.localStorage?.getItem(languageStorageKey);
    if (saved && Object.hasOwn(languages, saved)) return saved as Language;
  } catch {
    // Privacy modes may deny storage. Browser preferences still work.
  }
  return resolveLanguage(typeof navigator === 'undefined' ? [] : (navigator.languages ?? [navigator.language]));
}

export const i18n: I18n = createInstance();
void i18n.init({
  // CLI consumers emit JSON on stdout; library initialization must stay silent.
  showSupportNotice: false,
  lng: initialLanguage(),
  fallbackLng: 'en',
  supportedLngs: Object.keys(languages),
  resources: { en: { translation: en }, fr: { translation: fr } },
  initImmediate: false,
  keySeparator: false,
  nsSeparator: false,
  interpolation: { escapeValue: false },
  returnNull: false,
});

/** Also usable from event handlers and non-React modules; never translate protocol values. */
export function t(message: string, values?: Record<string, unknown>): string {
  return i18n.t(message, values ?? {}) as string;
}

export function getLanguage(): Language {
  return resolveLanguage([i18n.resolvedLanguage ?? 'en']);
}

/** Persist only. Applying a language reloads the UI, so module-level labels are refreshed too. */
export function saveLanguage(language: Language): boolean {
  try {
    localStorage.setItem(languageStorageKey, language);
    return true;
  } catch {
    return false;
  }
}

export function applyDocumentLanguage() {
  if (typeof document !== 'undefined') document.documentElement.lang = getLanguage();
}
applyDocumentLanguage();
