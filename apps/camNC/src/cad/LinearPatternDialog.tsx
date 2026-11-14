import {
  cadCuts,
  isCadPart,
  isSpatialRemoval,
  regionInteriorPoint,
  resolveDrawnPlacements,
  rotateVector,
  sketchRegions,
  CAD_CHORD_TOLERANCE,
  resolveExtrudeSteps,
  setPartPattern,
  type CadDocument,
  type CadPart,
  type CadPartPattern,
  type CadValueScope,
} from '@wbcnc/cad';
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
type Box = 'entities' | 'direction' | 'second' | 'skip';
type Grid = NonNullable<CadPartPattern['second']>;

/**
 * What a Linear pattern repeats: a part, as copies of it, or an Extrude → Remove drawn on a board's face, as its cuts
 * again along the board.
 */
const takes = (type: PatternType, part: CadPart | undefined) =>
  !!part &&
  (type === 'feature'
    ? !!part.remove && !isSpatialRemoval(part) && !!part.drawnOn && 'partId' in part.drawnOn.on && !part.drawnOn.on.copyId
    : isCadPart(part));

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
  const suppressed = !!existing?.suppressed;
  const [type, setType] = useState<PatternType>(part.remove ? 'feature' : 'part');
  const [target, setTarget] = useState<string | null>(existing ? part.id : null);
  const [vector, setVector] = useState<Vec3 | null>(existing?.vector ?? null);
  const [distanceText, setDistanceText] = useState(
    existing ? (existing.spacingExpression ?? lengthText(existing.spacing)) : lengthText(25)
  );
  const [countText, setCountText] = useState(existing ? (existing.countExpression ?? String(existing.count)) : '2');
  const [centered, setCentered] = useState(!!existing?.centered);
  const [secondOn, setSecondOn] = useState(!!existing?.second);
  const [secondVector, setSecondVector] = useState<Vec3 | null>(existing?.second?.vector ?? null);
  const [secondDistanceText, setSecondDistanceText] = useState(
    existing?.second ? (existing.second.spacingExpression ?? lengthText(existing.second.spacing)) : lengthText(25)
  );
  const [secondCountText, setSecondCountText] = useState(
    existing?.second ? (existing.second.countExpression ?? String(existing.second.count)) : '1'
  );
  const [secondCentered, setSecondCentered] = useState(!!existing?.second?.centered);
  const [skipOn, setSkipOn] = useState(!!existing?.skipped?.length);
  const [skipped, setSkipped] = useState<[number, number][]>(existing?.skipped ?? []);
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
  /** The next edge picked in the view sets a direction, along its positive world direction; Flip turns it round. */
  const pickDirection = (box: 'direction' | 'second' = 'direction') => {
    setActive(box);
    pickPoint?.(pick => {
      setActive('entities');
      if (!pick.edge) return setError('Click close to an edge of a part.');
      const along = pick.edge.b.map((value, axis) => value - pick.edge!.a[axis]!) as Vec3;
      const main = along.reduce((best, value, axis) => (Math.abs(value) > Math.abs(along[best]!) ? axis : best), 0);
      const length = Math.hypot(...along) * Math.sign(along[main]!);
      (box === 'second' ? setSecondVector : setVector)(along.map(value => +(value / length).toFixed(9) || 0) as Vec3);
      setError(null);
    });
  };
  useEffect(() => () => pickPoint?.(null), [pickPoint]);
  /** The grid position, [along the first direction, along the second], of the instance nearest a point on the board. */
  const instanceAt = (point: Vec3): [number, number] | null => {
    const step = target ? document.parts.find(candidate => candidate.id === target) : undefined;
    const on = step?.drawnOn?.on;
    if (!step || !on || !('partId' in on) || !vector || !('pattern' in settings)) return null;
    const rotation = resolveDrawnPlacements(document).document.parts.find(candidate => candidate.id === on.partId)?.placement?.rotation;
    const local = (v: Vec3) => (rotation ? rotateVector([-rotation[0]!, -rotation[1]!, -rotation[2]!, rotation[3]!], v) : v);
    const region = sketchRegions(step.sketch, CAD_CHORD_TOLERANCE)[0];
    const seed = region && regionInteriorPoint(region.points);
    if (!seed) return null;
    const flip = on.face === 'underside' ? -1 : 1;
    const { count, spacing, centered: first, second } = settings.pattern;
    const [d1, d2] = [local(vector), second ? local(second.vector) : ([0, 0, 0] as Vec3)];
    const rows = second?.count ?? 1;
    let best: { at: [number, number]; distance: number } | null = null;
    for (let j = 0; j < rows; j++)
      for (let i = 0; i < count; i++) {
        const a = (i - (first ? (count - 1) / 2 : 0)) * spacing,
          b = second ? (j - (second.centered ? (rows - 1) / 2 : 0)) * second.spacing : 0;
        if (a === 0 && b === 0) continue;
        const x = flip * seed.x + d1[0] * a + d2[0] * b,
          y = seed.y + d1[1] * a + d2[1] * b;
        const distance = Math.hypot(x - point[0], y - point[1]);
        if (!best || distance < best.distance) best = { at: [i, j], distance };
      }
    const reach = Math.min(Math.abs(spacing) || Infinity, second ? Math.abs(second.spacing) || Infinity : Infinity) / 2;
    return best && best.distance <= reach ? best.at : null;
  };
  const latestInstanceAt = useRef(instanceAt);
  latestInstanceAt.current = instanceAt;
  /** Each instance clicked in the view is skipped, or brought back, until another box is used. */
  const pickSkips = () => {
    setActive('skip');
    pickPoint?.(pick => {
      const at = latestInstanceAt.current(pick.surfacePoint ?? pick.point);
      if (at)
        setSkipped(list =>
          list.some(([i, j]) => i === at[0] && j === at[1]) ? list.filter(([i, j]) => i !== at[0] || j !== at[1]) : [...list, at]
        );
      else setError('Click one of the pattern’s instances to skip it.');
      pickSkips();
    });
  };
  const settings = useMemo((): { error: string } | { pattern: Omit<CadPartPattern, 'id' | 'vector'> } => {
    const distance = parseCadValue(distanceText, { unit: 'mm', variables });
    const count = parseCadValue(countText, { unit: 'scalar', variables });
    if ('error' in distance) return { error: distance.error };
    if ('error' in count) return { error: count.error };
    if (!Number.isInteger(count.value) || count.value < 1) return { error: 'Use a whole number of instances, at least 1.' };
    let second: Grid | undefined;
    if (secondOn && secondVector) {
      const along = parseCadValue(secondDistanceText, { unit: 'mm', variables });
      const rows = parseCadValue(secondCountText, { unit: 'scalar', variables });
      if ('error' in along) return { error: along.error };
      if ('error' in rows) return { error: rows.error };
      if (!Number.isInteger(rows.value) || rows.value < 1) return { error: 'Use a whole number of instances, at least 1.' };
      second = {
        vector: secondVector,
        count: rows.value,
        spacing: along.value,
        ...(along.expression && { spacingExpression: along.expression }),
        ...(rows.expression && { countExpression: rows.expression }),
        ...(secondCentered && { centered: true as const }),
      };
    }
    if (count.value * (second?.count ?? 1) < 2) return { error: 'Use at least two instances.' };
    return {
      pattern: {
        axis: 'x' as const,
        count: count.value,
        spacing: distance.value,
        ...(distance.expression && { spacingExpression: distance.expression }),
        ...(count.expression && { countExpression: count.expression }),
        ...(centered && { centered: true as const }),
        ...(second && { second }),
        ...(skipOn && skipped.length && { skipped }),
      },
    };
  }, [
    distanceText,
    countText,
    variables,
    parseCadValue,
    centered,
    secondOn,
    secondVector,
    secondDistanceText,
    secondCountText,
    secondCentered,
    skipOn,
    skipped,
  ]);
  const draft = useMemo(
    () =>
      target && vector && 'pattern' in settings
        ? setPartPattern(document, target, { ...settings.pattern, vector, ...(suppressed && { suppressed: true as const }) })
        : null,
    [document, target, vector, settings, suppressed]
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
    // Each instance of a feature pattern cuts the board as the feature does; one off the board, or out of its face, doesn't.
    if (type === 'feature' && 'pattern' in settings && !suppressed) {
      const resolved = resolveExtrudeSteps(draft).parts.flatMap(part => cadCuts(part).filter(cut => cut.removedBy === target));
      const own = resolved.filter(cut => !cut.id.includes('~')).length;
      const instances = settings.pattern.count * (settings.pattern.second?.count ?? 1) - (settings.pattern.skipped?.length ?? 0);
      if (resolved.length < own * instances)
        return setError('Some instances would fall off the board or out of its face. Change the distance, count or direction.');
    }
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
        onClick={() => pickDirection()}>
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
      <label>
        <input type="checkbox" checked={centered} disabled={type !== 'feature'} onChange={event => setCentered(event.target.checked)} />
        Centered
      </label>
      <label title={type === 'feature' ? undefined : unsupported}>
        <input
          type="checkbox"
          checked={secondOn}
          disabled={type !== 'feature'}
          onChange={event => {
            setSecondOn(event.target.checked);
            if (event.target.checked) pickDirection('second');
            else pickPoint?.(null);
          }}
        />
        Second direction
      </label>
      {secondOn && (
        <div className="cad-part-pattern-second" role="group" aria-label="Second direction">
          <div
            className="cad-feature-selection cad-part-cut-box"
            role="group"
            aria-label="Second direction edge"
            data-active={active === 'second' || undefined}
            onClick={() => pickDirection('second')}>
            <small>Direction</small>
            <span className={secondVector ? undefined : 'cad-feature-hint'}>
              {secondVector
                ? `Along an edge (${secondVector.map(value => +value.toFixed(3)).join(', ')})`
                : active === 'second'
                  ? 'Click an edge'
                  : 'Pick an edge'}
            </span>
          </div>
          <label className="cad-part-cut-clearance">
            Distance
            <CadValueInput
              bare
              value={secondDistanceText}
              aria-label="Second distance"
              spellCheck={false}
              onChange={event => setSecondDistanceText(event.target.value)}
            />
          </label>
          <label className="cad-part-cut-clearance">
            Instance count
            <CadValueInput
              bare
              unit="scalar"
              value={secondCountText}
              aria-label="Second instance count"
              spellCheck={false}
              onChange={event => setSecondCountText(event.target.value)}
            />
          </label>
          <label>
            <input
              type="checkbox"
              aria-label="Centered second direction"
              checked={secondCentered}
              onChange={event => setSecondCentered(event.target.checked)}
            />
            Centered
          </label>
        </div>
      )}
      {type === 'feature' && (
        <label title={unsupported}>
          <input type="checkbox" disabled />
          Reapply features
        </label>
      )}
      <label title={type === 'feature' ? undefined : unsupported}>
        <input
          type="checkbox"
          checked={skipOn}
          disabled={type !== 'feature'}
          onChange={event => {
            setSkipOn(event.target.checked);
            if (event.target.checked) pickSkips();
            else pickPoint?.(null);
          }}
        />
        Skip instances
      </label>
      {skipOn && (
        <div
          className="cad-feature-selection cad-part-cut-box"
          role="group"
          aria-label="Instances to skip"
          data-active={active === 'skip' || undefined}
          onClick={pickSkips}>
          <small>Instances to skip</small>
          {skipped.length ? (
            <ul>
              {skipped.map(([i, j]) => (
                <li key={`${i},${j}`}>
                  ({i}, {j})
                  <button
                    type="button"
                    aria-label={`Bring back instance (${i}, ${j})`}
                    onClick={event => {
                      event.stopPropagation();
                      setSkipped(list => list.filter(([a, b]) => a !== i || b !== j));
                    }}>
                    ×
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <span className="cad-feature-hint">Click the instances to skip in the view</span>
          )}
        </div>
      )}
      {error && (
        <p role="alert" className="cad-thickness-error">
          {error}
        </p>
      )}
    </FeatureDialog>
  );
}
