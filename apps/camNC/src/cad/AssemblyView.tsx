import {
  cadVariableScope,
  placeAgainst,
  turnAbout,
  type CadDocument,
  type CadPlacement,
  type CadPlacementChange,
  type CadValueScope,
} from '@wbcnc/cad';
import { useMemo, useRef, useState } from 'react';
import { ModelViewport, type ModelFacePick, type ModelView } from '@/cam/model/ModelViewport';
import { assemblyModel } from './assemblyModel';
import { formatCadValue, parseCadValue } from './valueExpressions';

const kViews: { view: ModelView; label: string }[] = [
  { view: 'assembled', label: 'Assembled' },
  { view: 'exploded', label: 'Exploded' },
  { view: 'flat', label: 'Laid flat' },
];
const always = () => true;
const kAxes = ['X', 'Y', 'Z'] as const;

/** One position axis of a part, typed as a number or as an expression using the design's variables. */
function PositionField({
  axis,
  placement,
  variables,
  onPlace,
  onError,
}: {
  axis: 0 | 1 | 2;
  placement: CadPlacement;
  variables: CadValueScope;
  onPlace: (placement: CadPlacement) => void;
  /** Why the typed position can't be used, or null once it can. */
  onError: (message: string | null) => void;
}) {
  const typed = placement.positionExpressions?.[axis] ?? formatCadValue(placement.position[axis]);
  const [text, setText] = useState(typed);
  const [error, setError] = useState<string | null>(null);
  const save = () => {
    if (text === typed) return true;
    const parsed = parseCadValue(text, { unit: 'mm', variables });
    if ('error' in parsed) {
      setError(parsed.error);
      onError(`Position ${kAxes[axis]}: ${parsed.error}`);
      return false;
    }
    const position = [...placement.position] as CadPlacement['position'];
    position[axis] = parsed.value;
    const expressions = [...(placement.positionExpressions ?? [null, null, null])] as NonNullable<CadPlacement['positionExpressions']>;
    expressions[axis] = parsed.expression ?? null;
    const next: CadPlacement = { ...placement, position, positionExpressions: expressions };
    if (expressions.every(expression => expression === null)) delete next.positionExpressions;
    setError(null);
    onError(null);
    onPlace(next);
    return true;
  };
  return (
    <label className="cad-assembly-position" title={`Where the part's origin sits along ${kAxes[axis]}, in mm. Variables work here.`}>
      {kAxes[axis]}
      <input
        value={text}
        aria-label={`Position ${kAxes[axis]}`}
        aria-invalid={error ? true : undefined}
        spellCheck={false}
        onChange={event => setText(event.target.value)}
        onBlur={save}
        onKeyDown={event => {
          if (event.key === 'Enter' && save()) event.currentTarget.blur();
          if (event.key === 'Escape') {
            setText(typed);
            setError(null);
            onError(null);
            event.currentTarget.blur();
          }
        }}
      />
    </label>
  );
}

/**
 * Every part of the design together. "Put against" moves a part so a face of it sits flat on a face of another part:
 * click the face to move, then the face it goes against.
 */
