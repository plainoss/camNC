import { t as translate } from '@wbcnc/i18n';
import type { ReactNode } from 'react';
import { CadValueInput } from './CadValueInput';
import { forDrillSize, kDrillSizes, kTerminations, type HoleKind, type HoleSettings } from './holeSettings';

const kUnsupported = translate('Not available yet');
const kKinds: { id: HoleKind; label: string }[] = [
  { id: 'simple', label: translate('Simple') },
  { id: 'counterbore', label: translate('Counterbore') },
  { id: 'countersink', label: translate('Countersink') },
];

/**
 * A Hole dialog's fields, in the reference's order: the unit and hole tabs, what's picked (`picks`), the drill, where
 * it starts and ends, and the sizes of the hole's kind. `onCommit` applies a typed value, on Enter or leaving it.
 */
export function HoleFields({
  settings,
  onChange,
  onCommit,
  lengthUnit,
  picks,
}: {
  settings: HoleSettings;
  onChange: (next: HoleSettings) => void;
  onCommit?: (next: HoleSettings) => void;
  lengthUnit: string;
  picks: ReactNode;
}) {
  const set = (change: Partial<HoleSettings>, commit = false) => {
    const next = { ...settings, ...change };
    onChange(next);
    if (commit) onCommit?.(next);
  };
  const field = (label: string, key: keyof HoleSettings, unit: string) => (
    <label className="cad-number-field">
      {label}
      <span>
        <CadValueInput
          bare
          aria-label={label}
          value={settings[key] as string}
          onChange={event => set({ [key]: event.target.value })}
          onBlur={() => onCommit?.(settings)}
          onKeyDown={event => event.key === 'Enter' && onCommit?.(settings)}
        />
      </span>
      {unit}
    </label>
  );
  const overridden = Math.abs(Number(settings.diameter) - settings.drillSize) > 1e-9;
  const blind = settings.termination === 'blind';
  return (
    <>
      <div className="cad-feature-tabs" role="tablist" aria-label={translate('Hole standard')}>
        {['Inch', 'Metric'].map(choice => (
          <button
            key={choice}
            type="button"
            role="tab"
            aria-selected={choice === 'Metric'}
            disabled={choice !== 'Metric'}
            title={choice === 'Metric' ? undefined : kUnsupported}>
            {choice}
          </button>
        ))}
      </div>
      <div className="cad-feature-tabs" role="tablist" aria-label={translate('Hole style')}>
        {kKinds.map(kind => (
          <button
            key={kind.id}
            type="button"
            role="tab"
            aria-selected={settings.kind === kind.id}
            onClick={() => set({ kind: kind.id }, true)}>
            {kind.label}
          </button>
        ))}
      </div>
      {picks}
      <label className="cad-number-field">
        {translate('Hole type ')}
        <select aria-label={translate('Hole type')} value="drilled" disabled title={kUnsupported}>
          <option value="drilled">{translate('Drilled')}</option>
        </select>
      </label>
      <label className="cad-number-field">
        {translate('Drill size ')}
        <select
          aria-label={translate('Drill size')}
          value={settings.drillSize}
          onChange={event => {
            const next = forDrillSize(settings, Number(event.target.value));
            onChange(next);
            onCommit?.(next);
          }}>
          {kDrillSizes.map(size => (
            <option key={size} value={size}>
              {size}
            </option>
          ))}
        </select>
      </label>
      {field('Diameter', 'diameter', lengthUnit)}
      {overridden && (
        <p role="note" className="cad-dialog-note">
          {translate('Parameters have been overridden. Check input. ')}
        </p>
      )}
      <label className="cad-number-field">
        {translate('Start plane ')}
        <select aria-label={translate('Start plane')} value="part" disabled title={kUnsupported}>
          <option value="part">{translate('Start from part')}</option>
        </select>
      </label>
      <label className="cad-number-field">
        {translate('Termination ')}
        <select
          aria-label={translate('Termination')}
          value={settings.termination}
          onChange={event => set({ termination: event.target.value as HoleSettings['termination'] }, true)}>
          {kTerminations.map(option => (
            <option key={option.id} value={option.id} disabled={!option.available} title={option.available ? undefined : kUnsupported}>
              {option.label}
            </option>
          ))}
        </select>
      </label>
      {settings.kind === 'counterbore' && (
        <>
          {field(translate('Counterbore diameter'), 'counterboreDiameter', lengthUnit)}
          {field(translate('Counterbore depth'), 'counterboreDepth', lengthUnit)}
        </>
      )}
      {settings.kind === 'countersink' && (
        <>
          {field(translate('Countersink diameter'), 'countersinkDiameter', lengthUnit)}
          {field(translate('Countersink angle'), 'countersinkAngle', 'deg')}
        </>
      )}
      {blind && (
        <>
          {field(translate('Hole depth'), 'depth', lengthUnit)}
          {field(translate('Tip angle'), 'tipAngle', 'deg')}
        </>
      )}
    </>
  );
}
