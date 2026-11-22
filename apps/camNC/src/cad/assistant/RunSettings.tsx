import { t as translate, getLanguage } from '@wbcnc/i18n';
import type { AssistantLimits, AssistantPricing, AssistantRunUsage } from './runBudget';

export interface AssistantRunSettings {
  limits: AssistantLimits;
  pricing?: AssistantPricing;
}

/** Rates are entered for the user's endpoint/model, never guessed from a model name. */
export function RunSettings({
  value,
  usage,
  disabled,
  onChange,
}: {
  value: AssistantRunSettings;
  usage: AssistantRunUsage | null;
  disabled: boolean;
  onChange: (value: AssistantRunSettings) => void;
}) {
  const count = (number: number | null) => (number === null ? translate('unknown') : number.toLocaleString(getLanguage()));
  return (
    // Shown as a settings dialog section, which already is the disclosure: the form is open as soon as it is picked.
    <div className="cad-assistant-settings">
      <h3>{translate('Usage and limits')}</h3>
      {usage && (
        <p aria-label={translate('Last turn usage')}>
          {usage.calls}
          {translate(' requests · ')}
          {usage.checks}
          {translate(' checks · input ')}
          {count(usage.inputTokens)}
          {translate(' tokens · output ')}
          {count(usage.outputTokens)} {translate('tokens · cached ')}
          {count(usage.cacheReadTokens)}
          {translate(' tokens · cost ')}
          {usage.costUsd === null ? translate('unknown') : translate('${{value1}}', { value1: usage.costUsd.toFixed(4) })}
        </p>
      )}
      <fieldset disabled={disabled}>
        <legend>{translate('Per turn')}</legend>
        <label>
          {translate('Output tokens per request ')}
          <input
            type="number"
            min="1"
            step="1"
            value={value.limits.maxOutputTokens ?? 8192}
            onChange={event =>
              onChange({
                ...value,
                limits: { ...value.limits, maxOutputTokens: event.target.value ? Number(event.target.value) : undefined },
              })
            }
          />
        </label>
        <label>
          {translate('Total token limit (optional) ')}
          <input
            type="number"
            min="1"
            step="1"
            value={value.limits.maxTotalTokens ?? ''}
            onChange={event =>
              onChange({
                ...value,
                limits: { ...value.limits, maxTotalTokens: event.target.value ? Number(event.target.value) : undefined },
              })
            }
          />
        </label>
        <label>
          {translate('USD limit (optional) ')}
          <input
            type="number"
            min="0.0001"
            step="any"
            value={value.limits.maxCostUsd ?? ''}
            onChange={event =>
              onChange({ ...value, limits: { ...value.limits, maxCostUsd: event.target.value ? Number(event.target.value) : undefined } })
            }
          />
        </label>
        <label>
          <input
            type="checkbox"
            checked={!!value.pricing}
            onChange={event =>
              onChange({
                ...value,
                pricing: event.target.checked ? { inputUsdPerMillion: Number.NaN, outputUsdPerMillion: Number.NaN } : undefined,
              })
            }
          />
          {translate('Use my provider prices (USD per million tokens) ')}
        </label>
        {value.pricing &&
          (['inputUsdPerMillion', 'outputUsdPerMillion', 'cacheReadUsdPerMillion', 'cacheWriteUsdPerMillion'] as const).map(
            (key, index) => (
              <label key={key}>
                {
                  [
                    translate('Input price'),
                    translate('Output price'),
                    translate('Cache read price (optional)'),
                    translate('Cache write price (optional)'),
                  ][index]
                }
                <input
                  type="number"
                  min="0"
                  step="any"
                  value={Number.isFinite(value.pricing![key]) ? value.pricing![key] : ''}
                  onChange={event =>
                    onChange({
                      ...value,
                      pricing: {
                        ...value.pricing!,
                        [key]: event.target.value ? Number(event.target.value) : index < 2 ? Number.NaN : undefined,
                      },
                    })
                  }
                />
              </label>
            )
          )}
        {value.pricing && (
          <label>
            <input
              type="checkbox"
              checked={!!value.pricing.cacheWritesAtInputPrice}
              onChange={event => onChange({ ...value, pricing: { ...value.pricing!, cacheWritesAtInputPrice: event.target.checked } })}
            />
            {translate('Cache writes are billed at the input price ')}
          </label>
        )}
      </fieldset>
      <p>
        {translate(
          'Token and USD limits are checked between requests; the last request can exceed the remaining total. Missing usage or prices are shown as unknown and stop a capped run. Prices and limits last until this dock closes; check prices after changing models. '
        )}
      </p>
    </div>
  );
}
