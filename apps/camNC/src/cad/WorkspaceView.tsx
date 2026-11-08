import { assemblyReport, evaluateCadDocument, partFaceAt, type CadDocument, type CadDrawnOn } from '@wbcnc/cad';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { ModelViewport, type ModelFacePick, type ModelView } from '@/cam/model/ModelViewport';
import { assemblyModel, instanceKey } from './assemblyModel';
import { basePlaneViews, type BasePlane } from './basePlanes';

const kViews: { view: ModelView; label: string }[] = [
  { view: 'assembled', label: 'Assembled' },
  { view: 'exploded', label: 'Exploded' },
  { view: 'flat', label: 'Laid flat' },
];
const always = () => true;
/** Two clicks this close together open a part, rather than selecting it twice. */
const kDoubleClickMs = 400;

/** Every part of the design where it sits. Click a part to select it, and double-click it to work on it. */
export default function WorkspaceView({
  document,
  selectedId,
  onSelect,
  onOpen,
  onNewPart,
  onCutParts,
  choosing: choosingProp,
  onChoosingChange,
  highlightIds,
  hiddenIds,
  selectedPlane,
  onSelectPlane,
  onSelectFace,
  picked,
  children,
}: {
  document: CadDocument;
  selectedId: string | null;
  onSelect: (partId: string) => void;
  onOpen: (partId: string) => void;
  /** Starts a new part drawn on a base plane or a part's face. */
  onNewPart?: (on: CadDrawnOn['on']) => void;
  /** Starts a step cutting some parts out of others. */
  onCutParts?: () => void;
  /**
   * Whether a plane or face is being picked for a new part, when the studio's toolbar starts it. Then the view has no
   * buttons of its own for starting steps.
   */
  choosing?: boolean;
  onChoosingChange?: (choosing: boolean) => void;
  /** Parts shown picked in place of the selected one, such as a cut-parts step's tools and targets. */
  highlightIds?: readonly string[];
  /** Parts hidden from the view, as the parts list's eye toggles them. */
  hiddenIds?: ReadonlySet<string>;
  /** A base plane picked to draw the next sketch on, and picking one outside of choosing. */
  selectedPlane?: BasePlane | null;
  onSelectPlane?: (plane: BasePlane) => void;
  /** The face of the part last clicked, for a sketch started next to be drawn on, as the reference sketches on a selection. */
  onSelectFace?: (on: Extract<CadDrawnOn['on'], { partId: string }> | null) => void;
  /** The name of the plane or face picked for the next sketch, said in the status line so the pick isn't hidden. */
  picked?: string | null;
  /** Shown over the view, such as a step's dialog. */
  children?: ReactNode;
}) {
  const frame = useRef<HTMLDivElement>(null);
  const lastClick = useRef<{ partId: string; at: number } | null>(null);
  const model = useMemo(() => assemblyModel(document, hiddenIds), [document, hiddenIds]);
  const clashes = useMemo(() => assemblyReport(document, evaluateCadDocument(document).parts)?.collisions ?? [], [document]);
  const [view, setView] = useState<ModelView>('assembled');
  const planes = useMemo(() => basePlaneViews(document, selectedPlane), [document, selectedPlane]);
  // Choosing what a new part is drawn on: a plane, or a face clicked in the view.
  const [ownChoosing, setOwnChoosing] = useState(false);
  const controlled = choosingProp !== undefined;
  const choosing = controlled ? choosingProp : ownChoosing;
  const setChoosing = (value: boolean) => (controlled ? onChoosingChange?.(value) : setOwnChoosing(value));
  const [notice, setNotice] = useState<string | null>(null);
  // Escape stops picking, so the view takes the keyboard while it picks.
  useEffect(() => {
    if (choosing) frame.current?.focus();
  }, [choosing]);
  /** The face of a part a click landed on, as a new part can be drawn on it. */
  const faceAt = (pick: ModelFacePick) => {
    const instance = model.instances[pick.index]!;
    if (instance.copyId) return null;
    const part = document.parts.find(candidate => candidate.id === instance.partId)!;
    const face = partFaceAt(part, model.placements.get(instanceKey(instance))!, pick.point, pick.normal);
    return face ? { part, face } : null;
  };
  const pickFace = (pick: ModelFacePick) => {
    if (model.instances[pick.index]!.copyId) return setNotice('Draw on the part itself rather than a copy of it.');
    const found = faceAt(pick);
    if (!found) return setNotice('Pick a flat face: a part’s top, its underside, or one of its straight edges.');
    const { part, face } = found;
    setChoosing(false);
    setNotice(null);
    onNewPart?.({ partId: part.id, face });
  };
  const selectedIndexes = model.instances.flatMap((instance, index) =>
    (highlightIds ? highlightIds.includes(instance.partId) : instance.partId === selectedId) ? [index] : []
  );
  const status = notice
    ? notice
    : choosing
      ? 'Click the face of a part to draw the new part on, or pick a plane. Esc cancels.'
      : picked
        ? `Picked ${picked}: Sketch or Shift+S draws on it.`
        : clashes.length
          ? `${clashes.map(clash => `${clash.parts[0]} and ${clash.parts[1]}`).join(', ')} take up the same space.`
          : model.problems.length
            ? `Not shown: ${model.problems.map(problem => `${problem.name} (${problem.message})`).join(', ')}`
            : view === 'flat'
              ? 'Each part turned so its machined side faces up, the way it lies on the board.'
              : model.meshes.length
                ? 'Click a part to select it, double-click to work on it. Right-drag to turn, middle-drag to pan.'
                : 'Draw a part to start.';
  return (
    <div
      ref={frame}
      className="cad-part-view cad-assembly-view"
      data-testid="workspace-3d"
      tabIndex={-1}
      onKeyDown={event => {
        if (event.key === 'Escape' && choosing) {
          event.stopPropagation();
          setChoosing(false);
          setNotice(null);
        }
      }}>
      <div className="cad-part-view-tools cad-assembly-tools">
        <div role="group" aria-label="Workspace view" className="cad-view-switch">
          {kViews.map(option => (
            <button key={option.view} type="button" aria-pressed={view === option.view} onClick={() => setView(option.view)}>
              {option.label}
            </button>
          ))}
        </div>
        {onNewPart && !controlled && (
          <button
            type="button"
            aria-pressed={choosing}
            onClick={() => {
              setChoosing(!choosing);
              setNotice(null);
              frame.current?.focus();
            }}>
            New part
          </button>
        )}
        {onCutParts && !choosing && document.parts.length > 1 && (
          <button type="button" onClick={onCutParts}>
            Cut parts
          </button>
        )}
        {selectedId && !choosing && !controlled && (
          <button type="button" onClick={() => onOpen(selectedId)}>
            Open {document.parts.find(part => part.id === selectedId)?.name ?? 'part'}
          </button>
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
        onPickFace={choosing ? pickFace : undefined}
        planes={onNewPart ? planes : undefined}
        onPickPlane={id => {
          const plane = id as BasePlane;
          // Picked while choosing, the new part is drawn on it; otherwise it's picked for the next sketch, as a face is.
          if (choosing) {
            setChoosing(false);
            setNotice(null);
            onNewPart?.({ plane });
          } else onSelectPlane?.(plane);
        }}
        onSelect={(_, index, pick) => {
          const partId = model.instances[index]!.partId;
          // The face clicked is picked too, for a sketch started next to be drawn on it.
          const found = pick && faceAt(pick);
          onSelectFace?.(found ? { partId: found.part.id, face: found.face } : null);
          const now = Date.now();
          if (lastClick.current?.partId === partId && now - lastClick.current.at < kDoubleClickMs) {
            lastClick.current = null;
            return onOpen(partId);
          }
          lastClick.current = { partId, at: now };
          onSelect(partId);
          frame.current?.focus();
        }}
      />
      <p role="status">{status}</p>
      {children}
    </div>
  );
}
