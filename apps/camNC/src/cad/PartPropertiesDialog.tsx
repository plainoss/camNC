import type { CadPart } from '@wbcnc/cad';
import { partCenterOfMass, partMass } from './materialLibrary';
import { FeatureDialog } from './FeatureDialog';
import './materialPanel.css';

/**
 * A part's properties: its name and material as the design has them, and the fields a parts list or bill of materials
 * would take, which camNC doesn't keep yet. Nothing here changes the part, so it only closes.
 */
export function PartPropertiesDialog({ part, name, onClose }: { part: CadPart; name: string; onClose: () => void }) {
  const unkept = (label: string) => (
    <label key={label} className="cad-number-field" title="Not available yet">
      {label}
      <span>
        <input disabled value="" readOnly />
      </span>
    </label>
  );
  return (
    <FeatureDialog title={name} className="cad-part-properties" okLabel="Close" onOk={onClose} onCancel={onClose}>
      <label className="cad-number-field">
        Name
        <span>
          <input readOnly value={name} />
        </span>
      </label>
      {unkept('Description')}
      <label className="cad-number-field">
        Category
        <span>
          <input readOnly value="Part" />
        </span>
      </label>
      {['Part number', 'Revision', 'State', 'Vendor', 'Project', 'Product line'].map(unkept)}
      <label className="cad-number-field">
        Material
        <span>
          <input readOnly value={part.material?.name ?? 'None'} />
        </span>
      </label>
      {['Title 1', 'Title 2', 'Title 3'].map(unkept)}
      <label title="Not available yet">
        <input type="checkbox" disabled />
        Not revision managed
      </label>
      <label title="Not available yet">
        <input type="checkbox" disabled />
        Exclude from all BOMs
      </label>
      <label className="cad-number-field">
        Unit of measure
        <span>
          <input readOnly value="Each" />
        </span>
      </label>
      <label title="Not available yet">
        <input type="checkbox" disabled />
        Override mass
      </label>
      <p className="cad-feature-hint">
        {(() => {
          const mass = partMass(part);
          return mass === null ? 'Mass: assign a material to compute it' : `Mass: ${mass.toFixed(3)} kg, computed from its material`;
        })()}
      </p>
      {(() => {
        const center = partCenterOfMass(part);
        return (
          center && (
            <p className="cad-feature-hint" aria-label="Center of mass">
              Center of mass: ({center.map(value => +value.toFixed(2)).join(', ')}) mm, in the part’s sketch
            </p>
          )
        );
      })()}
    </FeatureDialog>
  );
}
