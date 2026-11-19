import { initialView, numeric, type ConstraintTool, type NumericConstraint, type Point, type Tool, type View } from './cadEditorShared';
import type { SketchEditorInput } from './sketchEditorInput';
import { sketchPointerDown } from './sketchPointerDown';
import { cadEditorKeyDown } from './cadEditorKeyDown';
import { sketchPointerMove, sketchPointerEnd } from './sketchPointerMove';
import { chooseSketchTool, addSketchShape } from './sketchToolActions';
import { sketchPointAt, sketchContextTarget, solveSketchDrag, startSketchAnnotationDrag } from './sketchCanvasPicking';
import {
  placeSketchDimension,
  applySketchDimensionValue,
  applySketchDimensionEvent,
  beginSketchDimension,
  editSketchDimension,
  finishSketchSpline,
} from './sketchDimensionActions';
import {
  acceptSketchLinearPattern,
  acceptSketchCircularPattern,
  acceptSketchFillet,
  acceptSketchChamfer,
  acceptSketchCornerPreview,
  acceptSketchOffset,
  applySketchConicRho,
  removeSketchSelection,
  constrainSketch,
  sketchContextAction,
} from './sketchModifyActions';
import { cadFieldText, DesignUnitContext, useDesignUnits } from './designUnits';
import { useSketchCommandPreviews } from './useSketchCommandPreviews';
import { SketchCommandControls } from './SketchCommandControls';
import { initialCircularPatternParameters, circularPatternParameters } from './circularPatternParameters';
import {
  withCadLengthUnit,
  addConstraint,
  createCadPart,
  dimensionValueError,
  entityPointIds as curvePointIds,
  updateDimension,
  visibleSketchPointIds,
  withDimensionPlacement,
  type CadDimension,
  type CadDocument,
  type CadDrawnOn,
  type CadSketch,
  type CadSketchSolveStatus,
  cadCopyName,
  type CadPoint,
  cadVariableProblems,
  drawnOnOutline,
  cadSketchFrame,
  resolveExtrudeSteps,
} from '@wbcnc/cad';
import {
  useEffect,
  useLayoutEffect,
  useImperativeHandle,
  useMemo,
  useCallback,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent,
} from 'react';
import { solveCadDocument } from './solveCad';
import { acquireCadKeyboard } from '@wbcnc/cad-editor/keyboardOwnership';
import {
  acceptCadSession,
  cadSession,
  commitCadSession,
  endCadSession,
  markCadSession,
  redoCadSession,
  restoreCadSession,
  undoCadSession,
  type CadCommandCheckpoint,
  type CadHistoryMark,
} from '@wbcnc/cad-editor/session';
import {
  idleDimensionWorkflow,
  transitionDimensionWorkflow,
  type DimensionWorkflow,
  type DimensionWorkflowEvent,
} from '@wbcnc/cad-editor/dimensionWorkflow';
import { idleDrawingGesture, type DrawingGesture } from '@wbcnc/cad-editor/drawingGesture';
import { advanceCreationValue, creationValueAnchor, creationValueAt, type CreationValues } from './creationValues';
import { CreationValueControls } from './CreationValueControls';
import { SketchConicRhoForm, SketchDimensionEditor, SketchPolygonForm, SketchShapeSizeForm } from './SketchValueForms';
import {
  initialLinearPatternParameters,
  linearPatternParameters,
  editablePatternSources,
  type LinearPatternParameters,
} from './linearPatternParameters';
import { initialTransformParameters } from './transformParameters';
import { SelectionReadout } from './SelectionReadout';
import { SketchPartProperties } from './SketchPartProperties';
import { SketchDrawing } from './SketchDrawing';
import { CadVariablesPanel } from './CadVariablesPanel';
import { pendingRow, sketchPlaneName } from './drawnOnName';
import { SketchContextMenu } from './SketchContextMenu';
import {
  createSketchContext,
  selectedSketchContextTarget,
  toggleContextConstruction,
  type SketchContext,
  type SketchContextAction,
  type SketchContextPress,
  type SketchContextTarget,
} from '@wbcnc/cad-editor/sketchContext';
import { dimensionAnchor } from '@wbcnc/cad-editor/dimensionGeometry';
import { type CadSnapResult } from '@wbcnc/cad-editor/picking';
import { type CadDrawingInference } from '@wbcnc/cad-editor/drawingInference';
import { addDrawingRelations } from '@wbcnc/cad-editor/drawingCommit';
import { type InferredLineAxis } from './lineInference';
import { cadViewState, saveCadViewState } from '@wbcnc/cad-editor/viewState';
import { loadShownState, saveShownState } from './shownState';
import { type CadSelectionBox } from './boxSelection';
import { type AnnotationGesture, type BoxGesture, type ChainAnchor, type DragGesture, type HandleDrag } from './editorGestures';
import { constraintColorNotice, isEmptyDesign, isEmptySketch, sketchDofStatus, sketchFeedback } from '@wbcnc/cad-editor/sketchFeedback';
import { failedCheckProblems, noSketchProblems } from './sketchProblemLists';
import { isDemoMode } from '@/lib/demo/demo-mode';
import { CommandSearch, type SearchCommand } from './CommandSearch';
import { SketchToolbar } from './SketchToolbar';
import { withRegionDepth, type CutRegion } from './cutRegions';
import { RegionDepthField } from './RegionDepthField';
import { sketchTools as tools, type SketchTool } from './sketchTools';
import { ModificationControls } from './ModificationControls';
import { idleModificationWorkflow, transitionModification, type ModificationWorkflow } from '@wbcnc/cad-editor/modificationWorkflow';
import { useSvgPixelScale, sketchStrokeColor } from './sketchAppearance';
import { associatedEntityIds } from '@wbcnc/cad-editor/inlineConstraintLayout';
import { StudioToolbar, type StudioCommand } from './StudioToolbar';
import {
  closeStudioFeature,
  closeStudioSketch,
  newStudioPartOn,
  newStudioSketchOn,
  openStudioFeature,
  openStudioSketch,
  pickStudioPlane,
  runStudioCommand,
  studioFeatureAction,
  type StudioNavigationInput,
} from './studioNavigation';
import { StudioCommandSearch } from './StudioCommandSearch';
import type { PatternOpening } from './partPatternKind';
import { featureRowParts, picksFeatureRows, selectStudioFeature } from './studioFeatureSelection';
import { startExtrude } from './studioExtrude';
import { builtStudioParts, disabledStudioCommands, isBlankDesign, listedStudioParts, studioListSource } from './studioParts';
import { applyFramed } from './insertFraming';
import { usePartCutSelection } from './usePartCutSelection';
import { usePartIsolation } from './usePartIsolation';
import { StudioSketchDialog } from './StudioSketchDialog';
import { openSketchFinishReason, sketchPendingFinishReason } from './sketchPendingFinishReason';
import { PartsList } from './PartsList';
import { renamedStudioPart } from './renamedStudioPart';
import { partTrouble } from './partTrouble';
import { toggledKey } from './toggledKey';
import { usePointPicker } from './pointPicker';
import { ShortcutList } from './ShortcutList';
import { sketchShortcutTabs, studioShortcuts } from './shortcuts';
import { sketchSearchCommands } from './sketchSearchCommands';
import { toggleFixed } from './sketchFix';
import { hasOutline, isSingleLine, replacePart } from './editorHelpers';
import { useFeaturePreview } from './useFeaturePreview';
import { SketchProblems } from './SketchProblems';
import type { FeatureAction, FeatureEntry } from './FeatureList';
import { StudioFeatureList } from './StudioFeatureList';
import { detachStudioCopy } from './detachStudioCopy';
import { StudioProposals } from './StudioProposals';
import { useAssistantProposal } from './assistant/useAssistantProposal';
import type { CadEditorProps } from './CadEditor.types';
export type { CadEditorController, CadEditorProps } from './CadEditor.types';
import { useProfileSelection } from './useProfileSelection';
import { studioKeyActions } from './studioKeyActions';
import type { ViewRequest } from '@/cam/model/ModelViewport';
import { designStepLabel, trimCadFolders } from '@wbcnc/cad';
import type { PartEdge } from './partEdges';
import { straightOn, type SketchTurn } from './sketchOrbit';
import { useEditorCameras } from './studioCamera';
import { sketchBackdropView } from './sketchBackdropView';
import { initialFaceSketchView } from './faceSketchScene';
import { useFaceSketchCamera } from './useFaceSketchCamera';
import { fitSketchView } from './fitSketchView';
import { sketchValuePosition, projectSketchPoint, focusSketchCanvas, creationEditorPositions } from './sketchViewport';
import { addUsedPartEdges } from './partEdgeUse';
import { faceSketchHost } from './faceSketchHost';
import { useExtrudeDepth } from './useExtrudeDepth';
import { bindPartCorners } from './partCornerInference';
import type { CadConnectorPick } from './PartFeatureDialogs';
import { StudioDialogHost } from './StudioDialogHost';
import { dialogCommand, featureDialog, picksParts, previewOwner, sameDialogShown, type StudioDialog } from './studioDialog';
import { usePatternVariableCommit } from './studioPatternVariableSource';
import { useStudioPreview } from './useStudioPreview';
import { useEditorDocumentKeys } from './useEditorDocumentKeys';
import { editedStep, useEditorVariableFields } from './useEditorVariableFields';
import { useFeatureShown, withMadeSketchHidden } from './useFeatureShown';
import { CadCanvasBar, CadPartPane, CadSketchBackdropPane, CadWorkspacePane } from './CadDrawingPanes';
import './cad.css';

