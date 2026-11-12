import { useDesignUnits } from './designUnits';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  newCadId,
  numberedCadCopy,
  mateMove,
  unmovedPick,
  cadDirectionVector,
  resolvePartPatterns,
  type CadDrawnOn,
  setPartCopyOffset,
  type CadDocument,
  type CadPart,
  type CadValueScope,
} from '@wbcnc/cad';
import { FeatureDialog } from './FeatureDialog';
import { CadValueInput } from './CadValueInput';
import { drawnOnName } from './drawnOnName';
import { DialogPartField } from './DialogPartField';
import { useDialogPartPick, type DialogPartPicks } from './useDialogPartPick';

const kAxisLabels = ['X', 'Y', 'Z'] as const;
type TransformKind = 'xyz' | 'distance' | 'mate' | 'rotate' | 'line';
/** The points each kind picks in the view, with what each is called on its button and above its value. */
const kPicks = {
  from: { label: 'Mate connector', title: 'Connector on the part' },
  to: { label: 'Mate connector to move to', title: 'Connector to move to' },
  axis: { label: 'Axis', title: 'Axis' },
  start: { label: 'Line start', title: 'Line from' },
  end: { label: 'Line end', title: 'Line to' },
} as const;
type PickEnd = keyof typeof kPicks;
const kKindPicks: Partial<Record<TransformKind, PickEnd[]>> = { mate: ['from', 'to'], rotate: ['axis'], line: ['start', 'end'] };

/** An implicit mate connector picked in the view: where on a part, in the design's space. */
export interface CadConnectorPick {
  partId: string;
  point: [number, number, number];
  /** The way the face picked looks: a connector's axis. */
  normal: [number, number, number];
  /** Picked on a copy of the part rather than the part itself. */
  copy?: boolean;
  /** The part's straight edge the click was on, end to end. */
  edge?: { a: [number, number, number]; b: [number, number, number] };
}

/** A picked edge as a line: through its start, along it. A face's pick is the line straight out of it. */
const pickedLine = (pick: CadConnectorPick): CadConnectorPick => {
  if (!pick.edge) return pick;
  const { a, b } = pick.edge;
  const along = b.map((value, axis) => value - a[axis]!) as [number, number, number];
  const length = Math.hypot(...along);
  return { ...pick, point: a, normal: along.map(value => value / length) as [number, number, number] };
};

/**
 * A copy of a whole part, moved along the studio's axes, as the reference's transform with "Copy part": the copy follows
 * the part, and each distance can use variables. It can be the part's mirror image, as a left side is of a right one.
 */
