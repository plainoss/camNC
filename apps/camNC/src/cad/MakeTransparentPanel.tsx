import { t as translate } from '@wbcnc/i18n';
const kUnsupported = translate('Not available yet');

/**
 * The Part menu's Make transparent panel, as the reference opens it: the parts picked are drawn see-through until it's
 * closed or Exit make transparent is chosen. Its other controls are shown greyed until camNC has them.
 */
export function MakeTransparentPanel({ onClose }: { onClose: () => void }) {
  return (
    <div role="dialog" aria-label={translate('Make transparent')} className="cad-feature-dialog cad-make-transparent">
      <header>
        <strong>{translate('Make transparent')}</strong>
        <button type="button" aria-label={translate('Exit make transparent')} onClick={onClose}>
          ✕
        </button>
      </header>
      <fieldset>
        <legend>{translate('Transparency')}</legend>
        <label title={kUnsupported}>
          <input type="checkbox" disabled />
          {translate(' Select transparent geometry ')}
        </label>
        <label title={kUnsupported}>
          <span className="sr-only">{translate('Transparency')}</span>
          <input type="range" min={0} max={100} defaultValue={70} disabled aria-label={translate('Transparency')} />
        </label>
      </fieldset>
      <fieldset>
        <legend>{translate('Component')}</legend>
        <label title={kUnsupported}>
          {translate('Expand: distance ')}
          <input type="range" min={0} max={100} defaultValue={0} disabled aria-label={translate('Expand distance')} />
        </label>
      </fieldset>
    </div>
  );
}