/** Native editable source stays in one document while CAM remains a derived consumer of accepted revisions. */
export function CadEditor({
  document: initialDocument,
  editSession,
  onDraftChange,
  onFinish,
  onCancel,
  onFinishBlocked,
  saveStatus,
  notice,
  preferredPartId,
  controller,
  onEditFaceSketch,
  partCameraState: suppliedPartCamera,
  studioCameraState: suppliedStudioCamera,
  faceSketch,
  startIn3D,
  selectedStepId,
}: CadEditorProps) {
  const [session] = useState(() => editSession ?? cadSession(initialDocument));
  const [doc, setDocument] = useState(session.document);
  const assistantProposalState = useAssistantProposal(doc);
  const { parseCadValue, lengthText, formatLength, lengthUnit } = useDesignUnits(doc.lengthUnit ?? 'mm');
  const [faceOpening] = useState(() => initialFaceSketchView(faceSketch?.scene));
  const [savedView] = useState(() => cadViewState(session.document, initialView, preferredPartId));
  const [partId, setPartId] = useState(savedView.selectedPartId);
  const part = doc.parts.find(p => p.id === partId) ?? doc.parts[0];
  const sketch = part?.sketch;
  const [tool, setTool] = useState<Tool>('select');
  const polygonTool = tool === 'inscribedPolygon' || tool === 'circumscribedPolygon';
  const [construction, setConstruction] = useState(false);
  const [selected, setSelected] = useState<string[]>(savedView.selectedEntityIds);
  const selectionHints = useRef<Record<string, Point>>({});
  const [selectedConstraints, setSelectedConstraints] = useState<string[]>([]);
  const [showConstraints, setShowConstraints] = useState(true);
  const [hoveredConstraintEntities, setHoveredConstraintEntities] = useState<string[]>([]);
  const [conflictedConstraints, setConflictedConstraints] = useState<string[]>([]);
  const [pending, setPending] = useState<Point[]>([]);
  const [polygonSides, setPolygonSides] = useState('6');
  const polygonInput = useRef<HTMLInputElement>(null);
  const polygonCountGesture = useRef<{ sides: number; radius: number } | null>(null);
  useLayoutEffect(() => {
    if (polygonTool && pending.length === 2) {
      polygonInput.current?.focus();
      polygonInput.current?.select();
    }
  }, [polygonTool, pending.length]);
  // A completed line leaves a continuation anchor, not an uncommitted new segment.
  const [lineContinuation, setLineContinuation] = useState(false);
  const [chain, setChain] = useState<ChainAnchor | null>(null);
  const [contextualArc, setContextualArc] = useState(false);
  const [constraintMode, setConstraintMode] = useState<ConstraintTool | null>(null);
  /** Fix chosen with nothing selected: each click fixes or unfixes what it hits until Escape. */
  const [fixMode, setFixMode] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [hoveredPoint, setHoveredPoint] = useState<string | null>(null);
  const [snapCue, setSnapCue] = useState<{ point: Point; label: string } | null>(null);
  const lastSnap = useRef<CadSnapResult | null>(null);
  const centerArcSweep = useRef<{ last: number; sweep: number } | null>(null);
  const pendingSnaps = useRef<(CadDrawingInference | null)[]>([]);
  const lastDrawingHint = useRef<CadDrawingInference | null>(null);
  const [drawingCue, setDrawingCue] = useState<CadDrawingInference | null>(null);
  const hoveredReferences = useRef<string[]>([]);
  const inference = useRef<'horizontal' | 'vertical' | 'tangent' | null>(null);
  const tangentAxis = useRef<InferredLineAxis | null>(null);
  const [cursor, setCursor] = useState<Point>({ x: 0, y: 0 });
  const [snap, setSnap] = useState(true);
  const [view, setView] = useState(faceOpening?.view ?? savedView.view);
  const [dimension, setDimension] = useState<string | null>(null);
  const [dimensionFlow, setDimensionFlow] = useState<DimensionWorkflow>(idleDimensionWorkflow);
  const drawingGesture = useRef<DrawingGesture>(idleDrawingGesture());
  const [creationValues, setCreationValues] = useState<CreationValues | null>(null);
  const dimensionMode = dimensionFlow.mode;
  const placingDimension = dimensionFlow.phase === 'placing';
  const dimensionDraft = dimensionFlow.phase === 'placing' ? dimensionFlow.preview : null;
  const dimensionSelection = dimensionFlow.phase === 'idle' ? selected : dimensionFlow.entityIds;
  const [palette, setPalette] = useState(false);
  const [searchMode, setSearchMode] = useState(true);
  const toggleCommandSearch = () => {
    setSearchMode(true);
    setPalette(value => !value);
  };
  const [searchHighlight, setSearchHighlight] = useState<SearchCommand['id'] | null>(null);
  const [status, setStatus] = useState('Checking sketch…');
  const [{ problems, sketchProblems, featureProblems, unbuiltParts }, setProblems] = useState(noSketchProblems);
  const [inProgress, setInProgress] = useState(false);
  const [solving, setSolving] = useState(true);
  const [checkEpoch, setCheckEpoch] = useState(0);
  const [sketchStatuses, setSketchStatuses] = useState<Record<string, CadSketchSolveStatus>>({});
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('Choose a drawing tool or select geometry.');
  const [finishError, setFinishError] = useState<string | null>(null);
  const [width, setWidth] = useState(lengthText(100));
  const [height, setHeight] = useState(lengthText(60));
  const [radius, setRadius] = useState(lengthText(10));
  const [slotWidth, setSlotWidth] = useState(lengthText(10));
  const [slotChain, setSlotChain] = useState(false);
  const [sharedSlotWidth, setSharedSlotWidth] = useState<string | undefined>();
  const slotWidthField = useRef<HTMLInputElement>(null);
  const handleDrag = useRef<HandleDrag | null>(null);
  const startHandleDrag = (event: { pointerId: number }, gesture: HandleDrag) => {
    handleDrag.current = gesture;
    svg.current?.setPointerCapture(event.pointerId);
  };
  const [circularParameters, setCircularParameters] = useState(initialCircularPatternParameters);
  const circularFields = useRef<Partial<Record<'count' | 'angle', HTMLInputElement>>>({});
  const [linearParameters, setLinearParameters] = useState(() => initialLinearPatternParameters(lengthUnit));
  const [patternEditId, setPatternEditId] = useState<string | null>(null);
  const [patternNotice, setPatternNotice] = useState('');
  const patternCommandId = useRef('');
  const patternFields = useRef<Partial<Record<Exclude<keyof LinearPatternParameters, 'secondDirection'>, HTMLInputElement>>>({});
  const [transformParameters, setTransformParameters] = useState(() => initialTransformParameters(undefined, lengthUnit));
  const [transformNotice, setTransformNotice] = useState('');
  const [splitNotice, setSplitNotice] = useState('');
  const [splitFirst, setSplitFirst] = useState<{ entityId: string; parameter: number; point: CadPoint } | null>(null);
  const [chamferDistances, setChamferDistances] = useState([lengthText(10), lengthText(10)]);
  const [filletRadius, setFilletRadius] = useState(lengthText(10));
  const [filletEditing, setFilletEditing] = useState(false);
  const [modification, setModification] = useState<ModificationWorkflow>(idleModificationWorkflow);
  const [hoveredModifyCurve, setHoveredModifyCurve] = useState<string | null>(null);
  const [modifyTarget, setModifyTarget] = useState<Point | null>(null);
  const [conicEditing, setConicEditing] = useState<string | null>(null);
  const [rho, setRho] = useState('0.5');
  const [selectionBox, setSelectionBox] = useState<CadSelectionBox | null>(null);
  const [regionField, setRegionField] = useState<{ entry: CutRegion; anchor: Point } | null>(null);
  const [show3D, setShow3D] = useState(startIn3D === 'part');
  // Opening a design shows every part where it sits, once there's a part to show.
  // A new design opens there too, picking the plane its first part is sketched on, as the reference starts.
  const startsBlank = startIn3D === true && !faceSketch && isBlankDesign(doc);
  const [showWorkspace, setShowWorkspace] = useState(
    () => startIn3D === true && (startsBlank || doc.parts.some(candidate => hasOutline(doc, candidate.id)))
  );
  const sketchOnly = !!faceSketch;
  // Opened as a Part Studio: the studio is home, a sketch is opened from it and closed back to it, and steps are set
  // in dialogs over the view.
  const studioSession = startIn3D !== undefined && !faceSketch;
  const [viewRequest, setViewRequest] = useState<ViewRequest>();
  // The one step dialog open over the view.
  const [dialog, setDialog] = useState<StudioDialog | null>(null);
  // A part's step open in its dialog, with the design as it was when it opened, to go back to on cancel.
  const feature = featureDialog(dialog);
  const cutSelection = usePartCutSelection(doc, part, setPartId);
  // Picking the plane or face a new part is sketched on.
  // A new design opens with nothing picked or asked for: the first sketch starts from the toolbar, as in the reference.
  const [choosingFace, setChoosingFace] = useState(false);
  // A base plane picked in the studio, in its view or feature list, for the next sketch to be drawn on.
  // A base plane, or one of the design's planes, by its id.
  const [selectedPlane, setSelectedPlane] = useState<string | null>(null);
  // A dialog waiting for a plane or face to be picked for a direction, as the Transform dialog's Direction box.
  const [directionPicker, setDirectionPicker] = useState<((on: CadDrawnOn['on'], datum?: string) => void) | null>(null);
  /**
   * Opens a step's dialog in place of any other. The one it replaces is dropped, not cancelled: what an Extrude or Hole
   * dialog committed stays, as the step opened next may be made from it. The same one opened again keeps its pick.
   */
  const openDialog = (next: StudioDialog) => {
    if (!sameDialogShown(dialog, next)) setDirectionPicker(null);
    setChoosingFace(false);
    setDialog(next);
  };
  const closeDialog = () => {
    setDirectionPicker(null);
    setDialog(null);
  };
  const pointPicker = usePointPicker();
  // Where the rollback bar was moved to in the feature list: the step it sits after. Null is the end.
  const [rolledTo, setRolledTo] = useState<string | null>(null);
  // The part whose row is hovered in the feature list, highlighted in the view as the reference does.
  const [hoveredStepParts, setHoveredStepParts] = useState<string[] | null>(null);
  // The face of the part last clicked in the studio, which the next sketch is drawn on, as with a picked plane.
  const [selectedFace, setSelectedFace] = useState<Extract<CadDrawnOn['on'], { partId: string }> | null>(null);
  // A picked face goes with its part.
  useEffect(() => {
    if (selectedFace && !doc.parts.some(candidate => candidate.id === selectedFace.partId)) setSelectedFace(null);
  }, [doc.parts, selectedFace]);
  // Where the drawing sits in its pane, for the parts shown behind a sketch to line up with it.
  const [canvasBox, setCanvasBox] = useState<{ left: number; top: number; width: number; height: number } | null>(null);
  // How far the open sketch's view is turned off straight at its plane, by right-dragging; `n` turns it back.
  const [sketchTurn, setSketchTurn] = useState<SketchTurn>(faceOpening?.turn ?? straightOn);
  const { studioCamera, partCameraState } = useEditorCameras(suppliedStudioCamera, suppliedPartCamera);
  const [sketchCameraShift, setSketchCameraShift] = useState<[number, number]>(faceOpening?.shift ?? [0, 0]);
  // The edges of the parts behind a studio sketch, laid on its plane, and those picked to use in it with `u`.
  const [partEdges, setPartEdges] = useState<PartEdge[]>([]);
  const [pickedEdges, setPickedEdges] = useState<string[]>([]);
  const [useNotice, setUseNotice] = useState<string | null>(null);
  // Use, started with `u` and nothing picked: each part edge clicked goes into the sketch, until Escape or another tool.
  const [usingEdges, setUsingEdges] = useState(false);
  useEffect(() => setUsingEdges(false), [part?.id, showWorkspace]);
  // A Use refusal belongs only to the current sketch and command.
  useEffect(() => setUseNotice(null), [part?.id, showWorkspace, tool, usingEdges]);
  const [transparentParts, setTransparentParts] = useState<ReadonlySet<string>>(() => new Set());
  // Parts hidden from the studio's view by their eye in the parts list.
  // Both are kept for the design in this browser, so a reload shows it as it was left.
  const [savedShown] = useState(() => loadShownState(session.document.id));
  const [hiddenParts, setHiddenParts] = useState<ReadonlySet<string>>(() => new Set(savedShown.hiddenParts));
  // Sketches, planes and the origin shown or hidden with their eyes in the feature list, where that differs from how
  // they start: a sketch shows until Extrude makes a part of it, and the rest show.
  // The sketch whose row in the feature list was clicked last, while nothing else has been picked since.
  const [sketchRowPicked, setSketchRowPicked] = useState<string | null>(null);
  const [featureVisibility, setFeatureVisibility] = useState<Readonly<Record<string, boolean>>>(savedShown.featureVisibility);
  useEffect(() => saveShownState(doc.id, { hiddenParts: [...hiddenParts], featureVisibility }), [doc.id, hiddenParts, featureVisibility]);
  const hoveredPart = useRef<string | null>(null);
  const onHoverPart = useCallback((id: string | null) => {
    hoveredPart.current = id;
  }, []);
  useEffect(() => {
    hoveredPart.current = null;
  }, [hiddenParts, showWorkspace]);
  // Why something asked for in the studio wasn't done, such as deleting a variable that's in use.
  const [studioRefusal, setStudioRefusal] = useState<string | null>(null);
  // When a step's dialog closes, the view has the keyboard again, so its shortcuts work straight away.
  const stepDialogOpen = !!dialog;
  const partPicking = picksParts(dialog);
  const dialogWasOpen = useRef(false);
  // A view still solving is inert: it takes the keyboard once it's done, unless something else has it by then.
  const viewWantsKeyboard = useRef(false);
  const focusViewIfIdle = useCallback(() => {
    const active = root.current?.ownerDocument.activeElement;
    if (!viewWantsKeyboard.current || (active && active !== root.current?.ownerDocument.body && active.isConnected)) {
      viewWantsKeyboard.current = false;
      return;
    }
    const view = root.current?.querySelector<HTMLElement>('[data-testid="workspace-3d"]');
    if (!view || view.closest('[inert]')) return;
    view.focus();
    viewWantsKeyboard.current = view.ownerDocument.activeElement !== view;
  }, []);
  useLayoutEffect(() => {
    const closed = dialogWasOpen.current && !stepDialogOpen;
    dialogWasOpen.current = stepDialogOpen;
    if (!closed || !studioSession || !showWorkspace) return;
    viewWantsKeyboard.current = true;
    // The dialog has left the DOM. A background page may not receive another animation frame.
    focusViewIfIdle();
  }, [stepDialogOpen, studioSession, showWorkspace, focusViewIfIdle]);
  // The design as it was when the open sketch was opened from the studio, to go back to if it's cancelled.
  // A sketch open from the start, such as a new design's first, goes back to the design as it opened.
  // A mark rather than a document: Cancel puts undo history back too, so the cancelled sketch isn't left for Undo.
  const sketchBefore = useRef(useState(() => (studioSession && !showWorkspace ? markCadSession(session) : null))[0]);
  const [cancelledSketch, setCancelledSketch] = useState<{ document: CadDocument; partId: string; before: CadHistoryMark } | null>(null);
  useEffect(() => {
    if (!cancelledSketch) return;
    const timer = setTimeout(() => setCancelledSketch(null), 12_000);
    return () => clearTimeout(timer);
  }, [cancelledSketch]);
  useEffect(() => {
    // Accepting the design, or anything else that makes the editor busy, saves what's there: a restore can't race it.
    if (busy || !showWorkspace || choosingFace || dialog) setCancelledSketch(null);
  }, [busy, showWorkspace, choosingFace, dialog]);
  useEffect(() => {
    const element = svg.current;
    if (!element) return;
    const measure = () =>
      setCanvasBox(previous => {
        // A turned drawing's box isn't its size, but it turns about its middle.
        const box = element.getBoundingClientRect(),
          pane = (element.parentElement as HTMLElement).getBoundingClientRect(),
          width = element.clientWidth,
          height = element.clientHeight;
        const next = {
          left: box.left + box.width / 2 - width / 2 - pane.left,
          top: box.top + box.height / 2 - height / 2 - pane.top,
          width,
          height,
        };
        return previous && JSON.stringify(previous) === JSON.stringify(next) ? previous : next;
      });
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [showWorkspace, show3D]);
  // A sketch opened from the studio takes the keyboard once its drawing shows, so its shortcuts work straight away.
  useEffect(() => {
    if (studioSession && !showWorkspace && !show3D) focusSketchCanvas(svg.current);
    // Only when the studio gives way to the drawing.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showWorkspace]);
  // Its region belongs to one part at one revision: applying it after either changed would write a stale cut.
  useEffect(() => setRegionField(null), [part?.id, doc.revision]);
  // Picking a drawing tool, by button or key, means going back to the drawing.
  useEffect(() => {
    if (tool !== 'select') {
      setShow3D(false);
      setShowWorkspace(false);
    }
  }, [tool]);
  const partHasOutline = !!part && hasOutline(doc, part.id);
  const [contextMenu, setContextMenu] = useState<SketchContext | null>(null);
  const contextPress = useRef<SketchContextPress>({ phase: 'idle' });
  const [thicknessValid, setThicknessValid] = useState(true);
  const svg = useRef<SVGSVGElement>(null);
  // The drawing inside the canvas, which a turned sketch turns: points on screen map through it.
  const drawingGroup = useRef<SVGGElement>(null);
  const markerScale = useSvgPixelScale(svg, view);
  const root = useRef<HTMLDivElement>(null);
  const dimensionInput = useRef<HTMLInputElement>(null);
  const filletInput = useRef<HTMLInputElement>(null);
  const offsetInput = useRef<HTMLInputElement>(null);
  const rhoInput = useRef<HTMLInputElement>(null);
  const creationInput = useRef<HTMLInputElement>(null);
  const newCurveCommand = useRef<{ id: string; checkpoint: CadCommandCheckpoint } | null>(null);
  const newDimensionCommand = useRef<{ id: string; checkpoint: CadCommandCheckpoint } | null>(null);
  const drag = useRef<DragGesture | null>(null);
  const annotationDrag = useRef<AnnotationGesture | null>(null);
  const boxGesture = useRef<BoxGesture | null>(null);
  // A right or middle drag: it pans, or over the parts behind a studio sketch, a right drag turns the view.
  const pan = useRef<{ x: number; y: number; view: View; turn?: SketchTurn } | null>(null);
  const solveSequence = useRef(0);
  const lastCheckedRevision = useRef('');
  const documentRef = useRef(doc);
  const { commit: variableCommit, normalized: normalizePatternVariableSource } = usePatternVariableCommit(dialog, documentRef, next =>
    commit(next)
  );
  const variableScope = useEditorVariableFields(doc, documentRef, variableCommit, editedStep(dialog, !showWorkspace && part?.id));
  const blankDesign = studioSession && isBlankDesign(doc);
  const extrusionDepth = useExtrudeDepth(doc, dialog?.kind === 'extrude' ? dialog.partId : undefined, next => commit(next));
  const studioPreview = useStudioPreview(doc, previewOwner(dialog));
  const [mateConnectors, setMateConnectors] = useState<{ from?: CadConnectorPick; to?: CadConnectorPick }>({});
  const { rollbackStep, userRollback, rolledBack, shownDocument, pastRollback, solveFeedback, apartIds } = useFeaturePreview({
    document:
      pointPicker.onPick && dialog?.kind === 'transform'
        ? doc
        : studioPreview.document === doc
          ? extrusionDepth.document
          : studioPreview.document,
    enabled: studioSession && showWorkspace,
    blank: blankDesign,
    rolledTo,
    dialog,
    sketching: studioSession && !showWorkspace && part ? `${part.id}:sketch` : null,
    checks: { lastCheckedRevision, setCheckEpoch },
  });
  documentRef.current = doc;
  const callbacks = useRef({ onDraftChange, onFinish, onCancel, onFinishBlocked });
  const finishing = useRef(false);
  const preparingDimension = useRef(false);
  const mounted = useRef(true);
  callbacks.current = { onDraftChange, onFinish, onCancel, onFinishBlocked };
  const deferredCanvasFocus = useRef<(() => void) | null>(null);
  // The field of a step's dialog last typed in: solving makes the view inert, which drops the keyboard, and it goes back.
  const dialogFocus = useRef<HTMLElement | null>(null);
  useLayoutEffect(() => {
    if (!busy) {
      const restore = deferredCanvasFocus.current;
      deferredCanvasFocus.current = null;
      restore?.();
      const field = dialogFocus.current;
      const active = field?.ownerDocument.activeElement;
      if (field?.isConnected && (!active || active === field.ownerDocument.body)) field.focus();
      else focusViewIfIdle();
    }
  }, [busy, focusViewIfIdle]);
  const restoreCanvasKeyboard = () => {
    const restore = () => {
      const canvas = svg.current,
        active = canvas?.ownerDocument.activeElement;
      // Solves finish before React removes workspace inertness. Focus only after
      // that DOM commit, even when background animation frames are suspended.
      if (canvas?.closest('[inert]')) {
        deferredCanvasFocus.current = restore;
        return;
      }
      deferredCanvasFocus.current = null;
      if (canvas && (!active || active === canvas.ownerDocument.body || canvas.contains(active))) canvas.focus();
    };
    // Keyboard ownership must not wait for a frame in a background tab. Recheck
    // after rendering as well, when a dismissed control may have lost focus.
    restore();
    requestAnimationFrame(restore);
  };
  const requestSketchCheck = () => {
    const current = documentRef.current;
    if (lastCheckedRevision.current !== `${current.id}:${current.revision}`) setCheckEpoch(epoch => epoch + 1);
  };
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const {
    filletSelection,
    filletPreview,
    chamferSelection,
    chamferPreview,
    cornerPreview,
    parsedTransform,
    transformPreview,
    parsedCircular,
    parsedLinear,
    linearPreview,
    patternAnchor,
    slotPreview,
    slotWidthCircle,
    slotWidthCenter,
    shownSketch,
    annotationSketch,
    offsetPreview,
    extendPreview,
    mirrorPreview,
    modificationPreview,
    curvePreview,
  } = useSketchCommandPreviews({
    sketch,
    tool,
    selected,
    construction,
    lengthUnit,
    variableScope,
    parseCadValue,
    markerScale,
    filletRadius,
    chamferDistances,
    transformParameters,
    circularParameters,
    linearParameters,
    patternEditId,
    patternCommandId,
    slotWidth,
    slotChain,
    sharedSlotWidth,
    modification,
    modifyTarget,
    hoveredModifyCurve,
    pending,
    cursor,
    rho,
  });
  useEffect(() => {
    focusSketchCanvas(svg.current);
    const release = acquireCadKeyboard();
    return () => {
      drag.current = null;
      annotationDrag.current = null;
      boxGesture.current = null;
      drawingGesture.current = idleDrawingGesture();
      contextPress.current = { phase: 'idle' };
      release();
    };
  }, []);
  useEditorDocumentKeys(root);
  useEffect(() => {
    const canvas = svg.current;
    if (!canvas) return;
    const zoom = (event: WheelEvent) => {
      if (!event.deltaY) return;
      event.preventDefault();
      const matrix = (drawingGroup.current ?? canvas).getScreenCTM();
      if (!matrix) return;
      const point = new DOMPoint(event.clientX, event.clientY).matrixTransform(matrix.inverse());
      const factor = event.deltaY > 0 ? 1.12 : 1 / 1.12;
      setView(v => ({
        x: point.x + (v.x - point.x) * factor,
        y: point.y + (v.y - point.y) * factor,
        w: Math.max(10, Math.min(10000, v.w * factor)),
        h: Math.max(10, Math.min(10000, v.h * factor)),
      }));
    };
    // React's delegated wheel listener is passive; zoom must cancel page scrolling at this surface.
    canvas.addEventListener('wheel', zoom, { passive: false });
    return () => canvas.removeEventListener('wheel', zoom);
  }, []);

  useEffect(() => {
    const visible = sketch && visibleSketchPointIds(sketch, selected);
    const validSelected = selected.filter(id =>
      sketch?.entities.some(entity => entity.id === id && (entity.type !== 'point' || visible?.has(id)))
    );
    if (validSelected.length !== selected.length) setSelected(validSelected);
    const validConstraints = selectedConstraints.filter(
      id => id === dimensionDraft?.id || (!!sketch && associatedEntityIds(sketch, id).length > 0)
    );
    if (validConstraints.length !== selectedConstraints.length) setSelectedConstraints(validConstraints);
    if (partId !== (part?.id ?? '')) setPartId(part?.id ?? '');
    saveCadViewState(doc.id, { selectedPartId: part?.id ?? '', view, selectedEntityIds: validSelected });
  }, [doc.id, part, partId, selected, selectedConstraints, dimensionDraft, sketch, view]);

  useEffect(() => {
    if (!sketch) return;
    setDimensionFlow(previous =>
      previous.phase === 'idle' ? previous : transitionDimensionWorkflow(sketch, previous, { type: 'refresh' }).state
    );
  }, [sketch]);
  const publish = (next: CadDocument) => {
    setCancelledSketch(null);
    setFinishError(null);
    documentRef.current = next;
    setDocument(next);
    callbacks.current.onDraftChange(next);
  };
  // What extrudes make of each other's sketches and parts follows each change straight away, as the solver keeps it.
  const commit = (next: CadDocument) => publish(commitCadSession(session, resolveExtrudeSteps(trimCadFolders(next))));
  const changeSketch = (next: CadSketch) => part && commit(replacePart(documentRef.current, part.id, p => ({ ...p, sketch: next })));

  const solveDrag = (moving: DragGesture) => solveSketchDrag(sketchEditorInput(), moving);

  useEffect(() => {
    if (finishing.current || drag.current || annotationDrag.current || lastCheckedRevision.current === `${doc.id}:${doc.revision}`) return;
    let cancelled = false;
    const sequence = ++solveSequence.current;
    setSolving(true);
    void solveCadDocument(doc, { classifyEntities: true, sketchOnly })
      .then(result => {
        if (cancelled || sequence !== solveSequence.current || drag.current || annotationDrag.current) return;
        lastCheckedRevision.current = `${doc.id}:${doc.revision}`;
        setSolving(false);
        const feedback = sketchFeedback(solveFeedback(result));
        setProblems(feedback);
        setConflictedConstraints(feedback.conflictedConstraintIds);
        setInProgress(feedback.inProgress);
        // A part's profile comes first and is what the editor shows, whatever its face sketches report.
        setSketchStatuses(Object.fromEntries([...result.sketches].reverse().map(state => [state.partId, state])));
        setStatus(feedback.status);
        // Solver normalization belongs to the same user command, never another undo entry.
        if (result.sketches.some(s => s.status === 'solved') && JSON.stringify(result.document) !== JSON.stringify(documentRef.current)) {
          normalizePatternVariableSource(doc, result.document);
          session.document = result.document;
          documentRef.current = result.document;
          setDocument(result.document);
          callbacks.current.onDraftChange(result.document);
        }
      })
      .catch(error => {
        if (cancelled || sequence !== solveSequence.current) return;
        lastCheckedRevision.current = `${doc.id}:${doc.revision}`;
        setSolving(false);
        setProblems(failedCheckProblems(error));
        setInProgress(false);
        setStatus('Sketch could not be checked');
      });
    return () => {
      cancelled = true;
    };
  }, [doc, session, checkEpoch, sketchOnly, normalizePatternVariableSource, solveFeedback]);

  useEffect(() => {
    if (!dimension) return;
    dimensionInput.current?.focus();
    dimensionInput.current?.select();
  }, [dimension]);
  useEffect(() => {
    if (filletEditing) {
      filletInput.current?.focus();
      filletInput.current?.select();
    }
  }, [filletEditing]);
  useEffect(() => {
    if (conicEditing) {
      rhoInput.current?.focus();
      rhoInput.current?.select();
    }
  }, [conicEditing]);

  const cancelDimensionEdit = () => {
    const placed = dimension && !dimensionDraft;
    newDimensionCommand.current = null;
    setDimensionFlow(previous => idleDimensionWorkflow(previous.mode));
    setDimension(null);
    if (dimensionDraft) setSelectedConstraints(ids => ids.filter(id => id !== dimensionDraft.id));
    setMessage(
      placed
        ? 'Dimension value unchanged. Select geometry or choose a tool.'
        : 'Dimension creation cancelled. Select geometry or choose a tool.'
    );
    svg.current?.focus();
  };
  const selectDimension = (id: string, additive = false) => {
    newDimensionCommand.current = null;
    setDimensionFlow(previous => idleDimensionWorkflow(previous.mode));
    setDimension(null);
    setSelectedConstraints(ids => (additive ? (ids.includes(id) ? ids.filter(existing => existing !== id) : [...ids, id]) : [id]));
    setSelected([]);
    setMessage('Dimension selected. Double-click or press Enter to edit; Delete removes it.');
  };
  const editDimension = (id: string) => editSketchDimension(sketchEditorInput(), id);
  const startAnnotationDrag = (id: string, event: PointerEvent<SVGGElement>) => startSketchAnnotationDrag(sketchEditorInput(), id, event);
  const transformSelectionCenter = (ids: readonly string[]) => {
    const wanted = new Set(
      ids.flatMap(id => {
        const e = sketch?.entities.find(e => e.id === id);
        return !e ? [] : e.type === 'point' ? [e.id] : curvePointIds(e);
      })
    );
    const points = sketch?.entities.filter(e => e.type === 'point' && wanted.has(e.id)) ?? [];
    const xs = points.flatMap(e => (e.type === 'point' ? [e.x] : [])),
      ys = points.flatMap(e => (e.type === 'point' ? [e.y] : []));
    return xs.length ? { x: (Math.min(...xs) + Math.max(...xs)) / 2, y: (Math.min(...ys) + Math.max(...ys)) / 2 } : { x: 0, y: 0 };
  };
  const chooseTool = (next: Tool) => chooseSketchTool(sketchEditorInput(), next);
  const navigateHistory = (redo = false) => {
    chooseTool('select');
    setSelected([]);
    publish(redo ? redoCadSession(session) : undoCadSession(session));
  };
  const fit = (entityIds?: readonly string[]) => {
    if (!sketch) return;
    setView(
      fitSketchView(
        sketch,
        initialView,
        entityIds,
        faceSketch?.outline,
        !faceSketch && !entityIds && part ? drawnOnOutline(documentRef.current, part) : null
      )
    );
  };
  useEffect(() => {
    if (faceSketch && !faceSketch.scene) fit();
    // Only on opening: afterwards the view is the user's.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const projectPoint = (point: Point) => projectSketchPoint(point, drawingGroup.current ?? svg.current);
  const pointAt = (event: { clientX: number; clientY: number; shiftKey?: boolean }) => sketchPointAt(sketchEditorInput(), event);
  const addSnapRelations = (source: CadSketch, hints: (CadDrawingInference | null)[], curvePointIndex: number | readonly number[] = -1) =>
    sketch ? bindPartCorners(sketch, addDrawingRelations(sketch, source, hints, { tool, curvePointIndex }), hints) : source;
  const addShape = (end?: Point) => addSketchShape(sketchEditorInput(), end);
  const currentDimension = dimensionDraft?.id === dimension ? dimensionDraft : sketch?.constraints.find(c => c.id === dimension);
  const rejectValue = (reason: string, input?: HTMLInputElement | null) => {
    setMessage(reason);
    input?.focus();
    return reason;
  };
  const applyDimensionValue = () => applySketchDimensionValue(sketchEditorInput());
  const applyCreationValue = ({ advance = true } = {}): string | null => {
    if (!creationValues || !part || !sketch || creationValues.partId !== part.id) return null;
    const current = creationValueAt(creationValues, sketch);
    if (!current) return rejectValue('This drawing value no longer applies. Select its geometry again.', creationInput.current);
    const parsed = parseCadValue(
      creationValues.editing ? cadFieldText(creationInput.current, creationValues.text) : lengthText(current.constraint.value),
      { unit: 'mm', variables: variableScope }
    );
    if ('error' in parsed) return rejectValue(parsed.error, creationInput.current);
    const valueError = dimensionValueError(current.constraint, parsed.value);
    if (valueError) return rejectValue(valueError, creationInput.current);
    if (current.existingConstraintId)
      commit(updateDimension(documentRef.current, current.existingConstraintId, parsed.value, parsed.expression));
    else {
      const constraint = { ...current.constraint, value: parsed.value, expression: parsed.expression };
      const position = creationValueAnchor(creationValues, sketch, creationValues.index, markerScale);
      changeSketch(addConstraint(sketch, position ? withDimensionPlacement(sketch, constraint, position) : constraint));
    }
    setCreationValues(advance ? advanceCreationValue(creationValues) : null);
    setMessage('Drawing dimension applied. Type the next value or keep drawing.');
    svg.current?.focus();
    return null;
  };
  const finishSpline = (keepTool = false) => finishSketchSpline(sketchEditorInput(), keepTool);
  const editPattern = (id: string) => {
    const pattern = sketch?.constraints.find(c => c.id === id);
    if (pattern?.type !== 'linearPattern' && pattern?.type !== 'circularPattern') return;
    chooseTool(pattern.type);
    setPatternEditId(id);
    patternCommandId.current = id;
    if (pattern.type === 'linearPattern') setLinearParameters(linearPatternParameters(pattern, lengthUnit));
    else setCircularParameters(circularPatternParameters(pattern, sketch!, lengthUnit));
    setSelected(editablePatternSources(pattern));
    setMessage('Edit the pattern counts, spacing or direction. Deleted instances remain excluded.');
  };
  const acceptSlot = () => {
    if (!slotPreview?.ok) return setMessage(slotPreview?.message ?? 'Select source curves for a slot.');
    const group = slotPreview.sketch.constraints.find(c => c.id === slotPreview.slotId);
    changeSketch(slotPreview.sketch);
    if (group?.type === 'slot') setSharedSlotWidth(group.widthEntityId);
    setSelected([]);
    setMessage('Slot created. Select more source curves to share its width, or press Escape.');
    svg.current?.focus();
  };
  const acceptCircularPattern = () => acceptSketchCircularPattern(sketchEditorInput());
  const acceptLinearPattern = () => acceptSketchLinearPattern(sketchEditorInput());
  const acceptTransform = () => {
    if (!transformPreview?.ok) return setMessage(transformPreview?.message ?? 'Select geometry to transform.');
    if (transformPreview.changed) changeSketch(transformPreview.sketch);
    const ids = transformPreview.entityIds,
      released = transformPreview.releasedConstraintIds.length;
    chooseTool('select');
    setSelected(ids);
    if (released) setTransformNotice(`${released} external or directed relations were released by the transform.`);
    setMessage(transformPreview.changed ? 'Transform applied.' : 'Transform closed without changes.');
  };
  const acceptChamfer = () => acceptSketchChamfer(sketchEditorInput());
  const acceptFillet = () => acceptSketchFillet(sketchEditorInput());
  const acceptOffset = () => acceptSketchOffset(sketchEditorInput());
  const applyConicRho = () => applySketchConicRho(sketchEditorInput());
  const removeSelected = (entityIds: readonly string[] = selected, constraintIds: readonly string[] = selectedConstraints) =>
    removeSketchSelection(sketchEditorInput(), entityIds, constraintIds);
  const openContext = (target: SketchContextTarget, position: Point) => {
    if (!sketch || busy || drag.current || annotationDrag.current) return;
    const context = createSketchContext(sketch, target, position, { entityIds: dimensionSelection, constraintIds: selectedConstraints });
    chooseTool('select');
    setSelected([...context.entityIds]);
    setSelectedConstraints([...context.constraintIds]);
    setContextMenu(context);
  };
  const contextTarget = (target: Element, position: Point) => sketchContextTarget(sketchEditorInput(), target, position);
  const keyboardContext = () => {
    if (!sketch || !svg.current) return;
    const target = selectedSketchContextTarget(sketch, { entityIds: dimensionSelection, constraintIds: selectedConstraints });
    const element =
      target.kind === 'blank'
        ? svg.current
        : (svg.current.querySelector(
            `[${target.kind === 'dimension' ? 'data-dimension' : target.kind === 'constraint' ? 'data-constraint-id' : 'data-entity-id'}="${CSS.escape(target.id)}"]`
          ) ?? svg.current);
    const bounds = element.getBoundingClientRect();
    openContext(target, { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 });
  };
  const contextAction = (action: SketchContextAction, context: SketchContext) => sketchContextAction(sketchEditorInput(), action, context);
  const placeDimension = (placed: CadDimension) => placeSketchDimension(sketchEditorInput(), placed);
  const applyDimensionEvent = (event: DimensionWorkflowEvent) => applySketchDimensionEvent(sketchEditorInput(), event);
  const beginDimension = () => beginSketchDimension(sketchEditorInput());
  const constrain = (type: ConstraintTool) => constrainSketch(sketchEditorInput(), type);
  const toggleFix = () => {
    if (!sketch) return;
    if (!selected.length) {
      chooseTool('select');
      setFixMode(true);
      setMessage('Click geometry to fix or unfix it. Escape ends Fix.');
      svg.current?.focus();
      return;
    }
    fixGeometry(selected);
  };
  /** Fixes the points of `targets`, or unfixes them when they are all fixed already. */
  const fixGeometry = (targets: string[]) => {
    if (!sketch) return;
    const result = toggleFixed(sketch, targets, fixMode);
    if (result.sketch) changeSketch(result.sketch);
    setMessage(result.message);
  };
  const toggleConstruction = () => {
    if (sketch && selected.length) {
      const next = toggleContextConstruction(sketch, selected);
      if (next === sketch)
        setMessage('Spline tangent handles remain construction geometry. Select the curve to change its construction state.');
      else changeSketch(next);
    } else setConstruction(value => !value);
  };
  const keyDown = (event: KeyboardEvent<HTMLDivElement>) =>
    cadEditorKeyDown(
      {
        ...sketchEditorInput(),
        applyCreationValue,
        beginDimension,
        constrain,
        creationValues,
        dimension,
        finishSpline,
        hoveredPart,
        isolatePart,
        keyboardContext,
        navigateHistory,
        partHasOutline,
        pointerEnd,
        polygonInput,
        selectedConstraints,
        selectedFace,
        selectedPlane,
        setHiddenParts,
        setSearchMode,
        setShortcutsOpen,
        setSketchCameraShift,
        setTransparentParts,
        setViewRequest,
        shortcutsOpen,
        showWorkspace,
        studioCommand,
        studioSession,
        toggleCommandSearch,
        toggleConstruction,
        toggleFix,
        ...studioKeyActions(documentRef, featureShown, setFeatureVisibility, setRolledTo),
      },
      event
    );
  const pointerDown = (event: PointerEvent<SVGSVGElement>) => sketchPointerDown(sketchEditorInput(), event);
  const pointerMove = (event: PointerEvent<SVGSVGElement>) => sketchPointerMove(sketchEditorInput(), event);
  // Built on each call, so the handlers below read this render's values, as they did when they were closures here.
  const sketchEditorInput = (): SketchEditorInput => ({
    acceptCircularPattern,
    acceptLinearPattern,
    acceptOffset,
    acceptSlot,
    acceptTransform,
    addShape,
    addSnapRelations,
    annotationDrag,
    applyDimensionEvent,
    boxGesture,
    busy,
    cancelDimensionEdit,
    centerArcSweep,
    chain,
    chamferDistances,
    chamferPreview,
    chamferSelection,
    changeSketch,
    chooseTool,
    commit,
    conicEditing,
    constraintMode,
    construction,
    contextPress,
    contextTarget,
    contextualArc,
    currentDimension,
    cursor,
    dimensionFlow,
    dimensionInput,
    dimensionMode,
    dimensionSelection,
    doc,
    documentRef,
    drag,
    drawingGesture,
    drawingGroup,
    editDimension,
    editPattern,
    faceSketch,
    filletPreview,
    filletRadius,
    filletSelection,
    fit,
    fixGeometry,
    fixMode,
    handleDrag,
    height,
    hoveredReferences,
    inference,
    lastDrawingHint,
    lastSnap,
    lengthText,
    lengthUnit,
    lineContinuation,
    markerScale,
    modification,
    mounted,
    newCurveCommand,
    newDimensionCommand,
    offsetInput,
    offsetPreview,
    openContext,
    pan,
    parseCadValue,
    parsedCircular,
    parsedLinear,
    part,
    partEdges,
    patternCommandId,
    patternEditId,
    pending,
    pendingSnaps,
    pickedEdges,
    placeDimension,
    placingDimension,
    pointAt,
    polygonCountGesture,
    polygonSides,
    polygonTool,
    preparingDimension,
    projectPoint,
    publish,
    radius,
    rejectValue,
    removeSelected,
    requestSketchCheck,
    restoreCanvasKeyboard,
    rho,
    rhoInput,
    selectDimension,
    selected,
    selectionHints,
    session,
    setBusy,
    setChain,
    setChamferDistances,
    setCircularParameters,
    setConicEditing,
    setConstraintMode,
    setContextMenu,
    setContextualArc,
    setCreationValues,
    setCursor,
    setDimension,
    setDimensionFlow,
    setDocument,
    setDrawingCue,
    setFilletEditing,
    setFixMode,
    setHoveredConstraintEntities,
    setHoveredModifyCurve,
    setHoveredPoint,
    setLineContinuation,
    setLinearParameters,
    setMessage,
    setModification,
    setModifyTarget,
    setPalette,
    setPatternEditId,
    setPatternNotice,
    setPending,
    setPickedEdges,
    setPolygonSides,
    setRegionField,
    setRho,
    setSelected,
    setSelectedConstraints,
    setSelectionBox,
    setSharedSlotWidth,
    setSketchTurn,
    setSlotChain,
    setSlotWidth,
    setSnapCue,
    setSplitFirst,
    setSplitNotice,
    setTool,
    setTransformNotice,
    setTransformParameters,
    setUsingEdges,
    setView,
    shownSketch,
    sketch,
    sketchBackdrop,
    sketchTurn,
    snap,
    solveDrag,
    solving,
    splitFirst,
    svg,
    takeEdges,
    tangentAxis,
    tool,
    transformSelectionCenter,
    usingEdges,
    variableScope,
    view,
    width,
  });
  const pointerEnd = (cancel = false, event?: PointerEvent<SVGSVGElement>) => sketchPointerEnd(sketchEditorInput(), cancel, event);
  const pendingFinishReason = sketchPendingFinishReason({
    tool,
    selected: selected.length,
    splitting: !!splitFirst,
    modification,
    drawing: !!pending.length && !lineContinuation,
    cornerReady: !!cornerPreview?.ok,
  });
  /** What's still being typed or previewed, such as a dimension or a fillet, is part of the sketch being kept. */
  const applyPendingValues = () =>
    acceptSketchCornerPreview(sketchEditorInput()) ||
    acceptOffset() ||
    applyDimensionValue() ||
    applyConicRho() ||
    (tool === 'linearPattern' && selected.length ? acceptLinearPattern() : null) ||
    (creationValues?.editing ? applyCreationValue({ advance: false }) : null);
  const prepareDocument = (): CadDocument | null => {
    const blocked = (reason: string) => {
      setFinishError(reason);
      setMessage(reason);
      callbacks.current.onFinishBlocked?.(reason);
      return null;
    };
    if (busy || solving || finishing.current || preparingDimension.current) return blocked('Wait for the current sketch check to finish.');
    const reason = !thicknessValid ? 'Enter a valid part thickness before finishing the sketch.' : pendingFinishReason;
    if (reason) {
      return blocked(reason);
    }
    try {
      const error = applyPendingValues();
      if (error) return blocked(error);
    } catch (error) {
      return blocked(error instanceof Error ? error.message : String(error));
    }
    if (lineContinuation) setPending([]);
    return documentRef.current;
  };
  const finish = async (): Promise<boolean> => {
    const prepared = prepareDocument();
    if (!prepared) return false;
    finishing.current = true;
    setFinishError(null);
    setBusy(true);
    try {
      await callbacks.current.onFinish(prepared);
      acceptCadSession(session, prepared);
      return true;
    } catch (error) {
      setFinishError(error instanceof Error ? error.message : String(error));
      return false;
    } finally {
      finishing.current = false;
      setBusy(false);
      // Acceptance owns normalization while it runs. Resume ordinary draft checks
      // if the editor stays mounted after a blocked acceptance or a host callback.
      requestSketchCheck();
      // Going inert dropped keyboard focus, and the editor can stay mounted, so shortcuts need it back.
      restoreCanvasKeyboard();
    }
  };
  useImperativeHandle(controller, () => ({
    finish,
    prepareDocument,
    rolledTo: () => userRollback,
    updateSettings: settings => {
      const prepared = settings.lengthUnit === documentRef.current.lengthUnit ? documentRef.current : prepareDocument();
      if (!prepared) return false;
      commit({ ...withCadLengthUnit(prepared, settings.lengthUnit ?? 'mm'), name: settings.name });
      return true;
    },
  }));
  const cancel = async () => {
    setBusy(true);
    try {
      publish(restoreCadSession(session, { document: session.entry, past: [], future: [] }));
      await callbacks.current.onCancel();
      endCadSession(doc.id);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  };
  // Built on each call, so the navigation below reads this render's values, as it did when it was closures here.
  const studioNavigationInput = (): StudioNavigationInput => ({
    apartIds,
    applyPendingValues,
    busy,
    canvasBox,
    chooseTool,
    choosingFace,
    closeDialog,
    commit,
    cutSelection,
    directionPicker,
    documentRef,
    faceEditor,
    feature,
    onEditFaceSketch,
    openDialog,
    part,
    profiles,
    publish,
    rolledTo,
    root,
    selectedFace,
    selectedPlane,
    session,
    setCancelledSketch,
    setChoosingFace,
    setDirectionPicker,
    setMessage,
    setPartId,
    setRolledTo,
    setSelected,
    setSelectedFace,
    setSelectedPlane,
    setShow3D,
    setShowWorkspace,
    setSketchCameraShift,
    setSketchRowPicked,
    setSketchTurn,
    setStudioRefusal,
    setView,
    showWorkspace,
    sketchBefore,
    sketchCameraShift,
    sketchRowPicked,
    sketchTurn,
    studioCamera,
    studioSession,
    svg,
    userRollback,
    variableScope,
    view,
    viewWantsKeyboard,
  });
  const openFeature = (
    kind: 'extrude' | 'pattern' | 'hole',
    partId: string,
    before?: CadHistoryMark,
    initialPatternKind?: PatternOpening
  ) => openStudioFeature(studioNavigationInput(), kind, partId, before, initialPatternKind);
  const closeFeature = (keep: boolean) => {
    if (keep && feature?.kind === 'extrude') setFeatureVisibility(shown => withMadeSketchHidden(shown, doc, feature.partId));
    closeStudioFeature(studioNavigationInput(), keep);
  };
  const openSketch = (stepPartId: string, before?: CadHistoryMark) => openStudioSketch(studioNavigationInput(), stepPartId, before);
  const closeSketch = (keep: boolean) => closeStudioSketch(studioNavigationInput(), keep);
  const featureAction = (entry: FeatureEntry, action: FeatureAction) => studioFeatureAction(studioNavigationInput(), entry, action);
  const newPartOn = (on: CadDrawnOn['on'], datum?: string) => newStudioPartOn(studioNavigationInput(), on, datum);
  const newSketchOn = (plane: string) => newStudioSketchOn(studioNavigationInput(), plane);
  const pickPlane = (plane: string) => pickStudioPlane(studioNavigationInput(), plane);
  const studioCommand = (command: StudioCommand, initialPatternKind?: PatternOpening) =>
    runStudioCommand(studioNavigationInput(), command, initialPatternKind);
  const faceEditor = faceSketchHost({
    part,
    copyId: cutSelection.selectedCopyId,
    prepare: prepareDocument,
    commit,
    read: () => documentRef.current,
    onEdit: onEditFaceSketch,
    root,
    partCamera: partCameraState,
    studioCamera,
    workspace: showWorkspace,
    partView: show3D,
  });
  const valuePosition = (anchor: Point | null, desiredWidth = 216, topOffset = 12) =>
    sketchValuePosition(anchor, svg.current, drawingGroup.current, desiredWidth, topOffset);
  const dimensionEditorPosition =
    currentDimension && numeric(currentDimension) && sketch
      ? valuePosition(dimensionAnchor(currentDimension, sketch, markerScale))
      : undefined;
  const creationPositions = creationEditorPositions(creationValues, sketch, markerScale, valuePosition);
  const offsetDimension = offsetPreview?.ok
    ? (offsetPreview.sketch.constraints.find(c => c.id === offsetPreview.dimensionId && numeric(c)) as NumericConstraint | undefined)
    : undefined;
  const offsetPosition =
    offsetDimension && offsetPreview?.ok
      ? valuePosition(
          dimensionAnchor(offsetDimension, offsetPreview.sketch, markerScale),
          modification.phase === 'offset' && modification.editing ? 250 : 140,
          -14
        )
      : undefined;
  const activeSketchStatus = sketchStatuses[part?.id ?? ''];
  const variableProblems = cadVariableProblems(doc);
  // A dimension that can't follow its variables shows like a conflicting one.
  const shownConflicts = [...conflictedConstraints, ...variableProblems.flatMap(problem => problem.constraintIds ?? [])];
  // A studio sketch closes whatever its edit did to the features built from it, which show as broken in the feature list.
  const openSketchProblems = studioSession && !showWorkspace ? sketchProblems : problems;
  const displayStatus =
    activeSketchStatus?.status === 'solved' && (inProgress || !openSketchProblems.length)
      ? sketchDofStatus(activeSketchStatus.dof, isEmptySketch(sketch))
      : status;
  const currentSolverResult = !solving && lastCheckedRevision.current === `${doc.id}:${doc.revision}`;
  const colorNotice = currentSolverResult ? constraintColorNotice(activeSketchStatus) : undefined;
  const entityStatus =
    currentSolverResult &&
    !drag.current &&
    !cornerPreview?.ok &&
    !transformPreview?.ok &&
    !linearPreview?.ok &&
    !slotPreview?.ok &&
    activeSketchStatus?.status === 'solved'
      ? activeSketchStatus.entityStatus
      : undefined;
  const stroke = sketchStrokeColor(activeSketchStatus, currentSolverResult);
  const grid = Math.max(1, 10 ** Math.floor(Math.log10(view.w / 20)));
  const acceptanceNotice = notice ?? useNotice ?? finishError;
  // Read when a region is picked, after this render has worked out which features show.
  const shownNow = useRef<(id: string) => boolean>(() => true);
  const profiles = useProfileSelection(doc, feature, commit, setStudioRefusal, id => shownNow.current(id));
  const faceBackdrop = useFaceSketchCamera(faceSketch?.scene, view, sketchTurn, sketchCameraShift, canvasBox);
  const studioBackdrop = useMemo(() => {
    if (!studioSession || showWorkspace || show3D || !part || !canvasBox?.width || !canvasBox.height) return null;
    return sketchBackdropView(doc, part, view, sketchTurn, canvasBox, sketchCameraShift);
  }, [studioSession, showWorkspace, show3D, part, canvasBox, doc, view, sketchTurn, sketchCameraShift]);
  const sketchBackdrop = faceBackdrop ?? studioBackdrop;
  // Picking context is local to a sketch; opening it leaves the camera where the studio was looking.
  useEffect(() => {
    setPickedEdges([]);
  }, [part?.id, showWorkspace]);
  /** `u`: the picked edges become the sketch's own, fixed where they are, to draw and constrain against. */
  const takeEdges = (keys = pickedEdges) => {
    if (!sketch) return;
    const source = sketchBackdrop?.document ?? documentRef.current,
      frame = part && cadSketchFrame(documentRef.current, part);
    const used = addUsedPartEdges(sketch, partEdges, keys, source, frame, part?.id);
    if (used.problem) return setUseNotice(used.problem);
    setUseNotice(null);
    changeSketch(used.sketch);
    setPickedEdges([]);
    setSelected(used.selected);
  };
  // One line drawn on a plane or face is a board drawn edge-on, as the reference's thin extrude: its sketch can close.
  const edgeOnBoard = !!(studioSession && part?.drawnOn && !part.thin && isSingleLine(part));
  const sketchFinishReason = openSketchFinishReason(sketch, openSketchProblems, {
    checking: busy || solving,
    pending: pendingFinishReason,
    edgeOnBoard,
    thickness: thicknessValid,
    face: !!faceSketch,
    studio: studioSession,
  });
  const sketchCanFinish = sketchFinishReason === null;
  // The studio's Parts list shows each physical instance, with an eye to show or hide it in the view.
  // The studio's parts: a sketch not yet extruded is a feature, not a part.
  // A tool used up by its cut isn't a part of its own any more.
  // A part whose extrude wasn't built isn't a part yet.
  const listed = studioListSource(dialog?.kind, studioPreview.document, shownDocument, doc);
  const builtParts = studioSession
    ? listedStudioParts(listed, dialog, rolledBack).filter(p => !unbuiltParts?.includes(p.id))
    : builtStudioParts(doc);
  const isolatePart = usePartIsolation(builtParts, cutSelection.selectedKey, hiddenParts, setHiddenParts);
  const physicalPartCount = builtParts.reduce((count, p) => count + 1 + (p.copies?.length ?? 0), 0);
  // An open sketch turned with its parts behind it, about the middle of the view.
  const turned = !!sketchBackdrop && sketchTurn !== straightOn;
  const studioDisabled = disabledStudioCommands(part, partHasOutline, builtParts.length);
  const featureShown = useFeatureShown(featureVisibility, shownDocument, pastRollback, unbuiltParts, featureProblems);
  shownNow.current = featureShown;
  const partsPanel = (
    <>
      <div className="cad-panel-heading" hidden={!!faceSketch}>
        <h2>Parts ({studioSession ? physicalPartCount : doc.parts.length})</h2>
        {!studioSession && (
          <button
            type="button"
            aria-label="Add part"
            onClick={() => {
              const added = createCadPart(`Part ${doc.parts.length + 1}`, part?.thickness ?? 18);
              commit({ ...doc, parts: [...doc.parts, added] });
              setPartId(added.id);
              setSelected([]);
              chooseTool('select');
            }}>
            ＋
          </button>
        )}
      </div>
      <PartsList
        document={doc}
        rolledTo={userRollback}
        onSketchCopy={onEditFaceSketch && ((partId, copyId, face) => faceEditor.create(face, undefined, { partId, copyId }))}
        onDetachCopy={(partId, copyId) => {
          const result = detachStudioCopy(documentRef.current, partId, copyId);
          if ('error' in result) return setStudioRefusal(result.error);
          commit(result.document);
          setPartId(result.partId);
        }}
        hidden={!!faceSketch}
        studio={studioSession}
        rows={(studioSession ? builtParts : doc.parts).flatMap(p => [
          { key: p.id, part: p, name: p.name },
          // In the studio every copy is a part of its own in the list, as the reference lists them, with its own eye.
          ...(studioSession
            ? (p.copies ?? []).map((copy, index) => ({ key: `${p.id}/${copy.id}`, part: p, name: cadCopyName(p, index) }))
            : []),
        ])}
        selectedKey={cutSelection.selectedKey}
        hiddenParts={hiddenParts}
        transparent={studioSession ? [transparentParts, setTransparentParts] : undefined}
        onToggleHidden={key => setHiddenParts(previous => toggledKey(previous, key))}
        trouble={id => partTrouble(doc, variableProblems, sketchStatuses, id)}
        onPick={(partId, copyId) => {
          setSelectedFace(null);
          if (partPicking && showWorkspace) return cutSelection.pickForCut(partId, copyId);
          cutSelection.selectPart(partId, copyId);
          setSelected([]);
          chooseTool('select');
        }}
        onRename={(partId, copyId, name) => commit(renamedStudioPart(documentRef.current, partId, copyId, name))}
        onEdit={change => commit(change(documentRef.current))}
      />
    </>
  );
  const stepDialog = showWorkspace && dialog && (
    <StudioDialogHost
      dialog={dialog}
      document={feature ? extrusionDepth.document : doc}
      variables={variableScope}
      change={change => commit(change(documentRef.current))}
      close={closeDialog}
      onOk={() => closeFeature(true)}
      onCancel={() => closeFeature(false)}
      {...{ onPreview: studioPreview.update, onConnectorsChange: setMateConnectors, partPicks: cutSelection.dialogPicks }}
      setDirectionPicker={picker => setDirectionPicker(() => picker)}
      pickPoint={pointPicker.start}
      depthDragging={extrusionDepth.control(shownDocument)?.dragging}
      profilePicking={profiles.enabled}
      onPickProfile={() => profiles.setEnabled(!profiles.enabled)}
      onEditSketch={openSketch}
      cutTool={cutSelection.selectedTool}
      onCutPicked={cutSelection.showCutPicked}
    />
  );
  const content = (
    <div
      ref={root}
      className="cad-editor"
      aria-busy={busy}
      data-demo-mode={isDemoMode() || undefined}
      onKeyDown={keyDown}
      onFocus={event => {
        const target = event.target as HTMLElement;
        dialogFocus.current = target.closest('.cad-feature-dialog') ? target : null;
      }}
      onKeyUp={event => event.stopPropagation()}>
      {studioSession && showWorkspace ? (
        <StudioToolbar
          busy={busy}
          searchHighlight={searchHighlight}
          active={choosingFace ? 'sketch' : dialog ? dialogCommand[dialog.kind] : null}
          disabled={studioDisabled}
          canUndo={session.past.length > 0}
          canRedo={session.future.length > 0}
          canFinish={thicknessValid && !solving && !problems.length && !dialog}
          onCommand={studioCommand}
          onSearch={toggleCommandSearch}
          onUndo={() => navigateHistory()}
          onRedo={() => navigateHistory(true)}
          onCancel={() => void cancel()}
          onFinish={() => void finish()}>
          <StudioProposals
            key={doc.id}
            document={doc}
            session={session}
            checkedProposal={assistantProposalState}
            selection={part && { partId: part.id, copyId: cutSelection.selectedCopyId }}
            disabled={busy || !!rollbackStep || stepDialogOpen}
            onApply={next => applyFramed(documentRef.current, next, studioCamera.current, publish, setViewRequest)}
          />
        </StudioToolbar>
      ) : (
        <SketchToolbar
          tools={tools}
          searchHighlight={searchHighlight}
          onSearch={toggleCommandSearch}
          tool={tool}
          construction={construction}
          constraintMode={fixMode ? 'fix' : constraintMode}
          busy={busy}
          canUndo={session.past.length > 0}
          canRedo={session.future.length > 0}
          canFinish={sketchCanFinish}
          onTool={next => {
            if (next === 'dimension') beginDimension();
            else chooseTool(next);
          }}
          onConstruction={toggleConstruction}
          onConstraint={constrain}
          onFix={toggleFix}
          onUndo={() => navigateHistory()}
          onRedo={() => navigateHistory(true)}
          onCancel={() => (studioSession ? closeSketch(false) : void cancel())}
          onFinish={() => (studioSession ? closeSketch(true) : void finish())}
          onReturnToCanvas={restoreCanvasKeyboard}
          closeElsewhere={studioSession}
        />
      )}
      <div className="cad-workspace" inert={busy}>
        <aside className="cad-sidebar" aria-label="Parts and sketch properties">
          {faceSketch && (
            <div className="cad-properties">
              <h3>Sketch on the {faceSketch.label.toLowerCase()}</h3>
              <p className="cad-muted">
                Draw lines or shapes across the part to mark out regions. Finish the sketch, then click a region to set its depth.
              </p>
            </div>
          )}
          {studioSession && (
            <StudioFeatureList
              currentDocument={documentRef}
              commit={commit}
              onRefusal={setStudioRefusal}
              workspace={showWorkspace}
              document={doc}
              selectedPartId={part?.id ?? null}
              initialSelection={selectedStepId}
              onSelect={selectStudioFeature(doc, profiles.pickSketch, {
                sketch: setSketchRowPicked,
                face: () => setSelectedFace(null),
                part: picksFeatureRows(dialog) ? cutSelection.pickForCut : cutSelection.selectPart,
                entities: () => setSelected([]),
              })}
              onAction={featureAction}
              rollback={rollbackStep}
              onRollTo={showWorkspace ? setRolledTo : undefined}
              onHover={entry => setHoveredStepParts(entry?.kind === 'step' ? featureRowParts(doc, entry.step) : null)}
              {...(showWorkspace && { selectedPlane, onPickPlane: pickPlane, onNewSketch: newSketchOn })}
              {...{ shown: featureShown, featureProblems, pending: pendingRow(doc, dialog, choosingFace, userRollback) }}
              preview={dialog?.kind === 'fillet' ? studioPreview.document : undefined}
              onToggleShown={id => setFeatureVisibility(previous => ({ ...previous, [id]: !featureShown(id) }))}
            />
          )}
          {!faceSketch && !studioSession && <CadVariablesPanel document={doc} onChange={commit} />}
          {!studioSession && partsPanel}
          {part && !faceSketch && !(studioSession && showWorkspace) && (
            <SketchPartProperties
              document={doc}
              documentRef={documentRef}
              part={part}
              studio={studioSession}
              commit={commit}
              variables={variableScope}
              variableProblems={variableProblems}
              focusCanvas={() => svg.current?.focus()}
              onThicknessValidity={setThicknessValid}
              pickDirection={picked => setDirectionPicker(() => picked)}
              setPartId={setPartId}
              setSelected={setSelected}
              chooseTool={chooseTool}
              faceEditor={onEditFaceSketch && faceEditor}
              showConstraints={showConstraints}
              onShowConstraints={shown => {
                setShowConstraints(shown);
                setHoveredConstraintEntities([]);
              }}
              showDimensionMode={tool === 'dimension' || placingDimension || dimension !== null}
              dimensionMode={dimensionMode}
              onDimensionMode={mode => applyDimensionEvent({ type: 'mode', mode })}
              selected={selected}
              tool={tool}
              onEditConic={(id, rho) => {
                setRho(String(rho));
                setConicEditing(id);
              }}
            />
          )}
          {studioSession && (
            <section className="cad-parts-panel" aria-label="Parts panel">
              {partsPanel}
            </section>
          )}
        </aside>
        <main className="cad-drawing">
          {acceptanceNotice && (
            <p className="cad-notice" role="alert">
              {acceptanceNotice}
            </p>
          )}
          {dialog?.kind !== 'partCut' && stepDialog}
          {studioSession && !showWorkspace && part && (
            // The open sketch, closed from here as the reference's sketch dialog is: away from the studio's Done.
            <StudioSketchDialog
              key={`${doc.id}:${part.sketch.id}`}
              editor={root}
              title={designStepLabel(doc, `${part.id}:sketch`) ?? `Sketch · ${part.name}`}
              plane={sketchPlaneName(doc, part.drawnOn)}
              disabled={!sketchCanFinish}
              checking={busy || solving}
              reason={sketchFinishReason}
              canConfirm={() => {
                // A held pointer still owns its gesture; closing here could publish its solve into the next view.
                return !drag.current && !annotationDrag.current && !boxGesture.current && drawingGesture.current.phase !== 'pressed';
              }}
              onConfirm={() => closeSketch(true)}
              // Shift+E keeps the sketch and starts an Extrude of all of it, as the reference does.
              onExtrude={() => {
                if (!closeSketch(true)) return;
                // Read after closing: a value still being typed is applied as the sketch closes.
                const before = markCadSession(session);
                const sketched = before.document.parts.find(candidate => candidate.id === part.id);
                const started = sketched && startExtrude(before.document, { part: sketched }, true, picked => picked);
                if (!started) return;
                if ('refusal' in started) return setStudioRefusal(started.refusal);
                commit(started.document);
                openFeature('extrude', started.partId, before);
              }}
              onCancel={() => closeSketch(false)}
              showConstraints={showConstraints}
              onShowConstraints={show => {
                setShowConstraints(show);
                setHoveredConstraintEntities([]);
              }}
            />
          )}
          <CadCanvasBar
            {...{
              showWorkspace,
              physicalPartCount,
              studioSession,
              part,
              doc,
              faceSketch,
              show3D,
              svg,
              setShow3D,
              setShowWorkspace,
              partHasOutline,
              chooseTool,
              fit,
              snap,
              setSnap,
              setDrawingCue,
              setSnapCue,
              hoveredReferences,
            }}
          />
          {studioSession && studioRefusal && (
            <p className="cad-notice cad-studio-refusal" role="alert">
              {studioRefusal}
            </p>
          )}
          {showWorkspace && (
            <CadWorkspacePane
              {...{
                studioCamera,
                extrusionDepth,
                shownDocument,
                busy,
                stepDialogOpen,
                choosingFace,
                directionPicker,
                pointPicker,
                focusViewIfIdle,
                doc,
                viewRequest,
                setViewRequest,
                studioSession,
                transparentParts,
                cutSelection,
                part,
                setSketchRowPicked,
                partPicking,
                setSelected,
                dialog,
                hiddenParts,
                featureShown,
                onHoverPart,
                openSketch,
                setPartId,
                setShowWorkspace,
                setShow3D,
                documentRef,
                setChoosingFace,
                openDialog,
                newPartOn,
                selectedPlane,
                selectedFace,
                pickPlane,
                hoveredStepParts,
                userRollback,
                profiles,
                mateConnectors,
                setDirectionPicker,
                setSelectedFace,
                setSelectedPlane,
                stepDialog,
              }}
            />
          )}
          {!showWorkspace && show3D && partHasOutline && part && (
            <CadPartPane
              {...{
                part,
                doc,
                variableScope,
                commit,
                documentRef,
                onEditFaceSketch,
                faceEditor,
                partCameraState,
                studioSession,
                studioCamera,
                newPartOn,
              }}
            />
          )}
          {sketchBackdrop && canvasBox && (
            <CadSketchBackdropPane {...{ sketchBackdrop, canvasBox, faceSketch, doc, featureShown, hiddenParts, setPartEdges }} />
          )}
          <svg
            ref={svg}
            className={`cad-canvas cad-tool-${tool}${sketchBackdrop ? ' cad-canvas-over-parts' : ''}${usingEdges ? ' cad-using-edges' : ''}`}
            style={showWorkspace || (show3D && partHasOutline) ? { display: 'none' } : undefined}
            data-sketch-turned={sketchBackdrop && sketchTurn !== straightOn ? '' : undefined}
            data-testid="cad-canvas"
            data-part-id={part?.id}
            role="img"
            aria-label="2D sketch drawing canvas"
            tabIndex={0}
            viewBox={`${view.x} ${view.y} ${view.w} ${view.h}`}
            onPointerDown={pointerDown}
            onPointerMove={pointerMove}
            onDoubleClick={event => {
              if (tool === 'spline' || tool === 'bezier') {
                event.preventDefault();
                finishSpline();
                return;
              }
              if (tool !== 'select' || !sketch) return;
              const id = (event.target as Element).closest('[data-entity-id]')?.getAttribute('data-entity-id');
              const curve = sketch.entities.find(entity => entity.id === id);
              if (curve?.type === 'conic') {
                event.preventDefault();
                setRho(String(curve.rho));
                setConicEditing(curve.id);
              }
            }}
            onPointerLeave={() => {
              if (!drag.current) {
                setHoveredPoint(null);
                setSnapCue(null);
                setDrawingCue(null);
              }
            }}
            onPointerUp={event => pointerEnd(false, event)}
            onPointerCancel={event => pointerEnd(true, event)}
            onLostPointerCapture={event => pointerEnd(true, event)}
            onContextMenu={event => {
              event.preventDefault();
              if (event.button !== 2) keyboardContext();
            }}>
            <SketchDrawing
              activeSketchStatus={activeSketchStatus}
              annotationSketch={annotationSketch}
              centerArcSweep={centerArcSweep}
              acceptLinearPattern={acceptLinearPattern}
              chain={chain}
              chamferDistances={chamferDistances}
              chamferPreview={chamferPreview}
              circularFields={circularFields}
              circularParameters={circularParameters}
              constraintMode={constraintMode}
              construction={construction}
              cornerPreview={cornerPreview}
              cursor={cursor}
              curvePreview={curvePreview}
              dimensionDraft={dimensionDraft}
              dimensionFlow={dimensionFlow}
              dimensionSelection={dimensionSelection}
              doc={doc}
              drawingCue={drawingCue}
              drawingGroup={drawingGroup}
              editDimension={editDimension}
              editPattern={editPattern}
              entityStatus={entityStatus}
              extendPreview={extendPreview}
              faceSketch={faceSketch}
              fixMode={fixMode}
              grid={grid}
              hoveredConstraintEntities={hoveredConstraintEntities}
              hoveredPoint={hoveredPoint}
              inference={inference}
              lastCheckedRevision={lastCheckedRevision}
              linearParameters={linearParameters}
              linearPreview={linearPreview}
              markerScale={markerScale}
              mirrorPreview={mirrorPreview}
              modification={modification}
              modificationPreview={modificationPreview}
              offsetDimension={offsetDimension}
              offsetPreview={offsetPreview}
              parsedCircular={parsedCircular}
              parsedLinear={parsedLinear}
              parsedTransform={parsedTransform}
              part={part}
              partEdges={partEdges}
              patternAnchor={patternAnchor}
              patternFields={patternFields}
              pending={pending}
              pickedEdges={pickedEdges}
              placingDimension={placingDimension}
              polygonSides={polygonSides}
              selectDimension={selectDimension}
              selected={selected}
              selectedConstraints={selectedConstraints}
              selectionBox={selectionBox}
              setConicEditing={setConicEditing}
              setDimension={setDimension}
              setHoveredConstraintEntities={setHoveredConstraintEntities}
              setMessage={setMessage}
              setRho={setRho}
              setSelected={setSelected}
              setSelectedConstraints={setSelectedConstraints}
              showConstraints={showConstraints}
              shownConflicts={shownConflicts}
              shownSketch={shownSketch}
              sketch={sketch}
              sketchBackdrop={sketchBackdrop}
              sketchCameraShift={sketchCameraShift}
              sketchTurn={sketchTurn}
              slotPreview={slotPreview}
              slotWidth={slotWidth}
              slotWidthCenter={slotWidthCenter}
              slotWidthCircle={slotWidthCircle}
              snapCue={snapCue}
              solving={solving}
              splitFirst={splitFirst}
              startAnnotationDrag={startAnnotationDrag}
              startHandleDrag={startHandleDrag}
              stroke={stroke}
              svg={svg}
              tangentAxis={tangentAxis}
              tool={tool}
              transformParameters={transformParameters}
              transformPreview={transformPreview}
              turned={turned}
              view={view}
            />
          </svg>
          <ModificationControls
            state={modification}
            inputRef={offsetInput}
            position={offsetPosition}
            error={offsetPreview && !offsetPreview.ok ? offsetPreview.message : undefined}
            onText={text => setModification(previous => transitionModification(previous, { type: 'text', text }))}
            onEdit={() => setModification(previous => transitionModification(previous, { type: 'edit' }))}
            onAccept={acceptOffset}
            onCancel={() => {
              chooseTool('select');
              setSelected([]);
              svg.current?.focus();
            }}
            onMirrorPicking={picking => {
              setModification(previous => transitionModification(previous, { type: 'mirrorPicking', picking }));
              setMessage(picking === 'axis' ? 'Select the mirror line.' : 'Select entities to mirror; Shift-click adds to selection.');
              svg.current?.focus();
            }}
          />
          {creationValues && creationValues.partId === part?.id && sketch && (
            <CreationValueControls
              inputRef={creationInput}
              state={creationValues}
              sketch={sketch}
              positions={creationPositions}
              onChange={text => setCreationValues({ ...creationValues, text })}
              onStart={index => {
                const value = creationValueAt(creationValues, sketch, index);
                if (value)
                  setCreationValues({ ...creationValues, index, editing: true, text: lengthText(value.constraint.value), selectAll: true });
              }}
              onAccept={applyCreationValue}
              onCancel={() => {
                setCreationValues(null);
                svg.current?.focus();
              }}
            />
          )}
          {regionField && part && (
            <RegionDepthField
              key={regionField.entry.region.id}
              style={valuePosition(regionField.anchor, 280)}
              depth={regionField.entry.depth}
              expression={regionField.entry.cut?.depthExpression}
              thickness={part.thickness - regionField.entry.from}
              variables={variableScope}
              onClose={() => {
                setRegionField(null);
                svg.current?.focus();
              }}
              onChoose={(depth, expression) => {
                const next = withRegionDepth(documentRef.current, part.id, regionField.entry, depth, expression);
                if (next !== documentRef.current) commit(next);
                setRegionField(null);
                svg.current?.focus();
              }}
            />
          )}
          <ShortcutList
            tabs={studioSession ? studioShortcuts : sketchShortcutTabs}
            initial={studioSession && showWorkspace ? 'General' : 'Sketch'}
            open={shortcutsOpen}
            onOpenChange={setShortcutsOpen}
          />
          {palette && !searchMode && (
            <div className="cad-command-palette cad-quick-tools">
              <h3>Sketch tools</h3>
              {tools.map(t => (
                <button type="button" key={t.id} onClick={() => chooseTool(t.id)}>
                  {t.label}
                  <kbd>{t.key}</kbd>
                </button>
              ))}
            </div>
          )}
          {palette && searchMode && studioSession && showWorkspace && (
            // In the studio the search is of its commands; in a sketch, of the sketch's tools.
            <StudioCommandSearch
              disabled={studioDisabled}
              workspace={root}
              onOpenChange={setPalette}
              onCommand={studioCommand}
              onHighlight={setSearchHighlight}
            />
          )}
          {palette && searchMode && !(studioSession && showWorkspace) && (
            <CommandSearch
              commands={sketchSearchCommands}
              onHighlight={setSearchHighlight}
              onClose={(restoreFocus = true) => {
                setPalette(false);
                if (restoreFocus) svg.current?.focus();
              }}
              onChoose={id => {
                setPalette(false);
                if (id === 'construction') toggleConstruction();
                else if (id === 'fix') toggleFix();
                else if (id === 'fit') fit();
                else if (tools.some(t => t.id === id)) {
                  if (id === 'dimension') beginDimension();
                  else chooseTool(id as SketchTool);
                } else constrain(id as ConstraintTool);
                svg.current?.focus();
              }}
            />
          )}
          {polygonTool && (
            <SketchPolygonForm
              inputRef={polygonInput}
              sides={polygonSides}
              canCreate={!!pending[1]}
              onSides={value => {
                setPolygonSides(value);
                if (pending[0])
                  polygonCountGesture.current = {
                    sides: Number(value),
                    radius: Math.hypot(cursor.x - pending[0].x, cursor.y - pending[0].y),
                  };
              }}
              onCreate={() => {
                if (pending[1]) addShape(pending[1]);
              }}
              onEscape={() => chooseTool('select')}
            />
          )}
          <SketchCommandControls
            tool={tool}
            selected={selected}
            lengthUnit={lengthUnit}
            chooseTool={chooseTool}
            setSelected={setSelected}
            slotPreview={slotPreview}
            linearPreview={linearPreview}
            parsedCircular={parsedCircular}
            parsedLinear={parsedLinear}
            transformPreview={transformPreview}
            chamferPreview={chamferPreview}
            chamferSelection={chamferSelection}
            filletPreview={filletPreview}
            slotWidth={slotWidth}
            setSlotWidth={setSlotWidth}
            slotChain={slotChain}
            setSlotChain={setSlotChain}
            slotWidthField={slotWidthField}
            acceptSlot={acceptSlot}
            circularParameters={circularParameters}
            setCircularParameters={setCircularParameters}
            circularFields={circularFields}
            acceptCircularPattern={acceptCircularPattern}
            linearParameters={linearParameters}
            setLinearParameters={setLinearParameters}
            patternFields={patternFields}
            acceptLinearPattern={acceptLinearPattern}
            patternNotice={patternNotice}
            transformParameters={transformParameters}
            setTransformParameters={setTransformParameters}
            acceptTransform={acceptTransform}
            transformNotice={transformNotice}
            splitNotice={splitNotice}
            chamferDistances={chamferDistances}
            setChamferDistances={setChamferDistances}
            acceptChamfer={acceptChamfer}
            filletInput={filletInput}
            filletRadius={filletRadius}
            setFilletRadius={setFilletRadius}
            setFilletEditing={setFilletEditing}
            acceptFillet={acceptFillet}
          />
          {conicEditing && (
            <SketchConicRhoForm inputRef={rhoInput} rho={rho} onRho={setRho} onApply={applyConicRho} onClose={() => chooseTool('select')} />
          )}
          {currentDimension && numeric(currentDimension) && (
            <SketchDimensionEditor
              dimension={currentDimension}
              inputRef={dimensionInput}
              style={dimensionEditorPosition}
              onApply={applyDimensionValue}
              onCancel={cancelDimensionEdit}
            />
          )}
          {pending[0] && (tool === 'rectangle' || tool === 'centerRectangle' || tool === 'circle') && (
            <SketchShapeSizeForm
              from={pending[0]}
              rectangle={tool === 'rectangle' || tool === 'centerRectangle'}
              width={width}
              height={height}
              radius={radius}
              onWidth={setWidth}
              onHeight={setHeight}
              onRadius={setRadius}
              onCreate={() => addShape()}
            />
          )}
          <div className="cad-canvas-footer">
            <span>
              {formatLength(cursor.x)}, {formatLength(cursor.y)} {lengthUnit}
            </span>
            <span>
              {sketchBackdrop
                ? 'Scroll to zoom · middle-drag to pan · right-drag to turn · N to look straight at it · U uses parts’ edges and vertices'
                : 'Scroll to zoom · right-drag to pan'}
            </span>
            {sketch && (
              <SelectionReadout
                sketch={sketch}
                selectedIds={dimensionSelection}
                picks={dimensionFlow.phase === 'idle' ? selectionHints.current : dimensionFlow.pickHints}
              />
            )}
          </div>
        </main>
      </div>
      {sketch && (
        <SketchContextMenu
          sketch={sketch}
          context={contextMenu}
          busy={busy || solving}
          onClose={() => setContextMenu(null)}
          onAction={contextAction}
          onReturnToCanvas={() => svg.current?.focus()}
          {...(studioSession && !showWorkspace && { confirm: { reason: sketchFinishReason, onConfirm: () => closeSketch(true) } })}
        />
      )}
      <footer className="cad-status">
        <span className={openSketchProblems.length && !inProgress ? 'cad-error' : ''}>
          {studioSession && showWorkspace ? (
            // In the studio, a sketch's freedom isn't what's being worked on.
            solving ? (
              'Checking sketch…'
            ) : (
              ''
            )
          ) : (
            <>
              {solving ? 'Checking sketch…' : displayStatus}
              {colorNotice && ` · ${colorNotice}`}
            </>
          )}
        </span>
        {cancelledSketch && (
          // Its own status, outside the instruction line that narrow windows hide, so Restore is always there.
          <span className="cad-restore-sketch" role="status">
            Sketch cancelled.{' '}
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                if (busy) return;
                commit(cancelledSketch.document);
                openSketch(cancelledSketch.partId, cancelledSketch.before);
              }}>
              Restore
            </button>
          </span>
        )}
        <span className="cad-instruction" role="status">
          {cancelledSketch || acceptanceNotice || (studioSession && showWorkspace) ? '' : message}
        </span>
        <span>{saveStatus ?? 'Draft'}</span>
      </footer>
      {!acceptanceNotice && <SketchProblems problems={openSketchProblems} inProgress={inProgress} nothingDrawn={isEmptyDesign(doc)} />}
    </div>
  );
  return <DesignUnitContext value={lengthUnit}>{content}</DesignUnitContext>;
}
