import { useId } from 'react';
import { CadUnitSuffix } from './CadValueInput';
import { FeatureDialog } from './FeatureDialog';
import './SectionViewPanel.css';

export interface SectionViewPlaneOption {
  id: string;
  label: string;
}

export interface SectionViewPanelProps {
  /** Base planes, datum planes and the actual selected face, when one has been picked. */
  planes: readonly SectionViewPlaneOption[];
  planeId: string | null;
  picking?: boolean;
  onSelectPlane: (id: string) => void;
  onPickFace: () => void;
  offset: string;
  onOffsetChange: (value: string) => void;
  offsetProblem?: string | null;
  flipped: boolean;
  onFlip: () => void;
  onViewNormal: () => void;
  /** Geometry or selection errors that prevent keeping this section view. */
  confirmReason?: string | null;
  onConfirm: () => void;
  onCancel: () => void;
  onTurnOff?: () => void;
}

/** A view-only inspector: its owner supplies preview state without editing the design. */
export function SectionViewPanel({
  planes,
  planeId,
  picking = false,
  onSelectPlane,
  onPickFace,
  offset,
  onOffsetChange,
  offsetProblem,
  flipped,
  onFlip,
  onViewNormal,
  confirmReason,
  onConfirm,
  onCancel,
  onTurnOff,
}: SectionViewPanelProps) {
  const id = useId();
  const selected = planes.some(plane => plane.id === planeId);
  const reason = confirmReason || offsetProblem || (!selected ? 'Pick a plane or a planar face for the section.' : null);
  return (
    <FeatureDialog
      title="Section view"
      className="cad-section-view-dialog"
      okLabel="Confirm section view"
      okDisabled={!!reason}
      okReason={reason}
      onOk={onConfirm}
      onCancel={onCancel}>
      <div className="cad-feature-selection cad-section-plane" data-active={picking || !selected ? '' : undefined}>
        <label htmlFor={`${id}-plane`}>Section plane</label>
        <select id={`${id}-plane`} value={selected ? planeId! : ''} onChange={event => onSelectPlane(event.target.value)}>
          <option value="" disabled>
            Pick a plane or planar face
          </option>
          {planes.map(plane => (
            <option key={plane.id} value={plane.id}>
              {plane.label}
            </option>
          ))}
        </select>
        <button type="button" aria-pressed={picking} onClick={onPickFace}>
          Pick planar face
        </button>
      </div>
      {picking && (
        <p role="status" className="cad-feature-hint">
          Click a planar face in the view.
        </p>
      )}
      <div className="cad-section-offset">
        <label htmlFor={`${id}-offset`}>Offset</label>
        <span className="cad-section-value">
          {/* Defining a variable is a design edit, so a view-only offset deliberately uses a native field. */}
          <input
            id={`${id}-offset`}
            type="text"
            inputMode="decimal"
            autoComplete="off"
            spellCheck={false}
            value={offset}
            aria-invalid={offsetProblem ? true : undefined}
            aria-describedby={offsetProblem ? `${id}-offset-problem` : undefined}
            onChange={event => onOffsetChange(event.target.value)}
            onKeyDown={event => {
              // Composition and a held Enter must not count as the dialog's second confirmation key.
              if (event.key === 'Enter' && (event.repeat || event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229)) {
                event.preventDefault();
                event.stopPropagation();
              }
            }}
          />
          <CadUnitSuffix text={offset} />
        </span>
      </div>
      {offsetProblem && (
        <p id={`${id}-offset-problem`} role="alert" className="cad-section-problem">
          {offsetProblem}
        </p>
      )}
      {confirmReason && confirmReason !== offsetProblem && (
        <p role="alert" className="cad-section-problem">
          {confirmReason}
        </p>
      )}
      <div className="cad-section-actions">
        <button type="button" aria-pressed={flipped} onClick={onFlip}>
          Flip plane
        </button>
        <button type="button" disabled={!selected} onClick={onViewNormal}>
          View normal
        </button>
      </div>
      <p className="cad-feature-hint">The section stays on after you confirm.</p>
      {onTurnOff && (
        <button type="button" className="cad-section-off" onClick={onTurnOff}>
          Turn off section view
        </button>
      )}
    </FeatureDialog>
  );
}