export default function AssemblyView({
  document,
  selectedId,
  onSelect,
  onPlace,
}: {
  document: CadDocument;
  selectedId: string | null;
  onSelect: (partId: string) => void;
  /** New placements as one edit; none for a part lays it out with the unplaced parts again. */
  onPlace: (changes: CadPlacementChange[]) => void;
}) {
  const frame = useRef<HTMLDivElement>(null);
  const model = useMemo(() => assemblyModel(document), [document]);
  const [view, setView] = useState<ModelView>('assembled');
  // Placing: first the face to move, then the face it goes against.
  const [placing, setPlacing] = useState<{ moving?: ModelFacePick } | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  // The face a part was last put against, so it can be turned about it in quarter turns.
  const [against, setAgainst] = useState<(ModelFacePick & { moved: string }) | null>(null);
  const canPlace = model.meshes.length >= 2 && view !== 'flat';
  const selected = document.parts.find(part => part.id === selectedId);
  const selectedPlacement = selected && model.placements.get(selected.id);
  const variables = useMemo(() => cadVariableScope(document), [document]);
  /** A quarter turn about an assembly axis through the part's origin, so a position typed for it still holds. */
  const turnSelected = (axis: [number, number, number]) => {
    const turned = turnAbout(selectedPlacement, selectedPlacement!.position, axis, 90);
    setAgainst(null);
    onPlace([{ partId: selected!.id, placement: { ...selectedPlacement!, rotation: turned.rotation } }]);
  };
  const stop = () => {
    setPlacing(null);
    setNotice(null);
  };
  const pickFace = (pick: ModelFacePick) => {
    if (!placing?.moving) {
      onSelect(pick.partId);
      setPlacing({ moving: pick });
      setNotice(null);
      return;
    }
    if (pick.partId === placing.moving.partId) {
      setNotice('That’s the same part. Click a face on another part.');
      return;
    }
    const target = document.parts.find(part => part.id === pick.partId);
    onPlace([
      { partId: placing.moving.partId, placement: placeAgainst(model.placements.get(placing.moving.partId), placing.moving, pick) },
      // A part laid out in the row stays where it was shown, rather than shuffling along as the row changes.
      ...(target && !target.placement ? [{ partId: target.id, placement: model.placements.get(target.id) }] : []),
    ]);
    setAgainst({ ...pick, moved: placing.moving.partId });
    stop();
  };
  const status =
    notice ??
    (placing
      ? placing.moving
        ? 'Now click the face to put it against. Esc cancels.'
        : 'Click the face of the part to move. Esc cancels.'
      : model.problems.length
        ? `Not shown: ${model.problems.map(problem => `${problem.name} (${problem.message})`).join(', ')}`
        : view === 'flat'
          ? 'Each part turned so its machined side faces up, the way it lies on the board.'
          : 'Click a part to select it. Drag to orbit.');
  return (
    <div
      ref={frame}
      className="cad-part-view cad-assembly-view"
      data-testid="assembly-3d"
      tabIndex={-1}
      onKeyDown={event => {
        event.stopPropagation();
        if (event.key === 'Escape' && placing) {
          event.preventDefault();
          stop();
        }
      }}>
      <div className="cad-part-view-tools cad-assembly-tools">
        <div role="group" aria-label="Assembly view">
          {kViews.map(option => (
            <button
              key={option.view}
              type="button"
              aria-pressed={view === option.view}
              onClick={() => {
                setView(option.view);
                if (option.view === 'flat') stop();
              }}>
              {option.label}
            </button>
          ))}
        </div>
        <button
          type="button"
          aria-pressed={!!placing}
          disabled={!canPlace}
          title={canPlace ? 'Put one part’s face flat against another’s' : 'Needs two parts, assembled or exploded'}
          onClick={() => {
            if (placing) stop();
            else {
              setPlacing({});
              frame.current?.focus();
            }
          }}>
          Put against…
        </button>
        {against && against.moved === selectedId && !placing && (
          <button
            type="button"
            title="Turn the part a quarter turn on the face it was put against"
            onClick={() =>
              onPlace([
                { partId: against.moved, placement: turnAbout(model.placements.get(against.moved), against.point, against.normal, 90) },
              ])
            }>
            Turn 90°
          </button>
        )}
        {selected && selectedPlacement && !placing && view !== 'flat' && (
          <div className="cad-assembly-positions" role="group" aria-label={`Position of ${selected.name}`}>
            {([0, 1, 2] as const).map(axis => (
              <PositionField
                key={`${selected.id}:${axis}:${selectedPlacement.positionExpressions?.[axis] ?? selectedPlacement.position[axis]}`}
                axis={axis}
                placement={selectedPlacement}
                variables={variables}
                onPlace={placement => onPlace([{ partId: selected.id, placement }])}
                onError={setNotice}
              />
            ))}
          </div>
        )}
        {selected && selectedPlacement && !placing && view !== 'flat' && (
          <div role="group" aria-label={`Turn ${selected.name}`}>
            {kAxes.map((name, i) => (
              <button
                key={name}
                type="button"
                title={`Turn a quarter turn about ${name}, around the part's origin`}
                onClick={() => turnSelected([i === 0 ? 1 : 0, i === 1 ? 1 : 0, i === 2 ? 1 : 0])}>
                ⟲{name}
              </button>
            ))}
          </div>
        )}
        {selected?.placement && !placing && (
          <button
            type="button"
            onClick={() => {
              setAgainst(null);
              onPlace([{ partId: selected.id, placement: undefined }]);
            }}>
            Lay out again
          </button>
        )}
      </div>
      <ModelViewport
        meshes={model.meshes}
        parts={model.parts}
        view={view}
        selectedId={selectedId}
        highlightIds={placing?.moving ? [placing.moving.partId] : []}
        milled={always}
        onSelect={partId => {
          onSelect(partId);
          frame.current?.focus();
        }}
        onPickFace={placing ? pickFace : undefined}
      />
      <p role="status">{status}</p>
    </div>
  );
}
