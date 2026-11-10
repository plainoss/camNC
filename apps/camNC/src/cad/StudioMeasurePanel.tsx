import { useEffect, useId, useRef, useState } from 'react';
import type { CadLengthUnit } from '@wbcnc/cad';
import type { MeasureEntity, MeasureResult, MeasureRow } from './measureGeometry';
import { formatCadValue } from './valueExpressions';
import './studioMeasurePanel.css';

export interface StudioMeasureSelection {
  key: string;
  label: string;
  entity: MeasureEntity;
}

export interface StudioMeasurePanelProps {
  selection: readonly StudioMeasureSelection[];
  result: MeasureResult;
  expanded: boolean;
  /** The design preference initializes readouts; explicit conversions stay local to this inspector session. */
  defaultLengthUnit?: CadLengthUnit;
  selectedRowId?: string | null;
  onExpand: () => void;
  /** Collapse the inspector while keeping the selected geometry and quick readout. */
  onClose: () => void;
  onClear: () => void;
  onRemove: (key: string) => void;
  onSelectRow: (id: string) => void;
  /** Defaults to the browser clipboard; a host may supply its own clipboard integration. */
  copyText?: (text: string) => Promise<void>;
}

type LengthUnit = CadLengthUnit | 'yd';
type AngleUnit = 'deg' | 'rad';
type MeasureType = 'all' | 'distance' | 'length' | 'position' | 'angle' | 'area';
const lengthScales: Record<LengthUnit, number> = { mm: 1, cm: 10, m: 1000, in: 25.4, ft: 304.8, yd: 914.4 };
const measureTypes: { value: MeasureType; label: string }[] = [
  { value: 'all', label: 'Show all' },
  { value: 'distance', label: 'Distance' },
  { value: 'length', label: 'Length' },
  { value: 'position', label: 'Position' },
  { value: 'angle', label: 'Angle' },
  { value: 'area', label: 'Surface area' },
];

const rowType = (row: MeasureRow): MeasureType => (row.id.includes('distance') ? 'distance' : row.kind);
const clipboard = (text: string) => navigator.clipboard.writeText(text);
const cleanZero = (value: number) => (Object.is(value, -0) ? 0 : value);