export function TransformDialog({
  document,
  part: openedFor,
  copyId,
  variables,
  onSave,
  onPreview,
  onConnectorsChange,
  onCancel,
  pickDirection,
  move,
  pickPoint,
  partPicks,
}: {
  document: CadDocument;
  part: CadPart;
  /** The transformed copy being changed, or none for a new one. */
  copyId?: string;
  /** The part's own move being changed, rather than a copy. */
  move?: boolean;
  variables?: CadValueScope;
  onSave: (document: CadDocument) => void;
  /** Shows the candidate without accepting it; null clears an incomplete or invalid candidate. */
  onPreview?: (document: CadDocument | null) => void;
  /** Picked connector frames in the original geometry, for viewport markers. */
  onConnectorsChange?: (picks: { from?: CadConnectorPick; to?: CadConnectorPick }) => void;
  onCancel: () => void;
  /** Starts picking a plane or a face in the view or the feature list, for a direction; the pick comes back once. */
  pickDirection?: (picked: ((on: CadDrawnOn['on']) => void) | null) => void;
  /** Starts picking a mate connector in the view: a part's face corner or middle, as a click snaps to. Null stops it. */
  pickPoint?: (picked: ((pick: CadConnectorPick) => void) | null) => void;
  /** Parts clicked while it's open: a new transform's part field takes them. */
  partPicks?: DialogPartPicks;
}) {
  const { parseCadValue, lengthText, formatLength, lengthUnit } = useDesignUnits();
  const editing = !!copyId || !!move;
  // What was picked on the part before belongs to that part, not to the one picked instead.
  const partPick = useDialogPartPick({
    document,
    partId: openedFor.id,
    picks: partPicks,
    pickable: !editing,
    startActive: true,
    take: () => {
      setPickingMate(null);
      setPicks({});
    },
  });
  const part = document.parts.find(candidate => candidate.id === partPick.partId) ?? openedFor;
  const copy = part.copies?.find(candidate => candidate.id === copyId);
  const moved = move ? part.moved : undefined;
  const alongNow = copy?.along ?? (moved && 'along' in moved ? moved : undefined);
  // Copy part, as in the reference: off by default, so a transform moves the part itself.
  const [copyPart, setCopyPart] = useState(!!copy);
  // By X, Y and Z, or by a distance along a picked plane's or face's normal, as the reference's Translate types.
  const [kind, setKind] = useState<TransformKind>(alongNow ? 'distance' : 'xyz');
  const [direction, setDirection] = useState<CadDrawnOn['on'] | null>(alongNow?.along ?? null);
  const [flip, setFlip] = useState(!!alongNow?.flip);
  const [distanceText, setDistanceText] = useState(
    alongNow ? (copy?.along?.distanceExpression ?? lengthText(alongNow.distance)) : lengthText(100)
  );
  const [picking, setPicking] = useState(false);
  const pick = () => {
    if (!pickDirection) return;
    partPick.deactivate();
    setPicking(true);
    pickDirection(on => {
      setDirection(on);
      setPicking(false);
    });
  };
  const typed = (axis: number) =>
    copy?.offset
      ? (copy.offset.positionExpressions?.[axis] ?? lengthText(copy.offset.position[axis]!))
      : moved && 'by' in moved
        ? (moved.byExpressions?.[axis] ?? lengthText(moved.by[axis]!))
        : '0';
  const [text, setText] = useState([typed(0), typed(1), typed(2)]);
  const [mirrored, setMirrored] = useState(!!copy?.mirrored);
  const [error, setError] = useState<string | null>(null);
  // Transform by mate connectors: a corner or face middle on the part, and the one it goes to.
  // Rotate: about the line out of a picked face, through the point picked on it. Translate by line: from one point to another.
  const [picks, setPicks] = useState<Partial<Record<PickEnd, CadConnectorPick>>>({});
  const { from: mateFrom, to: mateTo, axis: axisPick } = picks;
  const [pickingMate, setPickingMate] = useState<PickEnd | null>(null);
  const [angleText, setAngleText] = useState('30');
  // Closed while picking, the view stops picking.
  useEffect(() => () => pickPoint?.(null), [pickPoint]);
  const pickMate = (end: PickEnd) => {
    if (!pickPoint) return;
    partPick.deactivate();
    setPickingMate(end);
    setError(null);
    pickPoint(picked => {
      setPickingMate(null);
      if (end === 'from' && (picked.partId !== part.id || picked.copy)) return setError(`Pick the first connector on ${part.name} itself.`);
      // An edge picked for the line is the whole line, from one end to the other.
      // Picking where the line ends, after its start, an edge gives only its nearest point.
      if ((end === 'start' || (end === 'end' && !picks.start)) && picked.edge)
        return setPicks(before => ({
          ...before,
          start: { ...picked, point: picked.edge!.a },
          end: { ...picked, point: picked.edge!.b },
        }));
      setPicks(before => ({ ...before, [end]: picked }));
      if (end === 'from') pickMate('to');
    });
  };
  const [newCopyId] = useState(newCadId);
  const candidate = useMemo((): CadDocument | { error: string } => {
    const invalid = (error: string) => ({ error });
    // Use the opening document on every keystroke: previews must never accumulate a move or another copy.
    const addCopy = (change: Parameters<typeof setPartCopyOffset>[3]) => ({
      id: newCopyId,
      document: setPartCopyOffset(
        {
          ...document,
          parts: document.parts.map(candidate =>
            candidate.id !== part.id
              ? candidate
              : {
                  ...candidate,
                  // The next free number, so the part's other copies keep theirs.
                  copies: [...(candidate.copies ?? []), numberedCadCopy(candidate, { id: newCopyId })],
                }
          ),
        },
        part.id,
        newCopyId,
        change
      ),
    });
    /** Moves the part itself, from where it's drawn. */
    const saveMove = (next: NonNullable<CadPart['moved']>): CadDocument | { error: string } => {
      if (!part.drawnOn) return invalid('Only a part drawn on a plane or a face can be moved.');
      // A part moved already is moved again from there, by X, Y and Z; its own Transform step changes one along a face.
      if (!move && part.moved) {
        if (!('by' in part.moved) || !('by' in next) || part.moved.turn || next.turn)
          return invalid('This part is already moved. Change its Transform step in the feature list to move it differently.');
        const before = part.moved,
          added = next;
        next = {
          by: before.by.map((value, axis) => value + added.by[axis]!) as [number, number, number],
          ...((before.byExpressions || added.byExpressions) && {
            byExpressions: [0, 1, 2].map(axis => {
              const a = before.byExpressions?.[axis] ?? null,
                b = added.byExpressions?.[axis] ?? null;
              return a || b ? `(${a ?? `${before.by[axis]!} mm`}) + (${b ?? `${added.by[axis]!} mm`})` : null;
            }) as [string | null, string | null, string | null],
          }),
        };
      }
      return {
        ...document,
        revision: document.revision + 1,
        parts: document.parts.map(candidate => (candidate.id === part.id ? { ...candidate, moved: next } : candidate)),
      };
    };

    if (kind === 'distance') {
      if (!direction) return invalid('Pick a plane or a face for the direction.');
      const distance = parseCadValue(distanceText, { unit: 'mm', variables });
      if ('error' in distance) return invalid(distance.error);
      const along = {
        along: direction,
        distance: distance.value,
        ...(distance.expression && { distanceExpression: distance.expression }),
        ...(flip && { flip: true }),
      };
      if (!copyPart) return saveMove({ along: along.along, distance: along.distance, ...(flip && { flip: true }) });
      const vector = cadDirectionVector(document, along);
      if (!vector) return invalid('The plane or face picked for the direction is gone. Pick another.');
      const offset = {
        position: vector.map(value => value * distance.value) as [number, number, number],
        rotation: [0, 0, 0, 1] as [number, number, number, number],
      };
      const placed = copy
        ? { document: setPartCopyOffset(document, part.id, copy.id, { offset, mirrored }), id: copy.id }
        : addCopy({ offset, mirrored });
      const copyIdNow = placed.id;
      return resolvePartPatterns({
        ...placed.document,
        parts: placed.document.parts.map(candidate =>
          candidate.id !== part.id
            ? candidate
            : { ...candidate, copies: candidate.copies?.map(c => (c.id === copyIdNow ? { ...c, along } : c)) }
        ),
      });
    }
    let values: { value: number; expression?: string }[];
    // By X, Y and Z, a turned part or copy stays turned.
    let turn = kind === 'xyz' ? (copy ? copy.turn : move && part.moved && 'by' in part.moved ? part.moved.turn : undefined) : undefined;
    // Changing the part's own move, what's picked on it sits where that move put it.
    // A move by a distance along a direction is undone as the step it makes now.
    const along = part.moved && !('by' in part.moved) ? part.moved : undefined;
    const alongStep = along && cadDirectionVector(document, along)?.map(value => value * along.distance);
    const current = part.moved && 'by' in part.moved ? part.moved : alongStep && { by: alongStep as [number, number, number] };
    const unmoved = (pick: CadConnectorPick) =>
      !copyPart && move && pick.partId === part.id && current ? unmovedPick(pick, current) : pick;
    if (kind === 'mate') {
      // The part turns so its connector's face meets the other's, then moves so the two points touch.
      if (!mateFrom || !mateTo) return invalid(`Pick a corner or face middle on ${part.name}, then one to move it to.`);
      const mate = mateMove(unmoved(mateFrom), mateTo);
      values = mate.by.map(value => ({ value }));
      turn = mate.turn;
    } else if (kind === 'line') {
      // Along the line, by its length, as the reference translates by a line or two points.
      const { start, end } = picks;
      if (!start || !end) return invalid('Pick an edge for the line, or two points: where it starts and where it ends.');
      values = end.point.map((value, axis) => ({ value: +(value - start.point[axis]!).toFixed(6) }));
    } else if (kind === 'rotate') {
      if (!axisPick) return invalid('Pick an edge for the axis, or a face: the part turns about the line straight out of it.');
      const angle = parseCadValue(angleText, { unit: 'deg', variables });
      if ('error' in angle) return invalid(angle.error);
      const axis = unmoved(pickedLine(axisPick));
      values = [{ value: 0 }, { value: 0 }, { value: 0 }];
      turn = {
        about: axis.point,
        axis: axis.normal,
        degrees: angle.value,
        ...(angle.expression && { degreesExpression: angle.expression }),
      };
    } else {
      const parsed = text.map(value => parseCadValue(value, { unit: 'mm', variables }));
      const failed = parsed.find(result => 'error' in result);
      if (failed && 'error' in failed) return invalid(failed.error);
      values = parsed as { value: number; expression?: string }[];
    }
    if (!copyPart)
      return saveMove({
        by: values.map(result => result.value) as [number, number, number],
        // Typed with variables, the move follows them.
        ...(values.some(result => result.expression) && {
          byExpressions: values.map(result => result.expression ?? null) as [string | null, string | null, string | null],
        }),
        ...(turn && { turn }),
      });
    const offset = {
      position: values.map(result => result.value) as [number, number, number],
      rotation: [0, 0, 0, 1] as [number, number, number, number],
      ...(values.some(result => result.expression) && {
        positionExpressions: values.map(result => result.expression ?? null) as [string | null, string | null, string | null],
      }),
    };
    if (!copy) return addCopy({ offset, mirrored, turn }).document;
    // By X, Y and Z, a copy no longer follows the direction it was picked along.
    // Clear the old direction before resolving the new offset, or it replaces the freshly typed XYZ values.
    const independent = {
      ...document,
      parts: document.parts.map(candidate =>
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
    };
    return setPartCopyOffset(independent, part.id, copy.id, { offset, mirrored, turn });
  }, [
    document,
    part,
    copy,
    copyPart,
    move,
    kind,
    direction,
    distanceText,
    variables,
    flip,
    mirrored,
    text,
    picks,
    mateFrom,
    mateTo,
    axisPick,
    angleText,
    newCopyId,
    parseCadValue,
  ]);
  const callbacks = useRef({ onPreview, onConnectorsChange });
  callbacks.current = { onPreview, onConnectorsChange };
  useEffect(() => {
    callbacks.current.onPreview?.('error' in candidate ? null : candidate);
  }, [candidate]);
  useEffect(() => {
    callbacks.current.onConnectorsChange?.(
      kind === 'mate' ? { ...('from' in picks && { from: picks.from }), ...('to' in picks && { to: picks.to }) } : {}
    );
  }, [kind, picks]);
  const save = () => {
    if ('error' in candidate) return setError(candidate.error);
    onSave(candidate);
  };
  return (
    <FeatureDialog title={`Transform · ${part.name}`} onOk={save} onCancel={onCancel}>
      <DialogPartField
        label={copyPart ? 'Part to copy' : 'Part to move'}
        name={part.name}
        pick={editing ? null : partPick}
        onActivate={() => {
          setPicking(false);
          setPickingMate(null);
          pickDirection?.(null);
          pickPoint?.(null);
          partPick.activate();
        }}
      />
      <label className="cad-number-field">
        Type
        <select
          aria-label="Transform type"
          value={kind}
          onChange={event => {
            const kind = event.target.value as TransformKind;
            setKind(kind);
            if (kind === 'mate') pickMate('from');
            else {
              setPickingMate(null);
              pickPoint?.(null);
            }
          }}>
          <option value="xyz">Translate by XYZ</option>
          <option value="distance">Translate by distance</option>
          {pickPoint && <option value="mate">Transform by mate connectors</option>}
          {pickPoint && <option value="rotate">Rotate</option>}
          {pickPoint && <option value="line">Translate by line</option>}
        </select>
      </label>
      {kind === 'distance' && (
        <>
          <button
            type="button"
            className="cad-feature-selection"
            data-active={(picking || !direction) && !partPick.active ? '' : undefined}
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
            {lengthUnit}
          </label>
          <label>
            <input type="checkbox" checked={flip} onChange={event => setFlip(event.target.checked)} />
            Flip direction
          </label>
        </>
      )}
      {kKindPicks[kind]?.map(end => {
        const picked = picks[end];
        return (
          <button
            key={end}
            type="button"
            className="cad-feature-selection"
            data-active={(pickingMate === end || !picked) && !partPick.active ? '' : undefined}
            aria-label={kPicks[end].label}
            onClick={() => pickMate(end)}>
            <small>{end === 'from' ? `Connector on ${part.name}` : kPicks[end].title}</small>
            <span>
              {picked
                ? picked.edge
                  ? `Edge of ${document.parts.find(candidate => candidate.id === picked.partId)?.name ?? 'a part'}, ${formatLength(Math.hypot(...picked.edge.b.map((value, axis) => value - picked.edge!.a[axis]!)))} ${lengthUnit}`
                  : `${document.parts.find(candidate => candidate.id === picked.partId)?.name ?? 'Part'} at ${picked.point.map(value => +value.toFixed(2)).join(', ')}`
                : end === 'from' || end === 'to'
                  ? 'Click a corner or the middle of a face'
                  : 'Click an edge, a corner or the middle of a face'}
            </span>
          </button>
        );
      })}
      {kind === 'rotate' && (
        <label className="cad-number-field">
          Angle
          <span>
            <CadValueInput
              bare
              aria-label="Angle"
              value={angleText}
              spellCheck={false}
              onChange={event => setAngleText(event.target.value)}
            />
          </span>
          deg
        </label>
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
            {lengthUnit}
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
