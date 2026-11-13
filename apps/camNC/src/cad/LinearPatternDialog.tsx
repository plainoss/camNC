import { isCadPart, setPartPattern, type CadDocument, type CadPart, type CadValueScope } from '@wbcnc/cad';
import { useEffect, useMemo, useRef, useState } from 'react';
import { CadValueInput } from './CadValueInput';
import { useDesignUnits } from './designUnits';
import { FeatureDialog } from './FeatureDialog';
import type { CadConnectorPick } from './PartFeatureDialogs';
import { useDialogPreview } from './useDialogPreview';
import type { DialogPartPicks } from './useDialogPartPick';
import './partCutDialog.css';

type Vec3 = [number, number, number];
type PatternType = 'part' | 'feature';
type Box = 'entities' | 'direction';

/** What a Linear pattern repeats: a part, as copies of it, or an Extrude → Remove, as its cuts again along the board. */
const takes = (type: PatternType, part: CadPart | undefined) => !!part && (type === 'feature' ? !!part.remove : isCadPart(part));

/**
 * The Linear pattern dialog: a Part pattern repeats the part picked into Entities to pattern, a Feature pattern the
 * Extrude → Remove picked from the feature list, each Instance count times, Distance apart along the edge picked for
 * Direction. A part or feature picked opens its pattern there; the pattern shows in the view once it has a direction.
 */
