import { t as translate } from '@wbcnc/i18n';
import { useDesignUnits } from './designUnits';
import { extrudeStepProblem, holeSketch, type CadDocument, type CadPart, type CadValueScope } from '@wbcnc/cad';
import { useState } from 'react';
import { FeatureDialog } from './FeatureDialog';
import { HoleFields } from './HoleFields';
import { holeKindRefusal, holeSettingsOf, holeSpecOf, holeTitle, rememberHole, type HoleSettings } from './holeSettings';
import { holePointName } from './holePoints';

/**
 * A Hole step: a round hole at each picked point of a sketch drawn on a part's face, as wide as the diameter, through
 * the part or to a depth. Changes show in the view as they're made.
 */
export function HoleDialog({
  document,
  part,
  variables,
  onChange,
  onOk,
  onCancel,
}: {
  document: CadDocument;
  part: CadPart;
  variables?: CadValueScope;
  onChange: (change: (document: CadDocument) => CadDocument) => void;
  onOk: () => void;
  onCancel: () => void;
}) {
  const { parseCadValue, lengthText, lengthUnit } = useDesignUnits();
  const [settings, setSettings] = useState<HoleSettings>(() => holeSettingsOf(part, lengthText));
  const [error, setError] = useState<string | null>(null);
  const parse = (text: string) => parseCadValue(text, { unit: 'mm', variables });
  // Only a Hole step is written to: opened on anything else, such as a board, the dialog must never turn it into a hole.
  /** Applies the settings; while a value is being typed, one that can't be used yet waits for the typing to end. */
  const apply = (next: HoleSettings, typing = false) => {
    const spec = holeSpecOf(next, parse);
    if (!typing || !('error' in spec)) setError('error' in spec ? spec.error : null);
    if ('error' in spec) return;
    onChange(current => ({
      ...current,
      parts: current.parts.map(p =>
        p.id === part.id && p.hole
          ? { ...p, hole: { ...spec.hole!, ...(p.hole.points && { points: p.hole.points }) }, remove: { ...p.remove, ...spec.remove! } }
          : p
      ),
    }));
  };
  const spec = holeSpecOf(settings, parse);
  const diameter = 'error' in spec ? null : spec.hole!.diameter;
  const depth = 'error' in spec || spec.remove!.depth === 'through' ? null : (spec.remove!.depth as number);
  const refusal = holeKindRefusal(settings);
  const problem = part.hole
    ? extrudeStepProblem(document, part)
    : translate('Hole drills at the points of a sketch, not into {{value1}} itself.', { value1: part.name });
  const on = part.drawnOn?.on;
  const board = on && 'partId' in on ? document.parts.find(candidate => candidate.id === on.partId) : undefined;
  const points = part.hole ? holeSketch(part).entities.filter(entity => entity.type === 'point') : [];
  return (
    <FeatureDialog
      title={holeTitle(settings, diameter, depth)}
      okDisabled={!!error || !!problem || !!refusal}
      okReason={refusal}
      onOk={() => {
        rememberHole(settings);
        onOk();
      }}
      onCancel={onCancel}>
      <HoleFields
        settings={settings}
        onChange={next => {
          setSettings(next);
          apply(next, true);
        }}
        onCommit={apply}
        lengthUnit={lengthUnit}
        picks={
          <>
            <div className="cad-feature-selection">
              <small>{translate('Sketch points to place holes')}</small>
              {points.map(point => (
                <span key={point.id}>{holePointName(document, part.id)}</span>
              ))}
            </div>
            <div className="cad-feature-selection">
              <small>{translate('Merge scope')}</small>
              {board && <span>{board.name}</span>}
            </div>
          </>
        }
      />
      {(error || problem) && (
        <p role="alert" className="cad-thickness-error">
          {error ?? problem}
        </p>
      )}
    </FeatureDialog>
  );
}