/** A passive quick readout, or the explicit, non-modal inspector over the assembled model. */
export function StudioMeasurePanel({
  selection,
  result,
  expanded,
  defaultLengthUnit = 'mm',
  selectedRowId,
  onExpand,
  onClose,
  onClear,
  onRemove,
  onSelectRow,
  copyText = clipboard,
}: StudioMeasurePanelProps) {
  const id = useId();
  const dialog = useRef<HTMLDialogElement>(null);
  const [lengthUnit, setLengthUnit] = useState<LengthUnit>(defaultLengthUnit);
  const [angleUnit, setAngleUnit] = useState<AngleUnit>('deg');
  const [filter, setFilter] = useState<MeasureType>('all');
  const [copyStatus, setCopyStatus] = useState('');
  const lastCopy = useRef<{ signature: string; full: boolean } | null>(null);
  const feedbackTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const copyRequest = useRef(0);
  const rows = result.rows.filter(row => Number.isFinite(row.value));
  const resultKey = rows.map(row => `${row.id}:${row.value}`).join('|');
  const available = new Set(rows.map(rowType));
  const effectiveFilter = filter === 'all' || available.has(filter) ? filter : 'all';
  const filteredRows = rows.filter(row => effectiveFilter === 'all' || rowType(row) === effectiveFilter);
  const visibleRows = expanded ? filteredRows : rows.slice(0, 3);

  useEffect(() => {
    if (!expanded) return;
    const element = dialog.current;
    // This inspector stays inside the viewport while the user selects more geometry; it must not make the model inert.
    element?.show();
    return () => element?.close();
  }, [expanded]);
  useEffect(
    () => () => {
      copyRequest.current++;
      clearTimeout(feedbackTimer.current);
    },
    []
  );
  useEffect(() => {
    // Clipboard writes finish asynchronously. A completed write for old geometry must not describe the new selection.
    copyRequest.current++;
    lastCopy.current = null;
    clearTimeout(feedbackTimer.current);
    setCopyStatus('');
  }, [resultKey, lengthUnit, angleUnit]);

  if (!expanded && !selection.length && !result.problem) return null;

  const valueOf = (row: MeasureRow) =>
    cleanZero(
      row.kind === 'angle'
        ? angleUnit === 'rad'
          ? (row.value * Math.PI) / 180
          : row.value
        : row.value / lengthScales[lengthUnit] ** (row.kind === 'area' ? 2 : 1)
    );
  const unitOf = (row: MeasureRow) =>
    row.kind === 'angle' ? (angleUnit === 'deg' ? '°' : ' rad') : ` ${lengthUnit}${row.kind === 'area' ? '²' : ''}`;
  const copyValue = async (row: MeasureRow) => {
    onSelectRow(row.id);
    const value = valueOf(row),
      signature = `${row.id}:${value}:${unitOf(row)}`;
    const full = lastCopy.current?.signature === signature ? !lastCopy.current.full : true;
    lastCopy.current = { signature, full };
    const request = ++copyRequest.current;
    const text = `${full ? String(value) : formatCadValue(value)}${unitOf(row)}`;
    clearTimeout(feedbackTimer.current);
    try {
      await copyText(text);
      if (request !== copyRequest.current) return;
      setCopyStatus(`${row.label} copied at ${full ? 'full' : 'displayed'} precision.`);
    } catch {
      if (request !== copyRequest.current) return;
      // A denied clipboard write must stay visible so the user can select the value or retry.
      lastCopy.current = null;
      setCopyStatus('Copy failed. Clipboard access is unavailable.');
    }
    feedbackTimer.current = setTimeout(() => setCopyStatus(''), 4000);
  };
  const resultRows = (
    <dl
      className="cad-studio-measure-results"
      aria-label="Measured values"
      aria-live={expanded ? undefined : 'polite'}
      aria-atomic={expanded ? undefined : true}>
      {visibleRows.map(row => (
        <div key={row.id} data-axis={row.axis}>
          <dt>{row.label}</dt>
          <dd>
            <button
              type="button"
              aria-label={`${row.label}: ${formatCadValue(valueOf(row))}${unitOf(row)}`}
              aria-pressed={selectedRowId === row.id}
              title="Show the measurement and copy its full precision value. Click again to copy displayed precision."
              onClick={() => void copyValue(row)}>
              {formatCadValue(valueOf(row))}
              {unitOf(row)}
            </button>
          </dd>
        </div>
      ))}
    </dl>
  );
  const feedback = (
    <p role="status" className="cad-studio-measure-copy-status">
      {copyStatus}
    </p>
  );

  if (!expanded)
    return (
      <section className="cad-studio-measure cad-studio-measure-quick" aria-label="Selection measurements">
        <div className="cad-studio-measure-head">
          <button type="button" title="Measure ([)" onClick={onExpand}>
            Measure <kbd>[</kbd>
          </button>
          <button
            type="button"
            className="cad-studio-measure-icon"
            aria-label="Clear measurements"
            title="Clear measurements"
            onClick={onClear}>
            ×
          </button>
        </div>
        {result.problem && <p className="cad-studio-measure-problem">{result.problem}</p>}
        {resultRows}
        {rows.length > visibleRows.length && (
          <span className="cad-studio-measure-more">{rows.length - visibleRows.length} more in Measure</span>
        )}
        {feedback}
      </section>
    );

  return (
    <dialog
      ref={dialog}
      className="cad-studio-measure cad-studio-measure-full"
      aria-labelledby={`${id}-title`}
      onKeyDown={event => {
        // Typing and inspector shortcuts do not start editing commands in the model behind the non-modal panel.
        event.stopPropagation();
        if (event.key === 'Escape') onClose();
      }}>
      <div className="cad-studio-measure-head">
        <h3 id={`${id}-title`}>Measure</h3>
        <button type="button" className="cad-studio-measure-icon" aria-label="Close Measure" title="Close Measure" onClick={onClose}>
          ×
        </button>
      </div>
      <div className="cad-studio-measure-body">
        <div className="cad-studio-measure-selection-head">
          <span>
            {selection.length} {selection.length === 1 ? 'entity' : 'entities'} selected
          </span>
          <button type="button" disabled={!selection.length} onClick={onClear}>
            Clear
          </button>
        </div>
        {selection.length ? (
          <ul aria-label="Measured entities" className="cad-studio-measure-selection">
            {selection.map(selected => (
              <li key={selected.key}>
                <span>{selected.label}</span>
                <button
                  type="button"
                  className="cad-studio-measure-icon"
                  aria-label={`Remove ${selected.label}`}
                  title={`Remove ${selected.label}`}
                  onClick={() => onRemove(selected.key)}>
                  ×
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="cad-studio-measure-hint">Select a vertex, straight edge or planar face. Shift-click to add another selection.</p>
        )}
        <div className="cad-studio-measure-options">
          <label htmlFor={`${id}-type`}>Measure type</label>
          <select id={`${id}-type`} value={effectiveFilter} onChange={event => setFilter(event.currentTarget.value as MeasureType)}>
            {measureTypes
              .filter(type => type.value === 'all' || available.has(type.value))
              .map(type => (
                <option key={type.value} value={type.value}>
                  {type.label}
                </option>
              ))}
          </select>
          <label htmlFor={`${id}-length`}>Length unit</label>
          <select id={`${id}-length`} value={lengthUnit} onChange={event => setLengthUnit(event.currentTarget.value as LengthUnit)}>
            {(Object.keys(lengthScales) as LengthUnit[]).map(unit => (
              <option key={unit} value={unit}>
                {unit}
              </option>
            ))}
          </select>
          <label htmlFor={`${id}-angle`}>Angle unit</label>
          <select id={`${id}-angle`} value={angleUnit} onChange={event => setAngleUnit(event.currentTarget.value as AngleUnit)}>
            <option value="deg">deg</option>
            <option value="rad">rad</option>
          </select>
        </div>
        {result.problem && (
          <p role="alert" className="cad-studio-measure-problem">
            {result.problem}
          </p>
        )}
        {result.parallel !== undefined && <p className="cad-studio-measure-hint">{result.parallel ? 'Parallel' : 'Not parallel'}</p>}
        {resultRows}
        <p className="cad-studio-measure-hint">Curved outlines use a faceted approximation.</p>
        {feedback}
      </div>
    </dialog>
  );
}
