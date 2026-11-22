import { getLanguage, languages, saveLanguage, t, type Language } from '@wbcnc/i18n';
import { useState } from 'react';
import { getExistingCncApi } from '@/lib/fluidnc/machineInstance';

/** Language changes deliberately reload: translated module constants and worker code need a fresh session. */
export function LanguageSelector() {
  const [language, setLanguage] = useState(getLanguage());
  const [error, setError] = useState('');
  const changed = language !== getLanguage();
  function apply() {
    const api = getExistingCncApi();
    // Reloading a controller UI while running could interrupt supervision. Never do this during a job.
    if (api && api.isConnected.value && api.status.value?.state !== 'Idle') {
      setError(t('Change language while the machine is idle or disconnected.'));
      return;
    }
    if (!saveLanguage(language)) {
      setError(t('The language could not be saved. Allow local storage and try again.'));
      return;
    }
    window.location.reload();
  }
  return (
    <div className="space-y-1 px-2 py-1 text-xs">
      <label className="flex items-center justify-between gap-2">
        <span>{t('Language')}</span>
        <select
          aria-label={t('Language')}
          className="max-w-32 rounded border bg-sidebar p-1 text-sidebar-foreground"
          value={language}
          onChange={event => {
            setLanguage(event.target.value as Language);
            setError('');
          }}>
          {Object.entries(languages).map(([code, name]) => (
            <option key={code} value={code} lang={code}>
              {name}
            </option>
          ))}
        </select>
      </label>
      {changed && (
        <>
          <p>{t('Save your work before reloading to apply the language.')}</p>
          <button type="button" className="rounded border px-2 py-1" onClick={apply}>
            {t('Apply and reload')}
          </button>
        </>
      )}
      {error && <p role="alert">{error}</p>}
    </div>
  );
}
