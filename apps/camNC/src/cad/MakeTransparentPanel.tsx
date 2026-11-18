const kUnsupported = 'Not available yet';

/**
 * The Part menu's Make transparent panel, as the reference opens it: the parts picked are drawn see-through until it's
 * closed or Exit make transparent is chosen. Its other controls are shown greyed until camNC has them.
 */
export function MakeTransparentPanel({ onClose }: { onClose: () => void }) {
  return (
    <div role="dialog" aria-label="Make transparent" className="cad-feature-dialog cad-make-transparent">
      <header>
        <strong>Make transparent</strong>
        <button type="button" aria-label="Exit make transparent" onClick={onClose}>
          ✕
        </button>
      </header>
      <fieldset>
        <legend>Transparency</legend>
        <label title={kUnsupported}>
          <input type="checkbox" disabled /> Select transparent geometry
        </label>
        <label title={kUnsupported}>
          <span className="sr-only">Transparency</span>
          <input type="range" min={0} max={100} defaultValue={70} disabled aria-label="Transparency" />
        </label>
      </fieldset>
      <fieldset>
        <legend>Component</legend>
        <label title={kUnsupported}>
          Expand: distance <input type="range" min={0} max={100} defaultValue={0} disabled aria-label="Expand distance" />
        </label>
      </fieldset>
    </div>
  );
}
