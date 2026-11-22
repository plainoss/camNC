import { t as translate } from '@wbcnc/i18n';
import type { NativeSvgConfig } from './nativeSvg';

export interface NativeSvgConnection extends NativeSvgConfig {
  key: string;
  supportsSvg: boolean;
  format?: 'svg' | 'png';
}

/** Native image generation has a separate session-only connection; design-provider keys are never copied here. */
export function NativeSvgSettings({
  value,
  disabled,
  onChange,
}: {
  value: NativeSvgConnection;
  disabled: boolean;
  onChange: (value: NativeSvgConnection) => void;
}) {
  const inputClass = 'min-h-11 w-full rounded-md border bg-background p-2 text-base';
  return (
    <fieldset disabled={disabled} className="space-y-3">
      <legend>{translate('Image generator')}</legend>
      <p className="text-sm">
        {translate(
          'Use a provider and model with image generation enabled for your project. These credentials stay in this panel until it closes. '
        )}
      </p>
      <label className="block">
        {translate('Image generator API address ')}
        <input
          type="url"
          className={inputClass}
          value={value.endpoint}
          onChange={event => onChange({ ...value, endpoint: event.target.value })}
        />
      </label>
      <label className="block">
        {translate('Image generator model ID ')}
        <input className={inputClass} value={value.model} onChange={event => onChange({ ...value, model: event.target.value })} />
      </label>
      <label className="block">
        {translate('Image generator API key ')}
        <input
          type="password"
          autoComplete="off"
          className={inputClass}
          value={value.key}
          onChange={event => onChange({ ...value, key: event.target.value })}
        />
      </label>
      <label className="block">
        {translate('Image output ')}
        <select
          className={inputClass}
          value={value.format ?? 'png'}
          onChange={event => onChange({ ...value, format: event.target.value as 'svg' | 'png' })}>
          <option value="svg">{translate('Vector artwork (SVG)')}</option>
          <option value="png">{translate('Monochrome image (PNG), traced locally')}</option>
        </select>
      </label>
      <label className="block">
        {translate('Image generator quality ')}
        <select
          className={inputClass}
          value={value.quality}
          onChange={event => onChange({ ...value, quality: event.target.value as NativeSvgConfig['quality'] })}>
          <option value="low">{translate('Low')}</option>
          <option value="medium">{translate('Medium')}</option>
          <option value="high">{translate('High')}</option>
        </select>
      </label>
      <label className="flex items-start gap-2 text-sm">
        <input type="checkbox" checked={value.supportsSvg} onChange={event => onChange({ ...value, supportsSvg: event.target.checked })} />
        {translate('My model and project support this image output. ')}
      </label>
      <p className="text-sm">
        {translate(
          'Image generation creates new artwork. Image output cost is unknown; USD-capped runs require text SVG generation. Use text SVG generation to revise a saved composition. '
        )}
      </p>
    </fieldset>
  );
}
