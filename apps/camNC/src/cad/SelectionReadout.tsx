import { t as translate } from '@wbcnc/i18n';
import { lengthUnitScale, useDesignUnits } from './designUnits';
import { cadFaceFrame, type CadDocument, type CadPart, type CadPoint, type CadSketch } from '@wbcnc/cad';
import { selectionMeasurements, type SelectionMeasurement } from '@wbcnc/cad-editor/selectionMeasurements';
import { formatCadValue } from './valueExpressions';
import './selectionReadout.css';

export interface SelectionReadoutProps {
  sketch: CadSketch;
  selectedIds: readonly string[];
  picks?: Readonly<Record<string, CadPoint>>;
  className?: string;
  /** With the part being drawn, one point picked reads where it is in the studio. */
  document?: CadDocument;
  part?: CadPart;
}

/** Where one picked sketch point is in the studio: its X, Y and Z, on the plane or face the sketch is drawn on. */
type Row = SelectionMeasurement & { precise?: boolean };

function pointPosition(sketch: CadSketch, selectedIds: readonly string[], document?: CadDocument, part?: CadPart): Row[] {
  const point = selectedIds.length === 1 ? sketch.entities.find(entity => entity.id === selectedIds[0]) : undefined;
  if (!document || !part || point?.type !== 'point') return [];
  const frame = cadFaceFrame(document, part.drawnOn?.on ?? { plane: 'top' });
  if ('error' in frame) return [];
  const offset = part.drawnOn?.offset ?? 0;
  return (['X', 'Y', 'Z'] as const).map((label, axis) => ({
    label,
    value: frame.origin[axis]! + frame.normal[axis]! * offset + frame.x[axis]! * point.x + frame.y[axis]! * point.y,
    unit: 'mm' as const,
    // A position reads to the thousandth, so a whole number still shows it's exact.
    precise: true,
  }));
}

export function SelectionReadout({ sketch, selectedIds, picks, className, document, part }: SelectionReadoutProps) {
  const { formatLength, lengthUnit } = useDesignUnits();
  const measured: Row[] = selectionMeasurements(sketch, selectedIds, picks);
  const measurements = measured.length ? measured : pointPosition(sketch, selectedIds, document, part);
  const text = (row: Row) =>
    row.unit === 'deg'
      ? formatCadValue(row.value)
      : row.precise
        ? (row.value / lengthUnitScale(lengthUnit)).toFixed(3)
        : formatLength(row.value);
  if (!measurements.length) return null;
  return (
    <div
      role="status"
      aria-label={translate('Selection measurements')}
      aria-atomic="true"
      className={['cad-selection-readout', className].filter(Boolean).join(' ')}>
      <dl>
        {measurements.map(measurement => (
          <div key={measurement.label}>
            <dt>{measurement.label}</dt>
            <dd>
              {text(measurement)}
              {measurement.unit === 'deg' ? '°' : translate(' {{lengthUnit}}', { lengthUnit: lengthUnit })}
            </dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
