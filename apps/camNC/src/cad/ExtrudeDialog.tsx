import { useDesignUnits } from './designUnits';
import { useState } from 'react';
import {
  type CadDrawnOn,
  cadFaceFrame,
  cadSketchFrame,
  cadDatumFrame,
  CAD_CHORD_TOLERANCE,
  evaluateCadPart,
  extrudeStepProblem,
  isCadPart,
  isCadBody,
  partIsBuiltOn,
  removalRegions,
  removeSupport,
  copyFaceOperationProblem,
  isSpatialRemoval,
  removalTargets,
  removalInward,
  addsRegionsTo,
  sharesSketch,
  sketchOwnerId,
  sketchRegions,
  sketchStepLabel,
  splitApartRegions,
  type CadDocument,
  type CadPart,
  type CadValueScope,
} from '@wbcnc/cad';
import { CadDrawnOnField } from './CadDrawnOnField';
import { CadReliefField } from './CadReliefField';
import { CadThicknessField } from './CadThicknessField';
import { FeatureDialog } from './FeatureDialog';
import { CadValueInput } from './CadValueInput';
import { drawnOnName } from './drawnOnName';

interface PartDialogProps {
  document: CadDocument;
  part: CadPart;
  variables?: CadValueScope;
  /** Applies a change to the design as it's made, so the view shows it. */
  onChange: (change: (document: CadDocument) => CadDocument) => void;
  onOk: () => void;
  /** Leaves the design as it was when the dialog opened. */
  onCancel: () => void;
}

const changePart = (document: CadDocument, partId: string, change: (part: CadPart) => CadPart): CadDocument => ({
  ...document,
  parts: document.parts.map(part => (part.id === partId ? change(part) : part)),
});

type ExtrudeOperation = 'new' | 'add' | 'remove';

/**
 * A sketch pushed out, as the reference's Extrude: New makes a part of it, how thick, where it starts from its plane or
 * face, and which way it grows. Add joins its regions to a part made from the same sketch, and Remove cuts them into
 * the board the sketch is drawn on, as a pocket or a hole.
 */