export function LinearPatternDialog({
  document,
  part,
  variables,
  onChange,
  onOk,
  onCancel,
  onPreview,
  pickPoint,
  partPicks,
}: {
  document: CadDocument;
  /** The step it opened on: a pattern of its own is edited, otherwise nothing is picked yet. */
  part: CadPart;
  variables: CadValueScope;
  onChange: (change: (document: CadDocument) => CadDocument) => void;
  onOk: () => void;
  onCancel: () => void;
  onPreview?: (document: CadDocument | null) => void;
  pickPoint?: (picked: ((pick: CadConnectorPick) => void) | null) => void;
  partPicks?: DialogPartPicks;
}) {
  const { parseCadValue, lengthText } = useDesignUnits();
  const existing = part.pattern && !part.pattern.circular ? part.pattern : undefined;
  const [type, setType] = useState<PatternType>(part.remove ? 'feature' : 'part');
  const [target, setTarget] = useState<string | null>(existing ? part.id : null);
  const [vector, setVector] = useState<Vec3 | null>(existing?.vector ?? null);
  const [distanceText, setDistanceText] = useState(
    existing ? (existing.spacingExpression ?? lengthText(existing.spacing)) : lengthText(25)
  );
  const [countText, setCountText] = useState(existing ? (existing.countExpression ?? String(existing.count)) : '2');
  const [active, setActive] = useState<Box>('entities');
  const [error, setError] = useState<string | null>(null);
  const seen = useRef(partPicks?.pick?.seq);
  useEffect(() => {
    const pick = partPicks?.pick;
    if (!pick || pick.seq === seen.current || existing) return;
    seen.current = pick.seq;
    if (active !== 'entities') return;
    const picked = document.parts.find(candidate => candidate.id === pick.partId);
    if (!takes(type, picked)) return setError(type === 'feature' ? 'Pick an Extrude that removes, in the feature list.' : 'Pick a part.');
    if (picked!.pattern) return setError(`${picked!.name} has a pattern already. Open it from the feature list to change it.`);
    setTarget(picked!.id);
    setError(null);
  }, [partPicks?.pick, active, type, document.parts, existing]);
  const pickDirection = () => {
    setActive('direction');
    pickPoint?.(pick => {
      setActive('entities');
      if (!pick.edge) return setError('Click close to an edge of a part.');
      const along = pick.edge.b.map((value, axis) => value - pick.edge!.a[axis]!) as Vec3;
      // Along the edge's positive world direction, whichever end was found first; Flip direction turns it round.
      const main = along.reduce((best, value, axis) => (Math.abs(value) > Math.abs(along[best]!) ? axis : best), 0);
      const length = Math.hypot(...along) * Math.sign(along[main]!);
      setVector(along.map(value => +(value / length).toFixed(9) || 0) as Vec3);
      setError(null);
    });
  };
  useEffect(() => () => pickPoint?.(null), [pickPoint]);
  const settings = useMemo(():
    | { error: string }
    | { pattern: { axis: 'x'; count: number; spacing: number; spacingExpression?: string; countExpression?: string } } => {
    const distance = parseCadValue(distanceText, { unit: 'mm', variables });
    const count = parseCadValue(countText, { unit: 'scalar', variables });
    if ('error' in distance) return { error: distance.error };
    if ('error' in count) return { error: count.error };
    if (!Number.isInteger(count.value) || count.value < 2) return { error: 'Use a whole number of instances, at least 2.' };
    return {
      pattern: {
        axis: 'x' as const,
        count: count.value,
        spacing: distance.value,
        ...(distance.expression && { spacingExpression: distance.expression }),
        ...(count.expression && { countExpression: count.expression }),
      },
    };
  }, [distanceText, countText, variables, parseCadValue]);
  const draft = useMemo(
    () => (target && vector && 'pattern' in settings ? setPartPattern(document, target, { ...settings.pattern, vector }) : null),
    [document, target, vector, settings]
  );
  useDialogPreview(draft, onPreview);
  const accept = () => {
    const problem = !target
      ? type === 'feature'
        ? 'Pick the feature to pattern in the feature list.'
        : 'Pick the part to pattern.'
      : !vector
        ? 'Pick an edge for the direction.'
        : 'error' in settings
          ? settings.error
          : null;
    if (problem || !draft) return setError(problem ?? null);
    onChange(() => draft);
    onOk();
  };
  const picked = target ? document.parts.find(candidate => candidate.id === target) : undefined;
  const name = picked && (picked.remove ? (picked.extrudeName ?? `Extrude · ${picked.name}`) : picked.name);
  const label = type === 'feature' ? 'Features to pattern' : 'Entities to pattern';
  const unsupported = 'Not available yet';
  return (
    <FeatureDialog title="Linear pattern" onOk={accept} onCancel={onCancel} acceptFromPartsList className="cad-part-cut-dialog">
      <label className="cad-number-field">
        Pattern type
        <select
          value={type}
          disabled={!!existing}
          onChange={event => {
            setType(event.target.value as PatternType);
            setTarget(null);
            setActive('entities');
          }}>
          <option value="part">Part pattern</option>
          <option value="feature">Feature pattern</option>
        </select>
      </label>
      {type === 'part' && (
        <div className="cad-feature-tabs" role="tablist" aria-label="Pattern operation">
          {['New', 'Add', 'Remove', 'Intersect'].map(choice => (
            <button
              key={choice}
              type="button"
              role="tab"
              aria-selected={choice === 'New'}
              disabled={choice !== 'New'}
              title={choice === 'New' ? undefined : unsupported}>
              {choice}
            </button>
          ))}
        </div>
      )}
      <div
        className="cad-feature-selection cad-part-cut-box"
        role="group"
        aria-label={label}
        data-active={active === 'entities' || undefined}
        onClick={() => {
          pickPoint?.(null);
          setActive('entities');
        }}>
        <small>{label}</small>
        <span className={name ? undefined : 'cad-feature-hint'}>
          {name ?? (type === 'feature' ? 'Click a feature in the feature list' : 'Click a part in the view or the parts list')}
        </span>
      </div>
      <div
        className="cad-feature-selection cad-part-cut-box"
        role="group"
        aria-label="Direction"
        data-active={active === 'direction' || undefined}
        onClick={pickDirection}>
        <small>Direction</small>
        <span className={vector ? undefined : 'cad-feature-hint'}>
          {vector
            ? `Along an edge (${vector.map(value => +value.toFixed(3)).join(', ')})`
            : active === 'direction'
              ? 'Click an edge'
              : 'Pick an edge'}
        </span>
      </div>
      {vector && (
        <button type="button" onClick={() => setVector(vector.map(value => -value || 0) as Vec3)}>
          Flip direction
        </button>
      )}
      <label className="cad-part-cut-clearance">
        Distance
        <CadValueInput
          bare
          value={distanceText}
          aria-label="Distance"
          spellCheck={false}
          onChange={event => setDistanceText(event.target.value)}
        />
      </label>
      <label className="cad-part-cut-clearance">
        Instance count
        <CadValueInput
          bare
          unit="scalar"
          value={countText}
          aria-label="Instance count"
          spellCheck={false}
          onChange={event => setCountText(event.target.value)}
        />
      </label>
      {['Centered', 'Second direction', ...(type === 'feature' ? ['Reapply features'] : []), 'Skip instances'].map(option => (
        <label key={option} title={unsupported}>
          <input type="checkbox" disabled />
          {option}
        </label>
      ))}
      {error && (
        <p role="alert" className="cad-thickness-error">
          {error}
        </p>
      )}
    </FeatureDialog>
  );
}
