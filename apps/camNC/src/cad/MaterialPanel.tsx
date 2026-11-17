import type { CadPartMaterial } from '@wbcnc/cad';
import { useState } from 'react';
import { FeatureDialog } from './FeatureDialog';
import { densityText, findMaterials } from './materialLibrary';
import './materialPanel.css';

/**
 * Assign material: a part's material picked from the library, searched by name or category. Its density and its other
 * properties show once one is picked; the check assigns it, which changes nothing in the design's steps.
 */
export function MaterialPanel({
  partName,
  material,
  onAssign,
  onClose,
}: {
  partName: string;
  material?: CadPartMaterial;
  /** The material chosen, or null for none. */
  onAssign: (material: CadPartMaterial | null) => void;
  onClose: () => void;
}) {
  const [chosen, setChosen] = useState<CadPartMaterial | null>(material ?? null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const found = findMaterials(query);
  const choose = (next: CadPartMaterial | null) => {
    setChosen(next);
    setOpen(false);
    setQuery('');
  };
  return (
    <FeatureDialog title={`Material · ${partName}`} className="cad-material-panel" onOk={() => onAssign(chosen)} onCancel={onClose}>
      <div className="cad-feature-tabs cad-static-tabs" role="tablist" aria-label="Material source">
        <span role="tab" aria-selected>
          Library
        </span>
        <span role="tab" aria-selected={false} aria-disabled title="Not available yet">
          Custom
        </span>
      </div>
      <p className="cad-material-library">Material library</p>
      <button type="button" className="cad-material-pick" aria-haspopup="listbox" aria-expanded={open} onClick={() => setOpen(!open)}>
        {chosen?.name ?? '- None -'}
      </button>
      {open && (
        <div className="cad-material-menu">
          <input
            type="text"
            aria-label="Search by material or category"
            placeholder="Search by material or category"
            autoFocus
            value={query}
            onKeyDown={event => event.stopPropagation()}
            onChange={event => setQuery(event.target.value)}
          />
          <ul role="listbox" aria-label="Materials">
            {!query.trim() && (
              <li role="option" aria-selected={!chosen} onClick={() => choose(null)}>
                - None - <small>(Density {densityText(0)} kg/m³)</small>
              </li>
            )}
            {found.map(entry => (
              <li
                key={entry.name}
                role="option"
                aria-selected={chosen?.name === entry.name}
                onClick={() => choose({ name: entry.name, density: entry.density })}>
                {entry.name} <small>(Density {densityText(entry.density)} kg/m³)</small>
              </li>
            ))}
          </ul>
        </div>
      )}
      {chosen ? (
        <dl className="cad-material-properties" aria-label="Material properties">
          <dt>Name</dt>
          <dd>{chosen.name}</dd>
          <dt>Density (kg/m³)</dt>
          <dd>{chosen.density}</dd>
          {["Poisson's ratio", "Young's modulus (Pa)", 'Tensile strength (Pa)', 'Yield strength (Pa)'].map(name => (
            <div key={name}>
              <dt>{name}</dt>
              <dd>0</dd>
            </div>
          ))}
        </dl>
      ) : (
        <p className="cad-feature-hint">No material assigned</p>
      )}
    </FeatureDialog>
  );
}
