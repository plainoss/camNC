import { useState } from 'react';
import {
  addPartCopy,
  cadDirectionVector,
  resolvePartPatterns,
  type CadDrawnOn,
  CAD_CHORD_TOLERANCE,
  evaluateCadPart,
  extrudeStepProblem,
  isCadPart,
  partIsBuiltOn,
  removalRegions,
  removeSupport,
  sharesSketch,
  sketchOwnerId,
  sketchRegions,
  splitApartRegions,
  setPartCopyOffset,
  setPartPattern,
  renamePartCopy,
  type CadDocument,
  type CadPart,
  type CadValueScope,
} from '@wbcnc/cad';
import { CadCopyNames } from './CadCopyNames';
import { CadDrawnOnField } from './CadDrawnOnField';
import { CadPartPatternField } from './CadPartPatternField';
import { CadReliefField } from './CadReliefField';
import { CadThicknessField } from './CadThicknessField';
import { FeatureDialog } from './FeatureDialog';
import { formatCadValue, parseCadValue } from './valueExpressions';
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
}: PartDialogProps & {
  onEditSketch: () => void;
  /** Starts picking a plane or a face, for Up to face; the pick comes back once. Null stops a pick under way. */
  pickFace?: (picked: ((on: CadDrawnOn['on'], datum?: string) => void) | null) => void;
}) {
  const [pickingFace, setPickingFace] = useState(false);
  /** Blind to a thickness, or up to a plane or face: its thickness then follows that face. */
  const setUpTo = (upTo: CadDrawnOn['on'] | null, datum?: string) =>
    onChange(document =>
      changePart(document, part.id, p => {
        const next = { ...p };
        if (upTo) {
          next.upTo = upTo;
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
  const operation: ExtrudeOperation = part.remove ? 'remove' : part.addTo ? 'add' : 'new';
  const owner = document.parts.find(candidate => candidate.id === sketchOwnerId(part)) ?? part;
  // The parts an Add can join: made from the same sketch, of regions picked from it.
  const mergeable = document.parts.filter(
    candidate => candidate.id !== part.id && isCadPart(candidate) && sharesSketch(candidate, part) && !!candidate.regions
  );
  const [operationError, setOperationError] = useState<string | null>(null);
  const [removeDepthText, setRemoveDepthText] = useState(() =>
    part.remove && part.remove.depth !== 'through' ? (part.remove.depthExpression ?? formatCadValue(part.remove.depth)) : '6'
  );
  const [removeError, setRemoveError] = useState<string | null>(null);
  /** Regions kept that the extrude can still take, given which of them it picks from. */
  const keptRegions = (p: CadPart, available: string[]) => p.regions?.filter(id => available.includes(id));
  const switchTo = (next: ExtrudeOperation) => {
    setOperationError(null);
    if (next === operation) return;
    if (next !== 'new') {
      const refused =
        (part.thin && 'A thin board can only be a new part.') ||
        (isCadPart(part) && partIsBuiltOn(document, part)) ||
        (next === 'add' && !mergeable.length && 'Add joins regions to a part made from the same sketch. Make one with New first.') ||
        (next === 'remove' &&
          (() => {
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
          if (regions?.length) made.regions = regions;
        } else if (next === 'add') {
          made.addTo = mergeable[0]!.id;
          made.regions = (keptRegions(p, own) ?? []).filter(id => !mergeable[0]!.regions!.includes(id));
        } else {
          const regions = keptRegions(p, own);
          if (regions?.length || p.sketchOf) made.regions = regions ?? [];
        }
        return made;
      })
    );
  };
  /** Remove with the depth as typed, or all the way through. Whether it was taken. */
  const remove = (through: boolean, text = removeDepthText) => {
    const parsed = through ? { value: 'through' as const } : parseCadValue(text, { unit: 'mm', variables });
    const refused = 'error' in parsed ? parsed.error : parsed.value !== 'through' && !(parsed.value > 0) ? 'A cut needs some depth.' : null;
    setRemoveError(refused);
    if ('error' in parsed || refused) return false;
    onChange(current =>
      changePart(current, part.id, p => ({
        ...p,
        remove:
          parsed.value === 'through' || !('expression' in parsed) || !parsed.expression
            ? { depth: parsed.value }
            : { depth: parsed.value, depthExpression: parsed.expression },
      }))
    );
    return true;
  };
  const stepProblem = operation === 'new' ? null : extrudeStepProblem(document, part);
  const regionCount = operation === 'remove' && !part.regions ? null : (part.regions?.length ?? null);
  const selection =
    regionCount === null
      ? `${owner.name}’s sketch`
      : regionCount === 1
        ? `A region of ${owner.name}’s sketch`
        : `${regionCount} regions of ${owner.name}’s sketch`;
  const board = operation === 'remove' ? removeSupport(document, part) : null;
  // A thickness that can't be used keeps the dialog open until it's fixed or cancelled.
  const [thicknessValid, setThicknessValid] = useState(true);
  const [depthError, setDepthError] = useState<string | null>(null);
  // A sketch that isn't one outline extrudes the region picked from it in the view; until then there's nothing to make.
  // Regions picked apart are fine for New: each group becomes a part of its own on OK.
  const apart = operation === 'new' && splitApartRegions(document, part.id) !== document;
  const profileError =
    part.thin || apart ? undefined : evaluateCadPart(part).diagnostics.find(diagnostic => diagnostic.severity === 'error');
  const [depthText, setDepthText] = useState(part.thin ? (part.thin.depthExpression ?? formatCadValue(part.thin.depth)) : '100');
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
  const applyDepth = () => {
    const parsed = parseCadValue(depthText, { unit: 'mm', variables });
    const refused = 'error' in parsed ? parsed.error : parsed.value <= 0 ? 'A thin board needs some depth.' : null;
    setDepthError(refused);
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
      okDisabled={operation === 'new' ? !thicknessValid || !!depthError || !!profileError : !!stepProblem || !!removeError}
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
          <small>{operation === 'add' ? 'Regions to add' : 'Sketch to cut'}</small>
          <span>{selection}</span>
          <button type="button" onClick={onEditSketch}>
            Edit sketch
          </button>
        </div>
      )}
      {operation === 'add' ? (
        <>
          <label className="cad-number-field">
            Merge with
            <select
              value={part.addTo}
              onChange={event => onChange(current => changePart(current, part.id, p => ({ ...p, addTo: event.target.value })))}>
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
          {board && !('error' in board) && (
            <div className="cad-feature-selection">
              <small>Parts to cut</small>
              <span>{board.board.name}</span>
            </div>
          )}
          <label className="cad-number-field">
            End type
            <select
              value={part.remove!.depth === 'through' ? 'through' : 'blind'}
              onChange={event => remove(event.target.value === 'through')}>
              <option value="blind">Blind</option>
              <option value="through">Through all</option>
            </select>
          </label>
          {part.remove!.depth !== 'through' && (
            <label className="cad-number-field">
              Depth
              <span>
                <CadValueInput
                  bare
                  aria-label="Cut depth"
                  value={removeDepthText}
                  spellCheck={false}
                  aria-invalid={removeError ? true : undefined}
                  onChange={event => setRemoveDepthText(event.target.value)}
                  onBlur={() => remove(false)}
                  onKeyDown={event => {
                    if (event.key === 'Enter' && !remove(false)) {
                      event.preventDefault();
                      event.stopPropagation();
                    }
                  }}
                />
              </span>
              mm
            </label>
          )}
          {(removeError || stepProblem) && (
            <p role="alert" className="cad-thickness-error">
              {removeError || stepProblem}
            </p>
          )}
        </>
      ) : (
        <>
          {part.drawnOn && (
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
          <div className="cad-feature-selection" data-active={profileError && !part.regions?.length ? '' : undefined}>
            <small>Sketch to extrude</small>
            <span>{selection}</span>
            <button type="button" onClick={onEditSketch}>
              Edit sketch
            </button>
          </div>
          {profileError && (
            <p role="alert" className="cad-thickness-error">
              {part.regions ? profileError.message : 'Pick a region of the sketch in the view.'}
            </p>
          )}
          {!part.thin && part.drawnOn && (
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
                  ? `${document.planes?.find(plane => plane.id === part.upToDatum)?.name ?? drawnOnName(document, part.upTo)}, ${formatCadValue(part.thickness)} mm away`
                  : 'Pick a plane or a face'}
              </span>
            </button>
          )}
          {!part.upTo && !pickingFace && !part.thin && part.drawnOn && (
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
              aria-pressed={!!part.drawnOn.inward}
              onClick={() =>
                onChange(document =>
                  changePart(document, part.id, p => {
                    const drawnOn = { ...p.drawnOn! };
                    if (drawnOn.inward) delete drawnOn.inward;
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
          {!part.upTo && (
            <CadThicknessField
              key={`${part.id}:thickness`}
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
                    onChange={event => setDepthText(event.target.value)}
                    onBlur={applyDepth}
                    onKeyDown={event => {
                      // A depth that isn't taken keeps the dialog open to fix it, rather than Enter keeping the old one.
                      if (event.key === 'Enter' && !applyDepth()) {
                        event.preventDefault();
                        event.stopPropagation();
                      }
                    }}
                  />
                </span>
                mm
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
              key={`${part.id}:drawn-on`}
              inwardToggle={false}
              document={document}
              part={part as CadPart & { drawnOn: NonNullable<CadPart['drawnOn']> }}
              variables={variables}
              onChange={drawnOn => onChange(document => changePart(document, part.id, p => ({ ...p, drawnOn })))}
            />
          )}
          <CadReliefField
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
        </>
      )}
    </FeatureDialog>
  );
}

/** Copies of a whole part in a row, and what each piece is called. */
export function PartPatternDialog({
  document,
  part,
  variables,
  onChange,
  onOk,
  onCancel,
  pickDirection,
}: PartDialogProps & {
  pickDirection?: (picked: (on: CadDrawnOn['on']) => void) => void;
}) {
  return (
    <FeatureDialog title={`Linear pattern · ${part.name}`} onOk={onOk} onCancel={onCancel}>
      <div className="cad-feature-selection">
        <small>Part to pattern</small>
        <span>{part.name}</span>
      </div>
      <CadPartPatternField
        key={`${part.id}:pattern`}
        pattern={part.pattern}
        document={document}
        pickDirection={pickDirection}
        variables={variables}
        onChange={pattern => onChange(document => setPartPattern(document, part.id, pattern))}
      />
      <CadCopyNames part={part} onRename={(copyId, name) => onChange(document => renamePartCopy(document, part.id, copyId, name))} />
    </FeatureDialog>
  );
}

const kAxisLabels = ['X', 'Y', 'Z'] as const;

/**
 * A copy of a whole part, moved along the studio's axes, as the reference's transform with "Copy part": the copy follows
 * the part, and each distance can use variables. It can be the part's mirror image, as a left side is of a right one.
 */
export function TransformDialog({
  document,
  part,
  copyId,
  variables,
  onSave,
  onCancel,
  pickDirection,
  move,
}: {
  document: CadDocument;
  part: CadPart;
  /** The transformed copy being changed, or none for a new one. */
  copyId?: string;
  /** The part's own move being changed, rather than a copy. */
  move?: boolean;
  variables?: CadValueScope;
  onSave: (document: CadDocument) => void;
  onCancel: () => void;
  /** Starts picking a plane or a face in the view or the feature list, for a direction; the pick comes back once. */
  pickDirection?: (picked: (on: CadDrawnOn['on']) => void) => void;
}) {
  const copy = part.copies?.find(candidate => candidate.id === copyId);
  const moved = move ? part.moved : undefined;
  const alongNow = copy?.along ?? (moved && 'along' in moved ? moved : undefined);
  // Copy part, as in the reference: off by default, so a transform moves the part itself.
  const [copyPart, setCopyPart] = useState(!!copy);
  // By X, Y and Z, or by a distance along a picked plane's or face's normal, as the reference's Translate types.
  const [kind, setKind] = useState<'xyz' | 'distance'>(alongNow ? 'distance' : 'xyz');
  const [direction, setDirection] = useState<CadDrawnOn['on'] | null>(alongNow?.along ?? null);
  const [flip, setFlip] = useState(!!alongNow?.flip);
  const [distanceText, setDistanceText] = useState(
    alongNow ? (copy?.along?.distanceExpression ?? formatCadValue(alongNow.distance)) : '100'
  );
  const [picking, setPicking] = useState(false);
  const pick = () => {
    if (!pickDirection) return;
    setPicking(true);
    pickDirection(on => {
      setDirection(on);
      setPicking(false);
    });
  };
  const typed = (axis: number) =>
    copy?.offset
      ? (copy.offset.positionExpressions?.[axis] ?? formatCadValue(copy.offset.position[axis]!))
      : moved && 'by' in moved
        ? (moved.byExpressions?.[axis] ?? formatCadValue(moved.by[axis]!))
        : '0';
  /** Moves the part itself, from where it's drawn. */
  const saveMove = (next: NonNullable<CadPart['moved']>) => {
    if (!part.drawnOn) return setError('Only a part drawn on a plane or a face can be moved.');
    // A part moved already is moved again from there, by X, Y and Z; its own Transform step changes one along a face.
    if (!move && part.moved) {
      if (!('by' in part.moved) || !('by' in next))
        return setError('This part is already moved. Change its Transform step in the feature list to move it differently.');
      const before = part.moved,
        added = next;
      next = {
        by: before.by.map((value, axis) => value + added.by[axis]!) as [number, number, number],
        ...((before.byExpressions || added.byExpressions) && {
          byExpressions: [0, 1, 2].map(axis => {
            const a = before.byExpressions?.[axis] ?? null,
              b = added.byExpressions?.[axis] ?? null;
            return a || b ? `(${a ?? formatCadValue(before.by[axis]!)}) + (${b ?? formatCadValue(added.by[axis]!)})` : null;
          }) as [string | null, string | null, string | null],
        }),
      };
    }
    onSave({
      ...document,
      revision: document.revision + 1,
      parts: document.parts.map(candidate => (candidate.id === part.id ? { ...candidate, moved: next } : candidate)),
    });
  };
  const [text, setText] = useState([typed(0), typed(1), typed(2)]);
  const [mirrored, setMirrored] = useState(!!copy?.mirrored);
  const [error, setError] = useState<string | null>(null);
  const save = () => {
    if (kind === 'distance') {
      if (!direction) return setError('Pick a plane or a face for the direction.');
      const distance = parseCadValue(distanceText, { unit: 'mm', variables });
      if ('error' in distance) return setError(distance.error);
      const along = {
        along: direction,
        distance: distance.value,
        ...(distance.expression && { distanceExpression: distance.expression }),
        ...(flip && { flip: true }),
      };
      if (!copyPart) return saveMove({ along: along.along, distance: along.distance, ...(flip && { flip: true }) });
      const vector = cadDirectionVector(document, along);
      if (!vector) return setError('The plane or face picked for the direction is gone. Pick another.');
      const offset = {
        position: vector.map(value => value * distance.value) as [number, number, number],
        rotation: [0, 0, 0, 1] as [number, number, number, number],
      };
      const placed = copy
        ? { document: setPartCopyOffset(document, part.id, copy.id, { offset, mirrored }), id: copy.id }
        : addPartCopy(document, part.id, { offset, mirrored });
      const copyIdNow = placed.id;
      return onSave(
        resolvePartPatterns({
          ...placed.document,
          parts: placed.document.parts.map(candidate =>
            candidate.id !== part.id
              ? candidate
              : { ...candidate, copies: candidate.copies?.map(c => (c.id === copyIdNow ? { ...c, along } : c)) }
          ),
        })
      );
    }
    const parsed = text.map(value => parseCadValue(value, { unit: 'mm', variables }));
    const failed = parsed.find(result => 'error' in result);
    if (failed && 'error' in failed) return setError(failed.error);
    const values = parsed as { value: number; expression?: string }[];
    if (!copyPart)
      return saveMove({
        by: values.map(result => result.value) as [number, number, number],
        // Typed with variables, the move follows them.
        ...(values.some(result => result.expression) && {
          byExpressions: values.map(result => result.expression ?? null) as [string | null, string | null, string | null],
        }),
      });
    const offset = {
      position: values.map(result => result.value) as [number, number, number],
      rotation: [0, 0, 0, 1] as [number, number, number, number],
      ...(values.some(result => result.expression) && {
        positionExpressions: values.map(result => result.expression ?? null) as [string | null, string | null, string | null],
      }),
    };
    if (!copy) return onSave(addPartCopy(document, part.id, { offset, mirrored }).document);
    // By X, Y and Z, a copy no longer follows the direction it was picked along.
    const moved = setPartCopyOffset(document, part.id, copy.id, { offset, mirrored });
    onSave({
      ...moved,
      parts: moved.parts.map(candidate =>
        candidate.id !== part.id
          ? candidate
          : {
              ...candidate,
              copies: candidate.copies?.map(c => {
                if (c.id !== copy.id || !c.along) return c;
                const next = { ...c };
                delete next.along;
                return next;
              }),
            }
      ),
    });
  };
  return (
    <FeatureDialog title={`Transform · ${part.name}`} onOk={save} onCancel={onCancel}>
      <div className="cad-feature-selection">
        <small>{copyPart ? 'Part to copy' : 'Part to move'}</small>
        <span>{part.name}</span>
      </div>
      <label className="cad-number-field">
        Type
        <select aria-label="Transform type" value={kind} onChange={event => setKind(event.target.value as 'xyz' | 'distance')}>
          <option value="xyz">Translate by XYZ</option>
          <option value="distance">Translate by distance</option>
        </select>
      </label>
      {kind === 'distance' && (
        <>
          <button
            type="button"
            className="cad-feature-selection"
            data-active={picking || !direction ? '' : undefined}
            onClick={pick}
            aria-label="Direction">
            <small>Direction</small>
            <span>{direction ? drawnOnName(document, direction) : 'Pick a plane or a face'}</span>
          </button>
          <label className="cad-number-field">
            Distance
            <span>
              <CadValueInput
                bare
                aria-label="Distance"
                value={distanceText}
                spellCheck={false}
                onChange={event => setDistanceText(event.target.value)}
              />
            </span>
            mm
          </label>
          <label>
            <input type="checkbox" checked={flip} onChange={event => setFlip(event.target.checked)} />
            Flip direction
          </label>
        </>
      )}
      {kind === 'xyz' &&
        kAxisLabels.map((label, axis) => (
          <label key={label} className="cad-number-field">
            {label}
            <span>
              <CadValueInput
                bare
                aria-label={label}
                value={text[axis]}
                spellCheck={false}
                aria-invalid={error ? true : undefined}
                onChange={event => setText(values => values.map((value, index) => (index === axis ? event.target.value : value)))}
              />
            </span>
            mm
          </label>
        ))}
      {!copy && !move && (
        <label>
          <input type="checkbox" checked={copyPart} onChange={event => setCopyPart(event.target.checked)} />
          Copy part
        </label>
      )}
      {copyPart && (
        <label>
          <input type="checkbox" checked={mirrored} onChange={event => setMirrored(event.target.checked)} />
          Mirror image
        </label>
      )}
      {error && (
        <p role="alert" className="cad-thickness-error">
          {error}
        </p>
      )}
    </FeatureDialog>
  );
}
