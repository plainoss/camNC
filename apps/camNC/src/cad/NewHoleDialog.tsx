import { t as translate } from '@wbcnc/i18n';
import { useDesignUnits } from './designUnits';
import { standaloneSketchPoints, type CadDocument, type CadValueScope } from '@wbcnc/cad';
import { useEffect, useMemo, useState } from 'react';
import { asHole, replacePart } from './editorHelpers';
import { FeatureDialog } from './FeatureDialog';
import { HoleFields } from './HoleFields';
import { holeKindRefusal, holeSpecOf, holeTitle, initialHoleSettings, rememberHole, type HoleSettings } from './holeSettings';
import { holePointAt, holePointName } from './holePoints';
import { useDialogPreview } from './useDialogPreview';
import type { CadConnectorPick } from './PartFeatureDialogs';

type Point = { sketchId: string; pointId: string; boardId: string };

/** A selected sketch's points to drill at: those standing on their own, or its circles' centres when it has none. */
function sketchPoints(document: CadDocument, sketchId?: string): Point[] {
  const sketch = sketchId ? document.parts.find(part => part.id === sketchId) : undefined;
  const on = sketch?.drawnOn?.on;
  if (!sketch || !on || !('partId' in on)) return [];
  const standalone = standaloneSketchPoints(sketch.sketch);
  const centres = sketch.sketch.entities.flatMap(entity => (entity.type === 'circle' ? [entity.centerId] : []));
  const ids = standalone.length ? standalone.map(point => point.id) : centres;
  return ids.map(pointId => ({ sketchId: sketch.id, pointId, boardId: on.partId }));
}

/**
 * A new Hole: sketch points picked in the view, one click each, drilled as set. Nothing changes until the green check;
 * the red cross leaves the design as it was.
 */
export function NewHoleDialog({
  document,
  sketchId: preselected,
  variables,
  pickPoint,
  onSave,
  onPreview,
  onCancel,
}: {
  document: CadDocument;
  /** A sketch selected before Hole was chosen: its points are picked to start with. */
  sketchId?: string;
  variables?: CadValueScope;
  pickPoint?: (picked: ((pick: CadConnectorPick) => void) | null) => void;
  onSave: (document: CadDocument) => void;
  onPreview?: (document: CadDocument | null) => void;
  onCancel: () => void;
}) {
  const { parseCadValue, lengthUnit } = useDesignUnits();
  const [settings, setSettings] = useState<HoleSettings>(initialHoleSettings);
  const [points, setPoints] = useState<Point[]>(() => sketchPoints(document, preselected));
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    const listen = () =>
      pickPoint?.(pick => {
        const found = holePointAt(document, pick.surfacePoint ?? pick.point);
        if (!found) setError(translate('Click a point of a sketch on a part’s face, such as a circle’s centre.'));
        else {
          setError(null);
          setPoints(current =>
            current.some(p => p.pointId === found.pointId)
              ? current.filter(p => p.pointId !== found.pointId)
              : current.length && current[0]!.sketchId !== found.sketchId
                ? current
                : [...current, found]
          );
        }
        listen();
      });
    listen();
    return () => pickPoint?.(null);
    // The document a pick is read against is the one the dialog opened on.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const parse = (text: string) => parseCadValue(text, { unit: 'mm', variables });
  const spec = holeSpecOf(settings, parse);
  const candidate = useMemo(() => {
    const sketchId = points[0]?.sketchId;
    if (!sketchId || 'error' in spec) return null;
    return {
      ...replacePart(document, sketchId, part => ({
        ...asHole(part),
        hole: { ...spec.hole!, points: points.map(p => p.pointId) },
        remove: spec.remove!,
      })),
      revision: document.revision + 1,
    };
    // `spec` follows from the settings.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [document, points, settings, variables]);
  useDialogPreview(candidate, onPreview);
  const diameter = 'error' in spec ? null : spec.hole!.diameter;
  const depth = 'error' in spec || spec.remove!.depth === 'through' ? null : (spec.remove!.depth as number);
  const refusal = holeKindRefusal(settings);
  const board = points[0] && document.parts.find(part => part.id === points[0]!.boardId);
  const save = () => {
    if ('error' in spec) return setError(spec.error);
    if (refusal) return setError(refusal);
    if (!candidate) return setError(translate('Pick the sketch points to place holes.'));
    rememberHole(settings);
    onSave(candidate);
  };
  return (
    <FeatureDialog
      title={holeTitle(settings, diameter, depth)}
      okDisabled={!candidate || !!refusal}
      okReason={refusal ?? (candidate ? null : translate('Pick the sketch points to place holes.'))}
      onOk={save}
      onCancel={() => {
        rememberHole(settings);
        onCancel();
      }}>
      <HoleFields
        settings={settings}
        onChange={setSettings}
        lengthUnit={lengthUnit}
        picks={
          <>
            <div className="cad-feature-selection" data-active="">
              <small>{translate('Sketch points to place holes')}</small>
              {points.map(point => (
                <span key={point.pointId}>{holePointName(document, point.sketchId)}</span>
              ))}
            </div>
            <div className="cad-feature-selection">
              <small>{translate('Merge scope')}</small>
              {board && <span>{board.name}</span>}
            </div>
          </>
        }
      />
      {error && (
        <p role="alert" className="cad-thickness-error">
          {error}
        </p>
      )}
    </FeatureDialog>
  );
}
