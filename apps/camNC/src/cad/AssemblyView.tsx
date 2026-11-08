import {
  assemblyReport,
  cadVariableScope,
  evaluateCadDocument,
  placeAgainst,
  turnAbout,
  type CadDocument,
  type CadPlacement,
  type CadPlacementChange,
  type CadValueScope,
} from '@wbcnc/cad';
import { useMemo, useRef, useState } from 'react';
import { ModelViewport, type ModelFacePick, type ModelView } from '@/cam/model/ModelViewport';
import { assemblyModel, instanceKey, type AssemblyInstance } from './assemblyModel';
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
 * click the face to move, then the face it goes against. A part can have copies, each placed on its own.
 */
export default function AssemblyView({
  document,
  selectedId,
  onSelect,
  onPlace,
  onAddCopy,
  onRemoveCopy,
}: {
  document: CadDocument;
  selectedId: string | null;
  onSelect: (partId: string) => void;
  /** New placements as one edit; none for a piece lays it out with the unplaced pieces again. */
  onPlace: (changes: CadPlacementChange[]) => void;
  /** Adds a copy of a part and returns its ID. */
  onAddCopy?: (partId: string, mirrored: boolean) => string;
  onRemoveCopy?: (partId: string, copyId: string) => void;
}) {
  const frame = useRef<HTMLDivElement>(null);
  const model = useMemo(() => assemblyModel(document), [document]);
  const clashes = useMemo(() => assemblyReport(document, evaluateCadDocument(document).parts)?.collisions ?? [], [document]);
  const [view, setView] = useState<ModelView>('assembled');
  // Placing: first the face to move, then the face it goes against.
  const [placing, setPlacing] = useState<{ moving?: ModelFacePick } | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  // The face a piece was last put against, so it can be turned about it in quarter turns.
  const [against, setAgainst] = useState<(ModelFacePick & { moved: string }) | null>(null);
  // Which copy of the selected part is selected, if not the part itself.
  const [copyId, setCopyId] = useState<string | null>(null);
  const canPlace = model.meshes.length >= 2 && view !== 'flat';
  const part = document.parts.find(candidate => candidate.id === selectedId);
  const copy = part?.copies?.find(candidate => candidate.id === copyId);
  const selected = part && (model.instances.find(instance => instance.partId === part.id && instance.copyId === copy?.id) ?? null);
  const selectedKey = selected ? instanceKey(selected) : null;
  const selectedPlacement = selectedKey ? model.placements.get(selectedKey) : undefined;
  const variables = useMemo(() => cadVariableScope(document), [document]);
  const change = (placement: CadPlacement | undefined): CadPlacementChange => ({
    partId: selected!.partId,
    ...(selected!.copyId && { copyId: selected!.copyId }),
    placement,
  });
  const select = (index: number) => {
    const instance = model.instances[index]!;
    onSelect(instance.partId);
    setCopyId(instance.copyId ?? null);
  };
  /** A quarter turn about an assembly axis through the piece's origin, so a position typed for it still holds. */
  const turnSelected = (axis: [number, number, number]) => {
    const turned = turnAbout(selectedPlacement, selectedPlacement!.position, axis, 90);
    setAgainst(null);
    onPlace([change({ ...selectedPlacement!, rotation: turned.rotation })]);
  };
  const stop = () => {
    setPlacing(null);
    setNotice(null);
  };
  const pickFace = (pick: ModelFacePick) => {
    if (!placing?.moving) {
      select(pick.index);
      setPlacing({ moving: pick });
      setNotice(null);
      return;
    }
    const moving = model.instances[placing.moving.index]!,
      target = model.instances[pick.index]!;
    if (instanceKey(target) === instanceKey(moving)) {
      setNotice('That’s the same part. Click a face on another part.');
      return;
    }
    const targetSource = document.parts.find(candidate => candidate.id === target.partId);
    const targetPlaced = target.copyId ? targetSource?.copies?.find(c => c.id === target.copyId)?.placement : targetSource?.placement;
    const key = (instance: AssemblyInstance) => ({ partId: instance.partId, ...(instance.copyId && { copyId: instance.copyId }) });
    onPlace([
      { ...key(moving), placement: placeAgainst(model.placements.get(instanceKey(moving)), placing.moving, pick) },
      // A piece laid out in the row stays where it was shown, rather than shuffling along as the row changes.
      ...(targetPlaced ? [] : [{ ...key(target), placement: model.placements.get(instanceKey(target)) }]),
    ]);
    setAgainst({ ...pick, moved: instanceKey(moving) });
    stop();
  };
  const status =
    notice ??
    (placing
      ? placing.moving
        ? 'Now click the face to put it against. Esc cancels.'
        : 'Click the face of the part to move. Esc cancels.'
      : clashes.length
        ? `${clashes.map(clash => `${clash.parts[0]} and ${clash.parts[1]}`).join(', ')} take up the same space. Move one, or check the sizes they follow.`
        : model.problems.length
          ? `Not shown: ${model.problems.map(problem => `${problem.name} (${problem.message})`).join(', ')}`
          : view === 'flat'
            ? 'Each part turned so its machined side faces up, the way it lies on the board.'
            : 'Click a part to select it. Drag to orbit.');
  const selectedIndexes = model.instances.flatMap((instance, index) =>
    instanceKey(instance) === selectedKey || index === placing?.moving?.index ? [index] : []
  );
  const placed = copy ? copy.placement : part?.placement;
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
        {against && against.moved === selectedKey && !placing && (
          <button
            type="button"
            title="Turn the part a quarter turn on the face it was put against"
            onClick={() => onPlace([change(turnAbout(selectedPlacement, against.point, against.normal, 90))])}>
            Turn 90°
          </button>
        )}
        {selected && selectedPlacement && !placing && view !== 'flat' && (
          <div className="cad-assembly-positions" role="group" aria-label={`Position of ${selected.name}`}>
            {([0, 1, 2] as const).map(axis => (
              <PositionField
                key={`${selectedKey}:${axis}:${selectedPlacement.positionExpressions?.[axis] ?? selectedPlacement.position[axis]}`}
                axis={axis}
                placement={selectedPlacement}
                variables={variables}
                onPlace={placement => onPlace([change(placement)])}
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
        {placed && !placing && (
          <button
            type="button"
            onClick={() => {
              setAgainst(null);
              onPlace([change(undefined)]);
            }}>
            Lay out again
          </button>
        )}
        {part && !placing && onAddCopy && (
          <div role="group" aria-label={`Copies of ${part.name}`}>
            <button
              type="button"
              title="Another of this part, cut and edited along with it"
              onClick={() => setCopyId(onAddCopy(part.id, false))}>
              Add copy
            </button>
            <button
              type="button"
              title="This part’s mirror image, as a left side is of a right one. It’s cut as a part of its own."
              onClick={() => setCopyId(onAddCopy(part.id, true))}>
              Add mirrored copy
            </button>
            {copy && onRemoveCopy && (
              <button
                type="button"
                onClick={() => {
                  setCopyId(null);
                  onRemoveCopy(part.id, copy.id);
                }}>
                Remove copy
              </button>
            )}
          </div>
        )}
      </div>
      <ModelViewport
        meshes={model.meshes}
        parts={model.parts}
        view={view}
        selectedId={selectedId}
        selectedIndexes={selectedIndexes}
        warnIds={clashes.flatMap(clash => clash.partIds)}
        milled={always}
        onSelect={(_, index) => {
          select(index);
          frame.current?.focus();
        }}
        onPickFace={placing ? pickFace : undefined}
      />
      <p role="status">{status}</p>
    </div>
  );
}
