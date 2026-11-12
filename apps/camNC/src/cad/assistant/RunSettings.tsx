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
  const count = (number: number | null) => (number === null ? 'unknown' : number.toLocaleString());
  return (
    // Shown as a settings dialog section, which already is the disclosure: the form is open as soon as it is picked.
    <div className="cad-assistant-settings">
      <h3>Usage and limits</h3>
      {usage && (
        <p aria-label="Last turn usage">
          {usage.calls} requests · {usage.checks} checks · input {count(usage.inputTokens)} tokens · output {count(usage.outputTokens)}{' '}
          tokens · cached {count(usage.cacheReadTokens)} tokens · cost {usage.costUsd === null ? 'unknown' : `$${usage.costUsd.toFixed(4)}`}
        </p>
      )}
      <fieldset disabled={disabled}>
        <legend>Per turn</legend>
        <label>
          Output tokens per request
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
          Total token limit (optional)
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
          USD limit (optional)
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
          Use my provider prices (USD per million tokens)
        </label>
        {value.pricing &&
          (['inputUsdPerMillion', 'outputUsdPerMillion', 'cacheReadUsdPerMillion', 'cacheWriteUsdPerMillion'] as const).map(
            (key, index) => (
              <label key={key}>
                {['Input price', 'Output price', 'Cache read price (optional)', 'Cache write price (optional)'][index]}
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
            Cache writes are billed at the input price
          </label>
        )}
      </fieldset>
      <p>
        Token and USD limits are checked between requests; the last request can exceed the remaining total. Missing usage or prices are
        shown as unknown and stop a capped run. Prices and limits last until this dock closes; check prices after changing models.
      </p>
    </div>
  );
}