export function ExtrudeDialog({
  document,
  part,
  variables,
  onChange,
  onOk,
  onCancel,
  onEditSketch,
  pickFace,
  depthDragging = false,
  profilePicking = false,
  onPickProfile,
}: PartDialogProps & {
  onEditSketch: () => void;
  depthDragging?: boolean;
  profilePicking?: boolean;
  onPickProfile?: () => void;
  /** Starts picking a plane or a face, for Up to face; the pick comes back once. Null stops a pick under way. */
  pickFace?: (picked: ((on: CadDrawnOn['on'], datum?: string) => void) | null) => void;
}) {
  const { parseCadValue, lengthText, formatLength, lengthUnit } = useDesignUnits();
  const [pickingFace, setPickingFace] = useState(false);
  /** Blind to a thickness, or up to a plane or face: its thickness then follows that face. */
  const setUpTo = (upTo: CadDrawnOn['on'] | null, datum?: string) =>
    onChange(document =>
      changePart(document, part.id, p => {
        const next = { ...p };
        if (upTo) {
          next.upTo = upTo;
          const from = cadSketchFrame(document, p);
          const to = (datum && cadDatumFrame(document, datum)) || cadFaceFrame(document, upTo);
          if (from && !('error' in to) && p.drawnOn) {
            // A picked end face chooses the way to reach it, including one behind the profile's outward normal.
            const reach = from.normal.reduce((sum, value, axis) => sum + value * (to.origin[axis]! - from.origin[axis]!), 0);
            next.drawnOn = { ...p.drawnOn, inward: reach < 0 };
          }
          if (datum) next.upToDatum = datum;
          else delete next.upToDatum;
          delete next.symmetric;
        } else {
          delete next.upTo;
          delete next.upToDatum;
        }
        return next;
      })
    );
  /** Stops waiting for a face, as when Blind or Thin is chosen instead. */
  const stopPickingFace = () => {
    if (!pickingFace) return;
    setPickingFace(false);
    pickFace?.(null);
  };
  const startPickingFace = () => {
    if (!pickFace) return;
    setPickingFace(true);
    pickFace((on, datum) => {
      setPickingFace(false);
      setUpTo(on, datum);
    });
  };
  const operation: ExtrudeOperation = part.remove ? 'remove' : part.addTo !== undefined ? 'add' : 'new';
  const owner = document.parts.find(candidate => candidate.id === sketchOwnerId(part)) ?? part;
  // The parts an Add can join: those made from the same sketch, of regions picked from it, which it adds regions to, and
  // any other part, which it's joined to as a body of its own. The part its sketch is drawn on comes first.
  const drawnOnPart = part.drawnOn && !('plane' in part.drawnOn.on) ? part.drawnOn.on.partId : null;
  const preceding = document.parts.slice(
    0,
    document.parts.findIndex(candidate => candidate.id === part.id)
  );
  const mergeable = preceding
    .filter(candidate => candidate.id !== part.id && isCadPart(candidate) && (!sharesSketch(candidate, part) || !!candidate.regions))
    .sort((a, b) => Number(b.id === drawnOnPart) - Number(a.id === drawnOnPart));
  const [operationError, setOperationError] = useState<string | null>(null);
  const [removeDepthText, setRemoveDepthText] = useState(() =>
    part.remove && part.remove.depth !== 'through'
      ? (part.remove.depthExpression ?? lengthText(part.remove.depth))
      : part.drawnOn && 'plane' in part.drawnOn.on
        ? (part.thicknessExpression ?? lengthText(part.thickness))
        : lengthText(6)
  );
  const [removeError, setRemoveError] = useState<string | null>(null);
  /** Regions kept that the extrude can still take, given which of them it picks from. */
  const keptRegions = (p: CadPart, available: string[]) => p.regions?.filter(id => available.includes(id));
  // Nothing picked yet stays so on another tab, rather than becoming the whole sketch.
  const nonePicked = (p: CadPart) => p.regions?.length === 0;
  const switchTo = (next: ExtrudeOperation) => {
    setOperationError(null);
    if (next === operation) return;
    if (next !== 'new') {
      const refused =
        copyFaceOperationProblem(part) ||
        (part.thin && 'A thin board can only be a new part.') ||
        (isCadBody(document, part) && partIsBuiltOn(document, part, next === 'add' ? mergeable[0] : undefined)) ||
        (next === 'add' && !mergeable.length && 'There’s no part yet to add to. Make one with New first.') ||
        (next === 'remove' &&
          (() => {
            if (part.drawnOn && ('plane' in part.drawnOn.on || typeof part.drawnOn.on.face === 'object'))
              return preceding.length ? null : 'There’s no part yet to cut. Make one with New first.';
            const support = removeSupport(document, part);
            return 'error' in support ? support.error : null;
          })());
      if (refused) return setOperationError(refused);
    }
    const parsed = parseCadValue(removeDepthText, { unit: 'mm', variables });
    onChange(current =>
      changePart(current, part.id, p => {
        const made: CadPart = { ...p };
        delete made.addTo;
        delete made.remove;
        delete made.regions;
        const own = sketchRegions(p.sketch, CAD_CHORD_TOLERANCE).map(region => region.id);
        if (next === 'remove') {
          made.remove =
            'error' in parsed || !(parsed.value > 0) ? { depth: 6 } : { depth: parsed.value, depthExpression: parsed.expression };
          if (!made.remove.depthExpression) delete made.remove.depthExpression;
          const found = removalRegions(current, made);
          const regions =
            'error' in found
              ? undefined
              : keptRegions(
                  p,
                  found.regions.map(region => region.id)
                );
          if (regions?.length || nonePicked(p)) made.regions = regions ?? [];
        } else if (next === 'add') {
          const into = mergeable[0]!;
          // A solid face names the profile, not the body to join: that scope must be picked explicitly.
          made.addTo = p.faceProfile ? '' : into.id;
          if (sharesSketch(into, p)) made.regions = (keptRegions(p, own) ?? []).filter(id => !into.regions!.includes(id));
          else {
            const regions = keptRegions(p, own);
            if (regions?.length || p.sketchOf || nonePicked(p)) made.regions = regions ?? [];
          }
        } else {
          const regions = keptRegions(p, own);
          if (regions?.length || p.sketchOf || nonePicked(p)) made.regions = regions ?? [];
        }
        return made;
      })
    );
  };
  /** Remove with the depth as typed, or all the way through. Whether it was taken. */
  const remove = (through: boolean, text = removeDepthText, preview = false) => {
    const parsed = through ? { value: 'through' as const } : parseCadValue(text, { unit: 'mm', variables });
    const refused = 'error' in parsed ? parsed.error : parsed.value !== 'through' && !(parsed.value > 0) ? 'A cut needs some depth.' : null;
    if (!preview || !refused) setRemoveError(refused);
    if ('error' in parsed || refused) return false;
    onChange(current =>
      changePart(current, part.id, p => ({
        ...p,
        remove:
          parsed.value === 'through' || !('expression' in parsed) || !parsed.expression
            ? { ...p.remove, depth: parsed.value, depthExpression: undefined }
            : { ...p.remove, depth: parsed.value, depthExpression: parsed.expression },
      }))
    );
    return true;
  };
  const stepProblem = extrudeStepProblem(document, part);
  // The regions of the parts it made too are the feature's as well.
  const alsoMade = document.parts.flatMap(p => (p.extrudedWith === part.id ? (p.regions ?? []) : []));
  const regionCount = operation === 'remove' && !part.regions ? null : part.regions ? part.regions.length + alsoMade.length : null;
  const selection =
    part.faceProfile && part.drawnOn
      ? drawnOnName(document, part.drawnOn.on)
      : regionCount === null
        ? sketchStepLabel(owner)
        : regionCount === 0
          ? 'No region picked yet'
          : regionCount === 1
            ? `A region of ${sketchStepLabel(owner)}`
            : `${regionCount} regions of ${sketchStepLabel(owner)}`;
  const board = operation === 'remove' ? removeSupport(document, part) : null;
  const spatialRemove = isSpatialRemoval(part);
  const solidControls = operation !== 'remove';
  // A thickness that can't be used keeps the dialog open until it's fixed or cancelled.
  const [thicknessValid, setThicknessValid] = useState(true);
  const [depthError, setDepthError] = useState<string | null>(null);
  // A sketch that isn't one outline extrudes the region picked from it in the view; until then there's nothing to make.
  // Regions picked apart are fine for New: each group becomes a part of its own on OK.
  const apart = operation === 'new' && splitApartRegions(document, part.id) !== document;
  // An Add folded into its part's profile is checked as that part, by its step problem.
  const mergeTarget = operation === 'add' ? document.parts.find(candidate => candidate.id === part.addTo) : undefined;
  const folded = !!mergeTarget && addsRegionsTo(mergeTarget, part);
  const profileError =
    operation === 'remove' || folded || part.thin || apart || (part.regions?.length === 0 && alsoMade.length)
      ? undefined
      : evaluateCadPart(part).diagnostics.find(diagnostic => diagnostic.severity === 'error');
  const [depthText, setDepthText] = useState(part.thin ? (part.thin.depthExpression ?? lengthText(part.thin.depth)) : lengthText(100));
  const setThin = (thin: CadPart['thin'] | null) => {
    // A thin extrude has a depth of its own, so it no longer goes up to a face.
    if (thin) stopPickingFace();
    onChange(document =>
      changePart(document, part.id, p => {
        const next = { ...p };
        if (thin) {
          next.thin = thin;
          delete next.upTo;
          delete next.upToDatum;
        } else delete next.thin;
        return next;
      })
    );
  };
  /** Takes the typed depth, or says why not. Whether it was taken. */
  const applyDepth = (text = depthText, preview = false) => {
    const parsed = parseCadValue(text, { unit: 'mm', variables });
    const refused = 'error' in parsed ? parsed.error : parsed.value <= 0 ? 'A thin board needs some depth.' : null;
    if (!preview || !refused) setDepthError(refused);
    if ('error' in parsed || refused) return false;
    setThin({
      ...part.thin,
      depth: parsed.value,
      ...(parsed.expression ? { depthExpression: parsed.expression } : { depthExpression: undefined }),
    });
    return true;
  };
  return (
    <FeatureDialog
      title={part.extrudeName ?? `Extrude · ${part.name}`}
      okDisabled={!thicknessValid || !!depthError || !!profileError || !!stepProblem || !!removeError}
      onOk={onOk}
      onCancel={onCancel}>
      {/* New makes the sketch a part of its own; Add joins it to one; Remove cuts it out of the board it's drawn on. */}
      <div className="cad-feature-tabs" role="tablist" aria-label="Extrude operation">
        {(['new', 'add', 'remove'] as const).map(choice => (
          <button key={choice} type="button" role="tab" aria-selected={operation === choice} onClick={() => switchTo(choice)}>
            {choice === 'new' ? 'New' : choice === 'add' ? 'Add' : 'Remove'}
          </button>
        ))}
      </div>
      {operationError && (
        <p role="alert" className="cad-thickness-error">
          {operationError}
        </p>
      )}
      {operation !== 'new' && (
        <div className="cad-feature-selection" data-active={stepProblem ? '' : undefined}>
          <small>{part.faceProfile ? 'Face to extrude' : operation === 'add' ? 'Regions to add' : 'Sketch to cut'}</small>
          <span>{selection}</span>
          <button type="button" aria-pressed={profilePicking} onClick={onPickProfile}>
            Select profile
          </button>
          {!part.faceProfile && (
            <button type="button" onClick={onEditSketch}>
              Edit sketch
            </button>
          )}
        </div>
      )}
      {operation === 'add' ? (
        <>
          <label className="cad-number-field">
            Merge scope
            <select
              value={part.addTo}
              onChange={event => {
                if (!event.target.value) {
                  setOperationError(null);
                  return onChange(current => changePart(current, part.id, p => ({ ...p, addTo: '' })));
                }
                const into = document.parts.find(candidate => candidate.id === event.target.value)!;
                const refused = partIsBuiltOn(document, part, into);
                setOperationError(refused);
                if (!refused) onChange(current => changePart(current, part.id, p => ({ ...p, addTo: into.id })));
              }}>
              <option value="">Pick a part</option>
              {mergeable.map(candidate => (
                <option key={candidate.id} value={candidate.id}>
                  {candidate.name}
                </option>
              ))}
            </select>
          </label>
          {stepProblem && (
            <p role="alert" className="cad-thickness-error">
              {stepProblem}
            </p>
          )}
        </>
      ) : operation === 'remove' ? (
        <>
          {!spatialRemove && board && !('error' in board) && (
            <div className="cad-feature-selection">
              <small>Parts to cut</small>
              <span>{board.board.name}</span>
            </div>
          )}
          {spatialRemove && (
            <label className="cad-number-field">
              Parts to cut
              <select
                multiple
                aria-label="Parts to cut"
                value={removalTargets(document, part).map(target => target.id)}
                onChange={event => {
                  const targets = Array.from(event.target.selectedOptions, option => option.value);
                  onChange(current => changePart(current, part.id, p => ({ ...p, remove: { ...p.remove!, targets } })));
                }}>
                {preceding
                  .filter(candidate => isCadBody(document, candidate))
                  .map(target => (
                    <option key={target.id} value={target.id}>
                      {target.name}
                    </option>
                  ))}
              </select>
            </label>
          )}
          <label className="cad-number-field">
            End type
            <select
              value={part.upTo || pickingFace ? 'upTo' : part.remove!.depth === 'through' ? 'through' : 'blind'}
              onChange={event => {
                if (event.target.value === 'upTo') return startPickingFace();
                stopPickingFace();
                setUpTo(null);
                remove(event.target.value === 'through');
              }}>
              <option value="blind">Blind</option>
              <option value="through">Through all</option>
              <option value="upTo">Up to face</option>
            </select>
          </label>
          {!part.upTo && !pickingFace && part.remove!.depth !== 'through' && (
            <label className="cad-number-field">
              Depth
              <span>
                <CadValueInput
                  bare
                  aria-label="Cut depth"
                  value={removeDepthText}
                  spellCheck={false}
                  aria-invalid={removeError ? true : undefined}
                  onChange={event => {
                    setRemoveDepthText(event.target.value);
                    remove(false, event.target.value, true);
                  }}
                  onBlur={() => remove(false)}
                  onKeyDown={event => {
                    if (event.key === 'Enter' && !remove(false)) {
                      event.preventDefault();
                      event.stopPropagation();
                    }
                  }}
                />
              </span>
              {lengthUnit}
            </label>
          )}
          {(removeError || stepProblem) && (
            <p role="alert" className="cad-thickness-error">
              {removeError || stepProblem}
            </p>
          )}
        </>
      ) : null}
      <>
        {operation === 'new' && part.drawnOn && (
          // Solid pushes the sketch's face out by the thickness; Thin stands a board on a line drawn edge-on.
          <div className="cad-feature-tabs" role="tablist" aria-label="Extrude type">
            <button type="button" role="tab" aria-selected={!part.thin} onClick={() => setThin(null)}>
              Solid
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={!!part.thin}
              onClick={() => {
                const parsed = parseCadValue(depthText, { unit: 'mm', variables });
                setThin({ depth: 'error' in parsed || parsed.value <= 0 ? 100 : parsed.value, midPlane: true });
              }}>
              Thin
            </button>
          </div>
        )}
        {operation === 'new' && (
          <div className="cad-feature-selection" data-active={profileError && !part.regions?.length ? '' : undefined}>
            <small>{part.faceProfile ? 'Face to extrude' : 'Sketch to extrude'}</small>
            <span>{selection}</span>
            <button type="button" aria-pressed={profilePicking} onClick={onPickProfile}>
              Select profile
            </button>
            {!part.faceProfile && (
              <button type="button" onClick={onEditSketch}>
                Edit sketch
              </button>
            )}
          </div>
        )}
        {/* Nothing picked yet isn't a problem, only what to do next. */}
        {profileError && !part.faceProfile && part.regions?.length === 0 ? (
          <p>Pick a region of the sketch in the view.</p>
        ) : (
          profileError && (
            <p role="alert" className="cad-thickness-error">
              {part.faceProfile
                ? (stepProblem ?? profileError.message)
                : part.regions
                  ? profileError.message
                  : 'Pick a region of the sketch in the view.'}
            </p>
          )
        )}
        {solidControls && !part.thin && part.drawnOn && (
          <label className="cad-number-field">
            End type
            <select
              aria-label="End type"
              value={part.upTo || pickingFace ? 'upTo' : 'blind'}
              onChange={event => {
                if (event.target.value === 'upTo') return startPickingFace();
                stopPickingFace();
                setUpTo(null);
              }}>
              <option value="blind">Blind</option>
              <option value="upTo">Up to face</option>
            </select>
          </label>
        )}
        {(part.upTo || pickingFace) && (
          <button
            type="button"
            className="cad-feature-selection"
            aria-label="Up to"
            data-active={pickingFace ? '' : undefined}
            onClick={startPickingFace}>
            <small>Up to</small>
            <span>
              {part.upTo
                ? `${document.planes?.find(plane => plane.id === part.upToDatum)?.name ?? drawnOnName(document, part.upTo)}, ${formatLength(part.thickness)} ${lengthUnit} away`
                : 'Pick a plane or a face'}
            </span>
          </button>
        )}
        {!part.upTo && !pickingFace && !part.thin && part.drawnOn && part.remove?.depth !== 'through' && (
          <label>
            <input
              type="checkbox"
              checked={!!part.symmetric}
              onChange={event =>
                onChange(document =>
                  changePart(document, part.id, p => {
                    const next = { ...p };
                    if (event.target.checked) next.symmetric = true;
                    else delete next.symmetric;
                    return next;
                  })
                )
              }
            />
            Symmetric
          </label>
        )}
        {!part.upTo && !part.symmetric && part.drawnOn && !part.thin?.midPlane && (
          // The other way out of the sketch's plane, or into the face it's drawn on, for a thin board as for a solid one.
          <button
            type="button"
            className="cad-flip-direction"
            aria-label="Flip direction"
            title="Extrude the other way"
            aria-pressed={part.remove ? removalInward(part) : !!part.drawnOn.inward}
            onClick={() =>
              onChange(document =>
                changePart(document, part.id, p => {
                  const drawnOn = { ...p.drawnOn! };
                  if (p.remove) drawnOn.inward = !removalInward(p);
                  else if (drawnOn.inward) delete drawnOn.inward;
                  else drawnOn.inward = true;
                  return { ...p, drawnOn };
                })
              )
            }>
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M7 4v16M4 7l3-3 3 3M17 20V4M14 17l3 3 3-3" />
            </svg>
          </button>
        )}
        {solidControls && !part.upTo && (
          <CadThicknessField
            livePreview
            key={`${part.id}:thickness:${depthDragging}`}
            value={part.thickness}
            expression={part.thicknessExpression}
            variables={variables}
            onValidityChange={setThicknessValid}
            onCommit={(thickness, thicknessExpression) =>
              onChange(document =>
                changePart(document, part.id, p => {
                  const next = { ...p, thickness, thicknessExpression };
                  if (thicknessExpression === undefined) delete next.thicknessExpression;
                  return next;
                })
              )
            }
          />
        )}
        {part.thin && (
          <>
            <label className="cad-number-field">
              Depth
              <span>
                <CadValueInput
                  bare
                  aria-label="Depth"
                  value={depthText}
                  spellCheck={false}
                  aria-invalid={depthError ? true : undefined}
                  onChange={event => {
                    setDepthText(event.target.value);
                    applyDepth(event.target.value, true);
                  }}
                  onBlur={() => applyDepth()}
                  onKeyDown={event => {
                    // A depth that isn't taken keeps the dialog open to fix it, rather than Enter keeping the old one.
                    if (event.key === 'Enter' && !applyDepth()) {
                      event.preventDefault();
                      event.stopPropagation();
                    }
                  }}
                />
              </span>
              {lengthUnit}
            </label>
            {depthError && (
              <p role="alert" className="cad-thickness-error">
                {depthError}
              </p>
            )}
            <label>
              <input
                type="checkbox"
                checked={!!part.thin.midPlane}
                onChange={event => setThin({ ...part.thin!, midPlane: event.target.checked })}
              />
              Mid plane
            </label>
          </>
        )}
        {part.drawnOn && (
          <CadDrawnOnField
            livePreview
            key={`${part.id}:drawn-on`}
            inwardToggle={false}
            document={document}
            part={part as CadPart & { drawnOn: NonNullable<CadPart['drawnOn']> }}
            variables={variables}
            onChange={drawnOn => onChange(document => changePart(document, part.id, p => ({ ...p, drawnOn })))}
          />
        )}
        {solidControls && (
          <CadReliefField
            livePreview
            key={`${part.id}:relief`}
            relief={part.cornerRelief}
            variables={variables}
            onChange={cornerRelief =>
              onChange(document =>
                changePart(document, part.id, p => {
                  const next = { ...p, cornerRelief };
                  if (!cornerRelief) delete next.cornerRelief;
                  return next;
                })
              )
            }
          />
        )}
      </>
    </FeatureDialog>
  );
}
