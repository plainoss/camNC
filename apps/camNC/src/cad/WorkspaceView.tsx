import { activeDesign, assemblyReport, evaluateCadDocument, isCadBody, partFaceAt, type CadDocument, type CadDrawnOn } from '@wbcnc/cad';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  ModelViewport,
  type ModelDisplay,
  type ModelFacePick,
  type ModelView,
  type ViewRegion,
  type ViewRequest,
} from '@/cam/model/ModelViewport';
import { assemblyModel, instanceKey } from './assemblyModel';
import { basePlaneViews, pickedPlane } from './basePlanes';
import { sketchLinesInModel } from './sketchLines';

const kViews: { view: ModelView; label: string }[] = [
  { view: 'assembled', label: 'Assembled' },
  { view: 'exploded', label: 'Exploded' },
  { view: 'flat', label: 'Laid flat' },
];
const kDisplays: { display: ModelDisplay; label: string }[] = [
  { display: 'edges', label: 'Shaded with edges' },
  { display: 'shaded', label: 'Shaded' },
  { display: 'translucent', label: 'Translucent' },
];
const always = () => true;
/** Two clicks this close together open a part, rather than selecting it twice. */
const kDoubleClickMs = 400;

/** Every part of the design where it sits. Click a part to select it, and double-click it to work on it. */
export default function WorkspaceView({
  document,
  selectedId,
  onSelect,
  onHover,
  onOpen,
  onNewPart,
  onCutParts,
  choosing: choosingProp,
  onChoosingChange,
  highlightIds,
  hiddenIds,
  featureShown,
  transparentIds,
  selectedPlane,
  onSelectPlane,
  onSelectFace,
  picked,
  hoverIds,
  regions,
  onPickRegion,
  viewRequest,
  onViewRequest,
  showPlanes = true,
  children,
}: {
  document: CadDocument;
  selectedId: string | null;
  onSelect: (partId: string) => void;
  onHover?: (id: string | null) => void;
  onOpen: (partId: string) => void;
  /** Starts a new part drawn on a base plane or a part's face. */
  /** A new part drawn on a plane or a face, or on one of the design's planes, offset from what it's on. */
  onNewPart?: (on: CadDrawnOn['on'], datum?: string) => void;
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
  /**
   * Whether a sketch (by its step's id), a plane or the origin is shown, as its eye in the feature list says. Without it
   * the planes show, and the sketches not yet extruded.
   */
  featureShown?: (id: string) => boolean;
  transparentIds?: ReadonlySet<string>;
  /** A base plane picked to draw the next sketch on, and picking one outside of choosing. */
  selectedPlane?: string | null;
  onSelectPlane?: (plane: string) => void;
  /** The face of the part last clicked, for a sketch started next to be drawn on, as the reference sketches on a selection. */
  onSelectFace?: (on: Extract<CadDrawnOn['on'], { partId: string }> | null) => void;
  /** The name of the plane or face picked for the next sketch, said in the status line so the pick isn't hidden. */
  picked?: string | null;
  /** Parts shown highlighted, as when their row in the feature list is hovered. */
  hoverIds?: readonly string[];
  /** A sketch's regions to pick for its extrude, while its Extrude dialog is open. */
  regions?: ViewRegion[];
  onPickRegion?: (id: string) => void;
  viewRequest?: ViewRequest;
  onViewRequest?: (request: Omit<ViewRequest, 'seq'>) => void;
  showPlanes?: boolean;
  /** Shown over the view, such as a step's dialog. */
  children?: ReactNode;
}) {
  const frame = useRef<HTMLDivElement>(null);
  const lastClick = useRef<{ partId: string; at: number } | null>(null);
  const model = useMemo(() => assemblyModel(document, hiddenIds), [document, hiddenIds]);
  const clashes = useMemo(() => {
    // Sketches not yet extruded take up no space.
    const sketches = new Set(document.parts.filter(part => !isCadBody(document, part)).map(part => part.id));
    // Nor does anything suppressed in the feature list.
    const built = activeDesign(document);
    return (
      assemblyReport(
        built,
        evaluateCadDocument(built).parts.filter(part => !sketches.has(part.partId))
      )?.collisions ?? []
    );
  }, [document]);
  const [view, setView] = useState<ModelView>('assembled');
  // The studio shows parts with their edges, as a model usually is.
  const [display, setDisplay] = useState<ModelDisplay>('edges');
  const planes = useMemo(
    () => basePlaneViews(document, selectedPlane).filter(plane => featureShown?.(plane.id) ?? true),
    [document, selectedPlane, featureShown]
  );
  const sketchLines = useMemo(
    () => sketchLinesInModel(document, featureShown && (partId => featureShown(`${partId}:sketch`))),
    [document, featureShown]
  );
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
        {controlled && (
          <select aria-label="Display" value={display} onChange={event => setDisplay(event.target.value as ModelDisplay)}>
            {kDisplays.map(option => (
              <option key={option.display} value={option.display}>
                {option.label}
              </option>
            ))}
          </select>
        )}
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
        viewRequest={viewRequest}
        onViewRequest={onViewRequest}
        transparentIds={transparentIds}
        instanceIds={model.instances.map(instanceKey)}
        selectedId={selectedId}
        selectedIndexes={selectedIndexes}
        // The studio shows parts as the reference does, and says in its status line when two overlap rather than colouring them.
        warnIds={controlled ? undefined : clashes.flatMap(clash => clash.partIds)}
        palette={controlled ? 'studio' : undefined}
        highlightIds={hoverIds ? [...hoverIds] : undefined}
        milled={always}
        onPickFace={choosing ? pickFace : undefined}
        onHover={(id, index) => onHover?.(id !== null && index !== undefined ? instanceKey(model.instances[index]!) : id)}
        planes={onNewPart && showPlanes ? planes : undefined}
        sketchLines={sketchLines}
        display={controlled ? display : 'shaded'}
        showOrigin={!!onNewPart && showPlanes && (featureShown?.('origin') ?? true)}
        regions={regions}
        onPickRegion={onPickRegion}
        onPickPlane={id => {
          // Picked while choosing, the new part is drawn on it; otherwise it's picked for the next sketch, as a face is.
          const plane = pickedPlane(document, id);
          if (choosing && plane) {
            setChoosing(false);
            setNotice(null);
            onNewPart?.(plane.on, plane.datum);
          } else onSelectPlane?.(id);
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
