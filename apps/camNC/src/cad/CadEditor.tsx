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
  cancelSketchDimensionEdit,
  selectSketchDimension,
  applySketchCreationValue,
} from './sketchDimensionActions';
import {
  sketchTransformSelectionCenter,
  editSketchPattern,
  acceptSketchSlot,
  acceptSketchTransform,
  openSketchContext,
  keyboardSketchContext,
  toggleSketchFix,
  fixSketchGeometry,
  toggleSketchConstruction,
  takeSketchEdges,
  sketchDoubleClick,
} from './sketchCommandActions';
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
import { DesignUnitContext, useDesignUnits } from './designUnits';
import { useSketchCommandPreviews } from './useSketchCommandPreviews';
import { SketchCommandControls } from './SketchCommandControls';
import { initialCircularPatternParameters } from './circularPatternParameters';
import {
  visibleSketchPointIds,
  type CadDimension,
  type CadDocument,
  type CadDrawnOn,
  type CadSketch,
  type CadPoint,
  cadVariableProblems,
  drawnOnOutline,
  resolveExtrudeSteps,
} from '@wbcnc/cad';
import { useEffect, useLayoutEffect, useMemo, useCallback, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import { acquireCadKeyboard } from '@wbcnc/cad-editor/keyboardOwnership';
import {
  cadSession,
  commitCadSession,
  markCadSession,
  redoCadSession,
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
import { type CreationValues } from './creationValues';
import { initialLinearPatternParameters, type LinearPatternParameters } from './linearPatternParameters';
import { initialTransformParameters } from './transformParameters';
import { SketchDrawing } from './SketchDrawing';
import { sketchPlaneName } from './drawnOnName';
import { SketchContextMenu } from './SketchContextMenu';
import {
  type SketchContext,
  type SketchContextAction,
  type SketchContextPress,
  type SketchContextTarget,
} from '@wbcnc/cad-editor/sketchContext';
import { type CadSnapResult } from '@wbcnc/cad-editor/picking';
import { type CadDrawingInference } from '@wbcnc/cad-editor/drawingInference';
import { addDrawingRelations } from '@wbcnc/cad-editor/drawingCommit';
import { type InferredLineAxis } from './lineInference';
import { cadViewState, saveCadViewState } from '@wbcnc/cad-editor/viewState';
import { loadShownState, saveShownState } from './shownState';
import { type CadSelectionBox } from './boxSelection';
import { type AnnotationGesture, type BoxGesture, type ChainAnchor, type DragGesture, type HandleDrag } from './editorGestures';
import { isEmptyDesign } from '@wbcnc/cad-editor/sketchFeedback';
import { isDemoMode } from '@/lib/demo/demo-mode';
import { type SearchCommand } from './CommandSearch';
import { SketchToolbar } from './SketchToolbar';
import { type CutRegion } from './cutRegions';
import { sketchTools as tools } from './sketchTools';
import { idleModificationWorkflow, type ModificationWorkflow } from '@wbcnc/cad-editor/modificationWorkflow';
import { useSvgPixelScale } from './sketchAppearance';
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
import type { PatternOpening } from './partPatternKind';
import { startExtrude } from './studioExtrude';
import { builtStudioParts, disabledStudioCommands, isBlankDesign, listedStudioParts, studioListSource } from './studioParts';
import { applyFramed } from './insertFraming';
import { usePartCutSelection } from './usePartCutSelection';
import { usePartIsolation } from './usePartIsolation';
import { StudioSketchDialog } from './StudioSketchDialog';
import { openSketchFinishReason, sketchPendingFinishReason } from './sketchPendingFinishReason';
import { usePointPicker } from './pointPicker';
import { hasOutline, isSingleLine, replacePart } from './editorHelpers';
import { useFeaturePreview } from './useFeaturePreview';
import { SketchProblems } from './SketchProblems';
import type { FeatureAction, FeatureEntry } from './FeatureList';
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
import { projectSketchPoint, focusSketchCanvas } from './sketchViewport';
import { faceSketchHost } from './faceSketchHost';
import { useExtrudeDepth } from './useExtrudeDepth';
import { bindPartCorners } from './partCornerInference';
import type { CadConnectorPick } from './PartFeatureDialogs';
import { StudioDialogHost } from './StudioDialogHost';
import { dialogCommand, featureDialog, picksParts, previewOwner, sameDialogShown, type StudioDialog } from './studioDialog';
import { usePatternVariableCommit } from './studioPatternVariableSource';
import { useStudioPreview } from './useStudioPreview';
import { useEditorDocumentKeys } from './useEditorDocumentKeys';
import { useEditorKeyboardFocus } from './useEditorKeyboardFocus';
import { useSketchCanvasBox, useSketchWheelZoom } from './useSketchCanvasViewport';
import { useSketchCheck } from './useSketchCheck';
import { sketchCheckDisplay } from './sketchCheckDisplay';
import { useEditorAcceptance } from './useEditorAcceptance';
import { editedStep, useEditorVariableFields } from './useEditorVariableFields';
import { useFeatureShown, withMadeSketchHidden } from './useFeatureShown';
import { CadSketchOverlays } from './CadSketchOverlays';
import { CadCanvasBar, CadPartPane, CadSketchBackdropPane, CadWorkspacePane } from './CadDrawingPanes';
import { CadEditorSidebar, CadPartsPanel, CadStatusFooter } from './CadEditorSidebar';
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
  const [checkEpoch, setCheckEpoch] = useState(0);
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
  const stepDialogOpen = !!dialog;
  const partPicking = picksParts(dialog);
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
  // Where the drawing sits in its pane, for the parts shown behind a sketch to line up with it.
  const canvasBox = useSketchCanvasBox(svg, showWorkspace, show3D);
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
  const { viewWantsKeyboard, focusViewIfIdle, dialogFocus, restoreCanvasKeyboard } = useEditorKeyboardFocus({
    root,
    svg,
    busy,
    stepDialogOpen,
    studioSession,
    showWorkspace,
    show3D,
  });
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
  useSketchWheelZoom(svg, drawingGroup, setView);
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

  const { conflictedConstraints, status, problems, sketchProblems, featureProblems, unbuiltParts, inProgress, solving, sketchStatuses } =
    useSketchCheck({
      doc,
      session,
      checkEpoch,
      sketchOnly,
      lastCheckedRevision,
      finishing,
      drag,
      annotationDrag,
      documentRef,
      setDocument,
      callbacks,
      normalizePatternVariableSource,
      solveFeedback,
    });

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

  const cancelDimensionEdit = () => cancelSketchDimensionEdit(sketchEditorInput());
  const selectDimension = (id: string, additive = false) => selectSketchDimension(sketchEditorInput(), id, additive);
  const editDimension = (id: string) => editSketchDimension(sketchEditorInput(), id);
  const startAnnotationDrag = (id: string, event: PointerEvent<SVGGElement>) => startSketchAnnotationDrag(sketchEditorInput(), id, event);
  const transformSelectionCenter = (ids: readonly string[]) => sketchTransformSelectionCenter(sketchEditorInput(), ids);
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
  const applyCreationValue = (options?: { advance?: boolean }) => applySketchCreationValue(sketchEditorInput(), options);
  const finishSpline = (keepTool = false) => finishSketchSpline(sketchEditorInput(), keepTool);
  const editPattern = (id: string) => editSketchPattern(sketchEditorInput(), id);
  const acceptSlot = () => acceptSketchSlot(sketchEditorInput());
  const acceptCircularPattern = () => acceptSketchCircularPattern(sketchEditorInput());
  const acceptLinearPattern = () => acceptSketchLinearPattern(sketchEditorInput());
  const acceptTransform = () => acceptSketchTransform(sketchEditorInput());
  const acceptChamfer = () => acceptSketchChamfer(sketchEditorInput());
  const acceptFillet = () => acceptSketchFillet(sketchEditorInput());
  const acceptOffset = () => acceptSketchOffset(sketchEditorInput());
  const applyConicRho = () => applySketchConicRho(sketchEditorInput());
  const removeSelected = (entityIds: readonly string[] = selected, constraintIds: readonly string[] = selectedConstraints) =>
    removeSketchSelection(sketchEditorInput(), entityIds, constraintIds);
  const openContext = (target: SketchContextTarget, position: Point) => openSketchContext(sketchEditorInput(), target, position);
  const contextTarget = (target: Element, position: Point) => sketchContextTarget(sketchEditorInput(), target, position);
  const keyboardContext = () => keyboardSketchContext(sketchEditorInput());
  const contextAction = (action: SketchContextAction, context: SketchContext) => sketchContextAction(sketchEditorInput(), action, context);
  const placeDimension = (placed: CadDimension) => placeSketchDimension(sketchEditorInput(), placed);
  const applyDimensionEvent = (event: DimensionWorkflowEvent) => applySketchDimensionEvent(sketchEditorInput(), event);
  const beginDimension = () => beginSketchDimension(sketchEditorInput());
  const constrain = (type: ConstraintTool) => constrainSketch(sketchEditorInput(), type);
  const toggleFix = () => toggleSketchFix(sketchEditorInput());
  /** Fixes the points of `targets`, or unfixes them when they are all fixed already. */
  const fixGeometry = (targets: string[]) => fixSketchGeometry(sketchEditorInput(), targets);
  const toggleConstruction = () => toggleSketchConstruction(sketchEditorInput());
  const keyDown = (event: KeyboardEvent<HTMLDivElement>) =>
    cadEditorKeyDown(
      {
        ...sketchEditorInput(),
        applyCreationValue,
        beginDimension,
        constrain,
        finishSpline,
        hoveredPart,
        isolatePart,
        keyboardContext,
        navigateHistory,
        partHasOutline,
        pointerEnd,
        polygonInput,
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
    creationInput,
    creationValues,
    currentDimension,
    cursor,
    dimension,
    dimensionDraft,
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
    selectedConstraints,
    selectionHints,
    session,
    setBusy,
    setChain,
    setChamferDistances,
    setCircularParameters,
    setConicEditing,
    setConstraintMode,
    setConstruction,
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
    setUseNotice,
    setUsingEdges,
    setView,
    shownSketch,
    sketch,
    sketchBackdrop,
    sketchTurn,
    slotPreview,
    snap,
    solveDrag,
    solving,
    splitFirst,
    svg,
    takeEdges,
    tangentAxis,
    tool,
    transformPreview,
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
  const { prepareDocument, finish, cancel } = useEditorAcceptance({
    controller,
    session,
    docId: doc.id,
    documentRef,
    callbacks,
    busy,
    setBusy,
    solving,
    finishing,
    preparingDimension,
    thicknessValid,
    pendingFinishReason,
    applyPendingValues,
    lineContinuation,
    setPending,
    setFinishError,
    setMessage,
    requestSketchCheck,
    restoreCanvasKeyboard,
    publish,
    commit,
    userRollback,
  });
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
  const offsetDimension = offsetPreview?.ok
    ? (offsetPreview.sketch.constraints.find(c => c.id === offsetPreview.dimensionId && numeric(c)) as NumericConstraint | undefined)
    : undefined;
  const variableProblems = cadVariableProblems(doc);
  const { activeSketchStatus, shownConflicts, openSketchProblems, displayStatus, colorNotice, entityStatus, stroke } = sketchCheckDisplay({
    doc,
    partId: part?.id,
    sketch,
    sketchStatuses,
    conflictedConstraints,
    variableConstraintIds: variableProblems.flatMap(problem => problem.constraintIds ?? []),
    problems,
    sketchProblems,
    status,
    inProgress,
    solving,
    lastCheckedRevision: lastCheckedRevision.current,
    studioSketchOpen: studioSession && !showWorkspace,
    previewing: !!drag.current || !!cornerPreview?.ok || !!transformPreview?.ok || !!linearPreview?.ok || !!slotPreview?.ok,
  });
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
  const takeEdges = (keys = pickedEdges) => takeSketchEdges(sketchEditorInput(), keys);
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
    <CadPartsPanel
      {...{
        doc,
        studioSession,
        physicalPartCount,
        part,
        commit,
        setPartId,
        setSelected,
        chooseTool,
        userRollback,
        onEditFaceSketch,
        faceEditor,
        documentRef,
        setStudioRefusal,
        faceSketch,
        builtParts,
        cutSelection,
        hiddenParts,
        setHiddenParts,
        transparentParts,
        setTransparentParts,
        variableProblems,
        sketchStatuses,
        setSelectedFace,
        partPicking,
        showWorkspace,
      }}
    />
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
        <CadEditorSidebar
          {...{
            faceSketch,
            studioSession,
            documentRef,
            commit,
            setStudioRefusal,
            showWorkspace,
            doc,
            part,
            selectedStepId,
            profiles,
            setSketchRowPicked,
            setSelectedFace,
            dialog,
            cutSelection,
            setSelected,
            featureAction,
            rollbackStep,
            setRolledTo,
            setHoveredStepParts,
            selectedPlane,
            pickPlane,
            newSketchOn,
            featureShown,
            featureProblems,
            choosingFace,
            userRollback,
            studioPreview,
            setFeatureVisibility,
            partsPanel,
            variableScope,
            variableProblems,
            svg,
            setThicknessValid,
            setDirectionPicker,
            setPartId,
            chooseTool,
            onEditFaceSketch,
            faceEditor,
            showConstraints,
            setShowConstraints,
            setHoveredConstraintEntities,
            tool,
            placingDimension,
            dimension,
            dimensionMode,
            applyDimensionEvent,
            selected,
            setRho,
            setConicEditing,
          }}
        />
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
            onDoubleClick={event => sketchDoubleClick(sketchEditorInput(), event)}
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
          <CadSketchOverlays
            commandControls={
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
            }
            {...{
              acceptOffset,
              addShape,
              applyConicRho,
              applyCreationValue,
              applyDimensionValue,
              beginDimension,
              cancelDimensionEdit,
              chooseTool,
              commit,
              conicEditing,
              constrain,
              creationInput,
              creationValues,
              currentDimension,
              cursor,
              dimensionFlow,
              dimensionInput,
              dimensionSelection,
              doc,
              documentRef,
              drawingGroup,
              fit,
              formatLength,
              height,
              lengthText,
              lengthUnit,
              markerScale,
              modification,
              offsetDimension,
              offsetInput,
              offsetPreview,
              palette,
              part,
              pending,
              polygonCountGesture,
              polygonInput,
              polygonSides,
              polygonTool,
              radius,
              regionField,
              rho,
              rhoInput,
              root,
              searchMode,
              selectionHints,
              setCreationValues,
              setHeight,
              setMessage,
              setModification,
              setPalette,
              setPolygonSides,
              setRadius,
              setRegionField,
              setRho,
              setSearchHighlight,
              setSelected,
              setShortcutsOpen,
              setWidth,
              shortcutsOpen,
              showWorkspace,
              sketch,
              sketchBackdrop,
              studioCommand,
              studioDisabled,
              studioSession,
              svg,
              toggleConstruction,
              toggleFix,
              tool,
              variableScope,
              width,
            }}
          />
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
      <CadStatusFooter
        {...{
          openSketchProblems,
          inProgress,
          studioSession,
          showWorkspace,
          solving,
          displayStatus,
          colorNotice,
          cancelledSketch,
          busy,
          commit,
          openSketch,
          acceptanceNotice,
          message,
          saveStatus,
        }}
      />
      {!acceptanceNotice && <SketchProblems problems={openSketchProblems} inProgress={inProgress} nothingDrawn={isEmptyDesign(doc)} />}
    </div>
  );
  return <DesignUnitContext value={lengthUnit}>{content}</DesignUnitContext>;
}
