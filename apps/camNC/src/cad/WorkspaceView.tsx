import {
  activeDesign,
  assemblyReport,
  cadPartReferenceMatches,
  cadFaceFrame,
  evaluateCadDocument,
  isCadBody,
  partFaceAt,
  type CadDocument,
  type CadDrawnOn,
} from '@wbcnc/cad';
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  ModelViewport,
  type ModelDisplay,
  type ModelFacePick,
  type ModelView,
  type ViewRegion,
  type ViewRequest,
} from '@/cam/model/ModelViewport';
import { ExplosionSlider } from '@/cam/model/ExplosionSlider';
import { useExplodedView } from '@/cam/model/useExplodedView';
import { assemblyModel, instanceKey } from './assemblyModel';
import { basePlaneViews, pickedPlane } from './basePlanes';
import { sketchLinesInModel } from './sketchLines';
import { sketchSelectionRegions } from './profileSelection';
import type { StudioCameraRef } from './studioCamera';
import type { CadConnectorPick } from './TransformDialog';
import type { ExtrudeDepthControl } from './extrudeDepth';
import { useStudioMeasure } from './useStudioMeasure';
import { StudioMeasurePanel } from './StudioMeasurePanel';
import { useStudioSection } from './useStudioSection';
import { sectionModel } from './sectionModel';
import { StudioSectionControls, StudioSectionInspector } from './StudioSectionControls';

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
  onReady,
  cameraState,
  extrusionDepth,
  document,
  profileDocument = document,
  selectedId,
  selectedCopyId,
  selectedFace,
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
  pickingMirrorPlane = false,
  onPickPoint,
  connectors,
  picked,
  hoverIds,
  regions,
  onPickRegion,
  onPickSketch,
  viewRequest,
  onViewRequest,
  showPlanes = true,
  measurementEnabled = true,
  children,
}: {
  /** The lazy view has mounted; a pending keyboard handoff can now focus it. */
  onReady?: () => void;
  cameraState?: StudioCameraRef;
  extrusionDepth?: ExtrudeDepthControl | null;
  document: CadDocument;
  profileDocument?: CadDocument;
  selectedId: string | null;
  selectedFace?: Extract<CadDrawnOn['on'], { partId: string }> | null;
  selectedCopyId?: string;
  onSelect: (partId: string, copyId?: string) => void;
  onHover?: (id: string | null) => void;
  onOpen: (partId: string, copyId?: string) => void;
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
  /** Mirror accepts a planar face of a physical copy without selecting or opening that part. */
  pickingMirrorPlane?: boolean;
  /** While set, a click picks the corner or face middle it snaps to, as a mate connector, instead of selecting. */
  onPickPoint?: (pick: {
    partId: string;
    point: [number, number, number];
    normal: [number, number, number];
    copy: boolean;
    edge?: { a: [number, number, number]; b: [number, number, number] };
  }) => void;
  connectors?: { from?: CadConnectorPick; to?: CadConnectorPick };
  /** The name of the plane or face picked for the next sketch, said in the status line so the pick isn't hidden. */
  picked?: string | null;
  /** Parts shown highlighted, as when their row in the feature list is hovered. */
  hoverIds?: readonly string[];
  /** A sketch's regions to pick for its extrude, while its Extrude dialog is open. */
  regions?: ViewRegion[];
  onPickRegion?: (id: string) => void;
  onPickSketch?: (id: string, region?: string) => void;
  viewRequest?: ViewRequest;
  onViewRequest?: (request: Omit<ViewRequest, 'seq'>) => void;
  showPlanes?: boolean;
  /** Feature selection has priority over read-only geometry inspection. */
  measurementEnabled?: boolean;
  /** Shown over the view, such as a step's dialog. */
  children?: ReactNode;
}) {
  const frame = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    onReady?.();
  }, [onReady]);
  const lastClick = useRef<{ partId: string; face: string; at: number; topology: object } | null>(null);
  const assembly = useMemo(() => assemblyModel(document, hiddenIds), [document, hiddenIds]);
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
  const explosion = useExplodedView(view, setView);
  // The studio shows parts with their edges, as a model usually is.
  const [display, setDisplay] = useState<ModelDisplay>('edges');
  const planes = useMemo(
    () => basePlaneViews(document, selectedPlane).filter(plane => featureShown?.(plane.id) ?? true),
    [document, selectedPlane, featureShown]
  );
  const sketchLines = useMemo(
    () => sketchLinesInModel(profileDocument, featureShown && (partId => featureShown(`${partId}:sketch`))),
    [profileDocument, featureShown]
  );
  const sketchRegions = useMemo(
    () =>
      onPickSketch
        ? sketchSelectionRegions(
            profileDocument,
            featureShown ?? (id => profileDocument.parts.find(p => `${p.id}:sketch` === id)?.extrude === false),
            selectedId
          )
        : [],
    [profileDocument, featureShown, onPickSketch, selectedId]
  );
  // Choosing what a new part is drawn on: a plane, or a face clicked in the view.
  const [ownChoosing, setOwnChoosing] = useState(false);
  const controlled = choosingProp !== undefined;
  const choosing = controlled ? choosingProp : ownChoosing;
  const setChoosing = (value: boolean) => (controlled ? onChoosingChange?.(value) : setOwnChoosing(value));
  // Feature pickers must own the first render, before an effect has closed the section's old picker state.
  const sectionEnabled = measurementEnabled && !choosing && !pickingMirrorPlane && !onPickPoint && !(onPickRegion && regions?.length);
  const section = useStudioSection(document, assembly, frame, sectionEnabled, onViewRequest, selectedPlane, selectedFace);
  const model = useMemo(() => sectionModel(assembly, section.plane), [assembly, section.plane]);
  const sectionProblem = model.sectionProblems.length
    ? `Section unavailable: ${model.sectionProblems.map(item => `${item.name}: ${item.message}`).join('; ')} Showing the full model.`
    : null;
  const sectionAvailable = model.sectionProblems.length === 0;
  // Hiding an unsupported body can change a full-model fallback into a valid section without editing the design.
  const inspectionTopology = useMemo(
    () => ({ plane: section.plane, available: sectionAvailable, editing: section.editing }),
    [section.plane, sectionAvailable, section.editing]
  );
  useEffect(() => {
    if (section.active) setView('assembled');
  }, [section.active]);
  // The Assembled button changes first; parts can still be animating back in the rendered exploded layout.
  const measureEnabled = sectionEnabled && view === 'assembled' && explosion.modelView === 'assembled' && !section.editing;
  const measure = useStudioMeasure(document, model, frame, measureEnabled, inspectionTopology);
  const [notice, setNotice] = useState<string | null>(null);
  // Escape stops picking, so the view takes the keyboard while it picks.
  useEffect(() => {
    if (choosing) frame.current?.focus({ preventScroll: true });
  }, [choosing]);
  /** The face of a part a click landed on, as a new part can be drawn on it. */
  const faceAt = (pick: ModelFacePick) => {
    if (pick.sectionCap) return null;
    const instance = model.instances[pick.index]!;

    const part = document.parts.find(candidate => candidate.id === instance.partId)!;
    const copy = instance.copyId ? part.copies?.find(copy => copy.id === instance.copyId) : undefined;
    // Mirrored instances share edge IDs while their sketch x coordinates are reflected.
    const facePart = copy?.mirrored
      ? {
          ...part,
          sketch: {
            ...part.sketch,
            entities: part.sketch.entities.map(entity => (entity.type === 'point' ? { ...entity, x: -entity.x } : entity)),
          },
        }
      : part;
    const face = partFaceAt(facePart, model.placements.get(instanceKey(instance))!, pick.point, pick.normal);
    return face ? { part, face, ...(instance.copyId && { copyId: instance.copyId }) } : null;
  };
  const pickFace = (pick: ModelFacePick) => {
    const found = faceAt(pick);
    if (!found) return setNotice('Pick a flat face: a part’s top, its underside, or one of its straight edges.');
    const { part, face, copyId } = found;
    setChoosing(false);
    setNotice(null);
    onNewPart?.({ partId: part.id, face, ...(copyId && { copyId }) });
  };
  const pickMirrorFace = (pick: ModelFacePick) => {
    const found = faceAt(pick);
    if (!found) return setNotice('Pick a flat face: a part’s top, its underside, or one of its straight edges.');
    setNotice(null);
    lastClick.current = null;
    onSelectFace?.({ partId: found.part.id, face: found.face, ...(found.copyId && { copyId: found.copyId }) });
  };
  const selectedIndexes = model.instances.flatMap((instance, index) =>
    (
      highlightIds
        ? cadPartReferenceMatches(highlightIds, instance.partId, instance.copyId)
        : instance.partId === selectedId && (selectedCopyId === undefined || instance.copyId === selectedCopyId)
    )
      ? [index]
      : []
  );
  const selectedFrame = selectedFace && cadFaceFrame(document, selectedFace);
  const selectedFaceIndex = selectedFace
    ? model.instances.findIndex(instance => instance.partId === selectedFace.partId && instance.copyId === selectedFace.copyId)
    : -1;
  const status =
    sectionProblem ??
    (section.active && section.reason ? `Section view: ${section.reason}` : null) ??
    (section.picking ? 'Pick a planar model face, or choose a section plane.' : null) ??
    (notice
      ? notice
      : measure.expanded
        ? 'Select vertices, straight edges or flat faces to measure. Click a selected item again to remove it.'
        : onPickPoint
          ? 'Click an edge, a corner or the middle of a face.'
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
                      : 'Draw a part to start.');
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
            <button
              key={option.view}
              type="button"
              aria-pressed={view === option.view}
              disabled={section.active && option.view !== 'assembled'}
              onClick={() => explosion.chooseView(option.view)}>
              {option.label}
            </button>
          ))}
        </div>
        {view === 'exploded' && <ExplosionSlider progress={explosion.progress} onChange={explosion.scrub} />}
        {controlled && (
          <select aria-label="Display" value={display} onChange={event => setDisplay(event.target.value as ModelDisplay)}>
            {kDisplays.map(option => (
              <option key={option.display} value={option.display}>
                {option.label}
              </option>
            ))}
          </select>
        )}
        <StudioSectionControls section={section} enabled={sectionEnabled} />
        <button
          type="button"
          aria-label="Measure"
          aria-keyshortcuts="["
          aria-pressed={measure.expanded}
          disabled={
            !measurementEnabled || choosing || pickingMirrorPlane || section.editing || !model.meshes.some(mesh => mesh.indices.length > 0)
          }
          onClick={() => {
            // Inspection uses assembled coordinates immediately; an old playback frame must not move them again.
            explosion.scrub(0);
            setView('assembled');
            measure.open();
          }}>
          Measure <kbd>[</kbd>
        </button>
        {onNewPart && !controlled && (
          <button
            type="button"
            aria-pressed={choosing}
            onClick={() => {
              setChoosing(!choosing);
              setNotice(null);
              frame.current?.focus({ preventScroll: true });
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
        cameraState={cameraState}
        extrusionDepth={extrusionDepth}
        pickingConnector={!!onPickPoint}
        connectors={Object.entries(connectors ?? {}).map(([end, pick]) => ({
          ...pick,
          label: end === 'from' ? 'Source mate connector' : 'Destination mate connector',
        }))}
        meshes={model.meshes}
        sourceMeshes={assembly.meshes}
        sectionCaps={model.sectionCaps}
        sectionControl={sectionProblem ? null : section.control}
        parts={model.parts}
        view={explosion.modelView}
        explosionProgress={explosion.progress}
        viewRequest={viewRequest}
        onViewRequest={onViewRequest}
        transparentIds={transparentIds}
        instanceIds={model.instances.map(instanceKey)}
        selectedId={selectedId}
        selectedIndexes={selectedFace ? [] : selectedIndexes}
        selectedFace={
          selectedFrame && !('error' in selectedFrame) && selectedFaceIndex >= 0
            ? {
                partId: selectedFace!.partId,
                index: selectedFaceIndex,
                point: selectedFrame.origin,
                normal: selectedFrame.normal,
              }
            : null
        }
        // The studio shows parts as the reference does, and says in its status line when two overlap rather than colouring them.
        warnIds={controlled ? undefined : clashes.flatMap(clash => clash.partIds)}
        palette={controlled ? 'studio' : undefined}
        highlightIds={hoverIds ? [...hoverIds] : undefined}
        milled={always}
        onPickFace={pickingMirrorPlane ? pickMirrorFace : section.picking ? section.pickFace : choosing ? pickFace : undefined}
        onMeasurePick={
          measureEnabled
            ? pick => {
                if (pick.additive || measure.expanded) lastClick.current = null;
                measure.pick(pick);
              }
            : undefined
        }
        measuring={measure.expanded}
        measureSelection={measure.selection.map(item => item.entity)}
        measureWitness={measure.witness}
        onMissed={measure.clear}
        onHover={(id, index) => onHover?.(id !== null && index !== undefined ? instanceKey(model.instances[index]!) : id)}
        planes={onNewPart && showPlanes ? planes : undefined}
        sketchLines={sketchLines}
        onPickSketch={
          !section.editing && !measure.expanded && onPickSketch
            ? id => {
                measure.clear();
                lastClick.current = null;
                onPickSketch(id);
              }
            : undefined
        }
        display={controlled ? display : 'shaded'}
        showOrigin={!!onNewPart && showPlanes && (featureShown?.('origin') ?? true)}
        regions={[...(regions ?? []), ...(measure.expanded || section.editing ? [] : sketchRegions)]}
        onPickRegion={id => {
          if (sketchRegions.some(region => region.id === id)) {
            measure.clear();
            lastClick.current = null;
            const [part, region] = JSON.parse(id) as [string, string];
            onPickSketch?.(part, region);
          } else onPickRegion?.(id);
        }}
        onPickPlane={id => {
          if (section.pickPlane(id)) return;
          measure.clear();
          if (measure.expanded) return;
          // Picked while choosing, the new part is drawn on it; otherwise it's picked for the next sketch, as a face is.
          const plane = pickedPlane(document, id);
          if (choosing && plane) {
            setChoosing(false);
            setNotice(null);
            onNewPart?.(plane.on, plane.datum);
          } else onSelectPlane?.(id);
        }}
        onSelect={(_, index, pick) => {
          const instance = model.instances[index]!,
            partId = instance.partId;
          if (onPickPoint) {
            if (pick?.sectionCap) return setNotice('Pick a model corner or edge; the section surface is temporary.');
            if (!pick) return setNotice('Click a face of a part: its corners and middle snap.');
            setNotice(null);
            return onPickPoint({
              partId,
              point: pick.point as [number, number, number],
              normal: pick.normal as [number, number, number],
              copy: !!model.instances[index]!.copyId,
              ...(pick.edge && { edge: pick.edge }),
            });
          }
          // The face clicked is picked too, for a sketch started next to be drawn on it.
          const found = pick && faceAt(pick);
          onSelectFace?.(found ? { partId: found.part.id, face: found.face, ...(found.copyId && { copyId: found.copyId }) } : null);
          const faceKey = JSON.stringify(found?.face ?? null);
          const now = Date.now();
          const key = instanceKey(instance);
          // Changing faces quickly is another selection, not a request to edit the body's base sketch.
          if (
            lastClick.current?.topology === inspectionTopology &&
            lastClick.current.partId === key &&
            lastClick.current.face === faceKey &&
            now - lastClick.current.at < kDoubleClickMs
          ) {
            lastClick.current = null;
            return onOpen(partId, instance.copyId);
          }
          lastClick.current = { partId: key, face: faceKey, at: now, topology: inspectionTopology };
          onSelect(partId, instance.copyId);
          frame.current?.focus({ preventScroll: true });
        }}
      />
      <p role="status">{status}</p>
      {/* The hidden inspector keeps explicit unit conversions until this workspace session ends. */}
      <StudioMeasurePanel
        defaultLengthUnit={document.lengthUnit ?? 'mm'}
        selection={measure.selection}
        result={measure.result}
        expanded={measure.expanded}
        selectedRowId={measure.selectedRowId}
        onExpand={measure.open}
        onClose={measure.close}
        onClear={measure.clear}
        onRemove={measure.remove}
        onSelectRow={measure.selectRow}
      />
      <StudioSectionInspector section={section} problem={sectionProblem} />
      {children}
    </div>
  );
}
