import { t as translate } from '@wbcnc/i18n';
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
    <label key={label} className="cad-number-field" title={translate('Not available yet')}>
      {label}
      <span>
        <input disabled value="" readOnly />
      </span>
    </label>
  );
  return (
    <FeatureDialog title={name} className="cad-part-properties" okLabel={translate('Close')} onOk={onClose} onCancel={onClose}>
      <label className="cad-number-field">
        {translate('Name ')}
        <span>
          <input readOnly value={name} />
        </span>
      </label>
      {unkept(translate('Description'))}
      <label className="cad-number-field">
        {translate('Category ')}
        <span>
          <input readOnly value={translate('Part')} />
        </span>
      </label>
      {[
        translate('Part number'),
        translate('Revision'),
        translate('State'),
        translate('Vendor'),
        translate('Project'),
        translate('Product line'),
      ].map(unkept)}
      <label className="cad-number-field">
        {translate('Material ')}
        <span>
          <input readOnly value={part.material?.name ?? translate('None')} />
        </span>
      </label>
      {[translate('Title 1'), translate('Title 2'), translate('Title 3')].map(unkept)}
      <label title={translate('Not available yet')}>
        <input type="checkbox" disabled />
        {translate('Not revision managed ')}
      </label>
      <label title={translate('Not available yet')}>
        <input type="checkbox" disabled />
        {translate('Exclude from all BOMs ')}
      </label>
      <label className="cad-number-field">
        {translate('Unit of measure ')}
        <span>
          <input readOnly value="Each" />
        </span>
      </label>
      <label title={translate('Not available yet')}>
        <input type="checkbox" disabled />
        {translate('Override mass ')}
      </label>
      <p className="cad-feature-hint">
        {(() => {
          const mass = partMass(part);
          return mass === null
            ? translate('Mass: assign a material to compute it')
            : translate('Mass: {{value1}} kg, computed from its material', { value1: mass.toFixed(3) });
        })()}
      </p>
      {(() => {
        const center = partCenterOfMass(part);
        return (
          center && (
            <p className="cad-feature-hint" aria-label={translate('Center of mass')}>
              {translate('Center of mass: (')}
              {center.map(value => +value.toFixed(2)).join(', ')}
              {translate(') mm, in the part’s sketch ')}
            </p>
          )
        );
      })()}
    </FeatureDialog>
  );
}
