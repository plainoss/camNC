import {
  initialView,
  numeric,
  type ConstraintTool,
  type DimensionMode,
  type NumericConstraint,
  type Point,
  type Tool,
  type View,
} from './cadEditorShared';
import type { SketchEditorInput } from './sketchEditorInput';
import { sketchPointerDown } from './sketchPointerDown';
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
  acceptSketchOffset,
  applySketchConicRho,
  removeSketchSelection,
  constrainSketch,
  sketchContextAction,
} from './sketchModifyActions';
import { DesignUnitContext, useDesignUnits } from './designUnits';
import { SketchSlotControls, SketchSlotWidthHandle } from './SketchSlotControls';
import { previewSlot } from './slotPreview';
import { SketchCircularPatternControls, SketchCircularPatternManipulator } from './SketchCircularPatternControls';
import {
  initialCircularPatternParameters,
  circularPatternParameters,
  parseCircularPatternParameters,
  type CircularPatternParameters,
} from './circularPatternParameters';
import {
  withCadLengthUnit,
  addBezier,
  addConic,
  addConstraint,
  addSpline,
  createCadPart,
  dimensionValueError,
  entityPointIds as curvePointIds,
  filletLineCorners,
  chamferLineCorners,
  transformSketchEntities,
  linearPatternSketchEntities,
  circularPatternSketchEntities,
  resolveChamferCorners,
  extendSketchCurve,
  mirrorSketchEntities,
  offsetSketch,
  resolveFilletCorners,
  tessellateCurve,
  updateDimension,
  visibleSketchPointIds,
  withDimensionPlacement,
  type CadDimension,
  type CadDocument,
  type CadDrawnOn,
  type CadSketch,
  type CadSketchSolveStatus,
  moveFaceSketch,
  removeCadFeature,
  removeCadVariable,
  removeDatumPlane,
  removeEdgeFillet,
  splitApartRegions,
  cadCopyName,
  setCutDepth,
  setCutSuppressed,
  withFeatureVersion,
  type CadPoint,
  cadVariableProblems,
  drawnOnOutline,
  cadFaceFrame,
  cadSketchFrame,
  isCadPart,
  resolveExtrudeSteps,
  addPartCut,
  updatePartCut,
  removePartCut,
  setPartPattern,
  renamePartCopy,
} from '@wbcnc/cad';
import {
  useEffect,
  Suspense,
  lazy,
  useLayoutEffect,
  useImperativeHandle,
  useMemo,
  useCallback,
  useRef,
  useState,
  type CSSProperties,
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
  redoCadSession,
  undoCadSession,
  type CadCommandCheckpoint,
} from '@wbcnc/cad-editor/session';
import { DimensionGraphics } from './DimensionGraphics';
import {
  idleDimensionWorkflow,
  transitionDimensionWorkflow,
  type DimensionWorkflow,
  type DimensionWorkflowEvent,
} from '@wbcnc/cad-editor/dimensionWorkflow';
import { idleDrawingGesture, type DrawingGesture } from '@wbcnc/cad-editor/drawingGesture';
import { advanceCreationValue, creationValueAnchor, creationValueAt, type CreationValues } from './creationValues';
import { CreationValueControls } from './CreationValueControls';
import {
  SketchChamferForm,
  SketchConicRhoForm,
  SketchDimensionEditor,
  SketchFilletForm,
  SketchPolygonForm,
  SketchShapeSizeForm,
} from './SketchValueForms';
import { SketchLinearPatternControls, SketchLinearPatternManipulator } from './SketchLinearPatternControls';
import {
  initialLinearPatternParameters,
  linearPatternParameters,
  parseLinearPatternParameters,
  linearPatternAnchor,
  editablePatternSources,
  type LinearPatternParameters,
} from './linearPatternParameters';
import { SketchTransformControls, SketchTransformManipulator } from './SketchTransformControls';
import {
  initialTransformParameters,
  parseTransformParameters,
  repositionTransformPivot,
  type TransformParameters,
  type TransformDragKind,
} from './transformParameters';
import { SelectionReadout } from './SelectionReadout';
import { CadThicknessField } from './CadThicknessField';
import { CadVariablesPanel } from './CadVariablesPanel';
import { DesignStepsList } from './DesignStepsList';
import { PartCutDialog } from './PartCutDialog';
import { CadDrawnOnField } from './CadDrawnOnField';
import { drawnOnName } from './drawnOnName';
import { CadReliefField } from './CadReliefField';
import { CadPartPatternField } from './CadPartPatternField';
import { CadCopyNames } from './CadCopyNames';
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
import { DrawingInferencePreview } from './DrawingInferencePreview';
import { type InferredLineAxis } from './lineInference';
import { cadViewState, saveCadViewState } from '@wbcnc/cad-editor/viewState';
import { loadShownState, saveShownState } from './shownState';
import { type CadSelectionBox } from './boxSelection';
import { chainGeometry, type AnnotationGesture, type BoxGesture, type ChainAnchor, type DragGesture } from './editorGestures';
import { constraintColorNotice, sketchDofStatus, sketchFeedback } from '@wbcnc/cad-editor/sketchFeedback';
import { isDemoMode } from '@/lib/demo/demo-mode';
import { CommandSearch, type SearchCommand } from './CommandSearch';
import { SketchToolbar } from './SketchToolbar';
import { withRegionDepth, type CutRegion } from './cutRegions';
import { CutOverlay } from './CutOverlay';
import { PartFeatureList } from './PartFeatureList';
import { RegionDepthField } from './RegionDepthField';
import { sketchTools as tools, type SketchTool } from './sketchTools';
import { SketchGeometry } from './SketchGeometry';
import { SketchRegion } from './SketchRegion';
import { SketchToolPreview } from './SketchToolPreview';
import { ModificationControls } from './ModificationControls';
import { ModificationPreview } from './ModificationPreview';
import { idleModificationWorkflow, transitionModification, type ModificationWorkflow } from '@wbcnc/cad-editor/modificationWorkflow';
import { useSvgPixelScale, SKETCH_APPEARANCE, sketchStrokeColor } from './sketchAppearance';
import { InlineConstraints } from './inlineConstraints';
import { associatedEntityIds } from '@wbcnc/cad-editor/inlineConstraintLayout';
import { StudioToolbar, type StudioCommand } from './StudioToolbar';
import { StudioCommandSearch } from './StudioCommandSearch';
import type { PartPatternKind } from './partPatternKind';
import { featureRowParts, selectStudioFeature } from './studioFeatureSelection';
import { startExtrude } from './studioExtrude';
import { builtStudioParts, disabledStudioCommands, isBlankDesign, listedStudioParts } from './studioParts';
import { applyFramed } from './insertFraming';
import { usePartCutSelection } from './usePartCutSelection';
import { usePartIsolation } from './usePartIsolation';
import { FeatureDialog } from './FeatureDialog';
import { StudioSketchDialog } from './StudioSketchDialog';
import { sketchPendingFinishReason } from './sketchPendingFinishReason';
import { PartsList } from './PartsList';
import { toggledKey } from './toggledKey';
import { usePointPicker } from './pointPicker';
import { ShortcutList } from './ShortcutList';
import { sketchShortcuts, studioShortcuts, studioSketchShortcuts } from './shortcuts';
import { sketchSearchCommands } from './sketchSearchCommands';
import { toggleFixed } from './sketchFix';
import { editable, hasOutline, isSingleLine, replacePart, withoutExtrude } from './editorHelpers';
import { startHole } from './holeSource';
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
import { basePlaneViews, pickedPlane, planeOffsetFrom } from './basePlanes';
import { studioNormalView } from './studioNormalView';
import type { ViewRequest } from '@/cam/model/ModelViewport';
import { designSteps, trimCadFolders, type DesignStep } from '@wbcnc/cad';
import { toggleSuppressed } from './toggleSuppressed';
import type { PartEdge } from './partEdges';
import { drawingMatrix, normalTurn, straightOn, type SketchTurn } from './sketchOrbit';
import { captureSketchCamera, carriedSketchCamera, type StudioCameraState } from './studioCamera';
import { studioViewShortcut } from './studioViewShortcut';
import { sketchBackdropView } from './sketchBackdropView';
import { initialFaceSketchView, assemblyCameraFromPart } from './faceSketchScene';
import { useFaceSketchCamera } from './useFaceSketchCamera';
import { fitSketchView, pointsOf } from './fitSketchView';
import { sketchValuePosition, projectSketchPoint, focusSketchCanvas, creationEditorPositions } from './sketchViewport';
import { addUsedPartEdges } from './partEdgeUse';
import { PartReferenceGeometry } from './PartReferenceGeometry';
import { faceSketchHost } from './faceSketchHost';
import { useExtrudeDepth } from './useExtrudeDepth';
import { bindPartCorners } from './partCornerInference';
import { newSketchPart } from './newSketchPart';
import type { CadConnectorPick } from './PartFeatureDialogs';
import { StudioFeatureDialog, type StudioFeatureDialogState } from './StudioFeatureDialog';
import { usePatternVariableCommit } from './studioPatternVariableSource';
import { StudioStepDialogs } from './StudioStepDialogs';
import { prepareStudioPreview, useStudioPreview } from './useStudioPreview';
import { useEditorDocumentKeys } from './useEditorDocumentKeys';
import { useEditorVariableFields } from './useEditorVariableFields';
import { useFeatureShown } from './useFeatureShown';
import './cad.css';

const FaceSketchBackdrop = lazy(() => import('./FaceSketchBackdrop'));
const PartView3D = lazy(() => import('./PartView3D'));
const WorkspaceView = lazy(() => import('./WorkspaceView'));
const SketchBackdrop = lazy(() => import('./SketchBackdrop'));

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
  faceSketch,
  startIn3D,
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
  const dimensionDraft = dimensionFlow.phase === 'placing' && !dimensionFlow.existingConstraintId ? dimensionFlow.preview : null;
  const dimensionSelection = dimensionFlow.phase === 'idle' ? selected : dimensionFlow.entityIds;
  const [palette, setPalette] = useState(false);
  const [searchMode, setSearchMode] = useState(true);
  const toggleCommandSearch = () => {
    setSearchMode(true);
    setPalette(value => !value);
  };
  const [searchHighlight, setSearchHighlight] = useState<SearchCommand['id'] | null>(null);
  const [status, setStatus] = useState('Checking sketch…');
  const [problems, setProblems] = useState<string[]>([]);
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
  const slotDrag = useRef<{ center: CadPoint; width: string } | null>(null);
  const [circularParameters, setCircularParameters] = useState(initialCircularPatternParameters);
  const circularFields = useRef<Partial<Record<'count' | 'angle', HTMLInputElement>>>({});
  const circularDrag = useRef<{
    kind: 'center' | 'sweep';
    start: CadPoint;
    parameters: CircularPatternParameters;
    last: number;
    sweep: number;
  } | null>(null);
  const [linearParameters, setLinearParameters] = useState(() => initialLinearPatternParameters(lengthUnit));
  const [patternEditId, setPatternEditId] = useState<string | null>(null);
  const [patternNotice, setPatternNotice] = useState('');
  const patternCommandId = useRef('');
  const patternFields = useRef<Partial<Record<Exclude<keyof LinearPatternParameters, 'secondDirection'>, HTMLInputElement>>>({});
  const patternDrag = useRef<{ index: number; anchor: CadPoint; parameters: LinearPatternParameters } | null>(null);
  const [transformParameters, setTransformParameters] = useState(() => initialTransformParameters(undefined, lengthUnit));
  const [transformNotice, setTransformNotice] = useState('');
  const transformDrag = useRef<{ kind: TransformDragKind; start: CadPoint; parameters: TransformParameters } | null>(null);
  const [splitNotice, setSplitNotice] = useState('');
  const [splitFirst, setSplitFirst] = useState<{ entityId: string; parameter: number; point: CadPoint } | null>(null);
  const chamferDrag = useRef<{ side: number; origin: CadPoint; direction: CadPoint; previous: string[] } | null>(null);
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
  const [showPlanes, setShowPlanes] = useState(true);
  // A "cut parts" step being added, or the one being changed.
  const [partCutting, setPartCutting] = useState<{ id?: string } | null>(null);
  const cutSelection = usePartCutSelection(doc, part, setPartId);
  // A part's step open in its dialog, with the design as it was when it opened, to go back to on cancel.
  const [featureDialog, setFeatureDialog] = useState<StudioFeatureDialogState | null>(null);
  // Picking the plane or face a new part is sketched on.
  // A new design opens with nothing picked or asked for: the first sketch starts from the toolbar, as in the reference.
  const [choosingFace, setChoosingFace] = useState(false);
  // A base plane picked in the studio, in its view or feature list, for the next sketch to be drawn on.
  // A base plane, or one of the design's planes, by its id.
  const [selectedPlane, setSelectedPlane] = useState<string | null>(null);
  // A dialog waiting for a plane or face to be picked for a direction, as the Transform dialog's Direction box.
  const [directionPicker, setDirectionPicker] = useState<((on: CadDrawnOn['on'], datum?: string) => void) | null>(null);
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
  const studioCamera = useRef<StudioCameraState | null>(null);
  const ownPartCamera = useRef<StudioCameraState | null>(null);
  const partCameraState = suppliedPartCamera ?? ownPartCamera;
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
  // A variable being added, or the one being changed.
  const [variableDialog, setVariableDialog] = useState<{ id?: string } | null>(null);
  const [planeDialog, setPlaneDialog] = useState<{ id?: string; preselected?: CadDrawnOn['on'] } | null>(null);
  const [mirrorDialog, setMirrorDialog] = useState<{ partId: string; copyId?: string } | null>(null);
  const [filletDialog, setFilletDialog] = useState<{ partId?: string; filletId?: string } | null>(null);
  // Why something asked for in the studio wasn't done, such as deleting a variable that's in use.
  const [studioRefusal, setStudioRefusal] = useState<string | null>(null);
  // A part being copied by a transform, or the transformed copy being changed.
  const [transformDialog, setTransformDialog] = useState<{ partId: string; copyId?: string; move?: boolean } | null>(null);
  // When a step's dialog closes, the view has the keyboard again, so its shortcuts work straight away.
  const stepDialogOpen = !!(featureDialog || variableDialog || planeDialog || mirrorDialog || transformDialog || partCutting);
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
  const sketchBefore = useRef<CadDocument | null>(studioSession && !showWorkspace ? doc : null);
  const [cancelledSketch, setCancelledSketch] = useState<{
    document: CadDocument;
    partId: string;
    before: CadDocument;
  } | null>(null);
  useEffect(() => {
    if (!cancelledSketch) return;
    const timer = setTimeout(() => setCancelledSketch(null), 12_000);
    return () => clearTimeout(timer);
  }, [cancelledSketch]);
  useEffect(() => {
    // Accepting the design, or anything else that makes the editor busy, saves what's there: a restore can't race it.
    if (busy || !showWorkspace || choosingFace || featureDialog || partCutting || variableDialog || transformDialog)
      setCancelledSketch(null);
  }, [busy, showWorkspace, choosingFace, featureDialog, partCutting, variableDialog, transformDialog]);
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
  const { commit: variableCommit, normalized: normalizePatternVariableSource } = usePatternVariableCommit(
    featureDialog,
    documentRef,
    next => commit(next)
  );
  const variableScope = useEditorVariableFields(doc, documentRef, variableCommit);
  const blankDesign = studioSession && isBlankDesign(doc);
  const extrusionDepth = useExtrudeDepth(doc, featureDialog?.kind === 'extrude' ? featureDialog.partId : undefined, next => commit(next));
  const studioPreview = useStudioPreview(
    doc,
    transformDialog ??
      variableDialog ??
      planeDialog ??
      mirrorDialog ??
      filletDialog ??
      partCutting ??
      (featureDialog?.kind === 'pattern' ? featureDialog : null)
  );
  const [mateConnectors, setMateConnectors] = useState<{ from?: CadConnectorPick; to?: CadConnectorPick }>({});
  const { rollbackStep, userRollback, shownDocument, pastRollback, solveFeedback, apartIds } = useFeaturePreview({
    document:
      pointPicker.onPick && transformDialog ? doc : studioPreview.document === doc ? extrusionDepth.document : studioPreview.document,
    enabled: studioSession && showWorkspace,
    blank: blankDesign,
    rolledTo,
    featureDialog,
    partCutting,
    transformDialog,
    mirrorDialog,
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
  const filletSelection = useMemo(
    () => (sketch && tool === 'fillet' ? resolveFilletCorners(sketch, selected) : null),
    [sketch, tool, selected]
  );
  const filletPreview = useMemo(() => {
    if (!sketch || !filletSelection?.ok) return null;
    const radius = parseCadValue(filletRadius, { unit: 'mm', variables: variableScope });
    return 'error' in radius
      ? { ok: false as const, message: radius.error, cornerPointIds: filletSelection.cornerPointIds }
      : filletLineCorners(sketch, { cornerPointIds: filletSelection.cornerPointIds, radius: radius.value });
  }, [sketch, filletSelection, filletRadius, variableScope, parseCadValue]);
  const chamferSelection = useMemo(
    () => (sketch && tool === 'chamfer' ? resolveChamferCorners(sketch, selected) : null),
    [sketch, tool, selected]
  );
  const chamferPreview = useMemo(() => {
    if (!sketch || !chamferSelection?.ok) return null;
    const values = chamferDistances.map(value => parseCadValue(value, { unit: 'mm', variables: variableScope }));
    const error = values.find(value => 'error' in value);
    return error && 'error' in error
      ? { ok: false as const, message: error.error, cornerPointIds: chamferSelection.cornerPointIds }
      : chamferLineCorners(sketch, {
          cornerPointIds: chamferSelection.cornerPointIds,
          distanceA: (values[0] as { value: number }).value,
          distanceB: (values[1] as { value: number }).value,
          selectedLineIds: selected,
        });
  }, [sketch, chamferSelection, chamferDistances, selected, variableScope, parseCadValue]);
  const cornerPreview = tool === 'chamfer' ? chamferPreview : filletPreview;
  const parsedTransform = useMemo(() => parseTransformParameters(transformParameters, lengthUnit), [transformParameters, lengthUnit]);
  const transformPreview = useMemo(() => {
    if (!sketch || tool !== 'transform' || !selected.length) return null;
    return parsedTransform.ok ? transformSketchEntities(sketch, { ...parsedTransform, entityIds: selected }) : parsedTransform;
  }, [sketch, tool, selected, parsedTransform]);
  const parsedCircular = useMemo(() => parseCircularPatternParameters(circularParameters, lengthUnit), [circularParameters, lengthUnit]);
  const parsedLinear = useMemo(
    () => parseLinearPatternParameters(linearParameters, variableScope, lengthUnit),
    [linearParameters, variableScope, lengthUnit]
  );
  const linearPreview = useMemo(() => {
    if (!sketch || !selected.length) return null;
    if (tool === 'circularPattern')
      return parsedCircular.ok
        ? circularPatternSketchEntities(sketch, {
            ...parsedCircular,
            entityIds: selected,
            patternId: patternEditId ?? patternCommandId.current,
            previewLimit: 9,
          })
        : parsedCircular;
    if (tool !== 'linearPattern') return null;
    return parsedLinear.ok
      ? linearPatternSketchEntities(sketch, {
          ...parsedLinear,
          entityIds: selected,
          patternId: patternEditId ?? patternCommandId.current,
          previewLimit: 9,
        })
      : parsedLinear;
  }, [sketch, tool, selected, patternEditId, parsedLinear, parsedCircular]);
  const patternAnchor = useMemo(() => (sketch ? linearPatternAnchor(sketch, selected) : { x: 0, y: 0 }), [sketch, selected]);
  const slotPreview = useMemo(
    () =>
      sketch && tool === 'slot' && selected.length
        ? previewSlot(sketch, selected, slotWidth, slotChain, sharedSlotWidth, lengthUnit)
        : null,
    [sketch, tool, selected, slotWidth, slotChain, sharedSlotWidth, lengthUnit]
  );
  const slotWidthCircle = slotPreview?.ok
    ? slotPreview.sketch.entities.find(
        e =>
          e.type === 'circle' &&
          slotPreview.sketch.constraints.some(c => c.type === 'slot' && c.id === slotPreview.slotId && c.widthEntityId === e.id)
      )
    : undefined;
  const slotWidthCenter =
    slotWidthCircle?.type === 'circle' && slotPreview?.ok
      ? slotPreview.sketch.entities.find(e => e.id === slotWidthCircle.centerId)
      : undefined;
  const shownSketch = slotPreview?.ok
    ? slotPreview.sketch
    : linearPreview?.ok
      ? linearPreview.sketch
      : transformPreview?.ok
        ? transformPreview.sketch
        : cornerPreview?.ok
          ? cornerPreview.sketch
          : sketch;
  const annotationSketch = slotPreview?.ok
    ? slotPreview.sketch
    : linearPreview?.ok
      ? linearPreview.sketch
      : transformPreview?.ok
        ? transformPreview.sketch
        : sketch;
  const offsetPreview = useMemo(() => {
    if (!sketch || modification.phase !== 'offset' || !modification.entityIds.length) return null;
    const parsed = parseCadValue(modification.text, { unit: 'mm', variables: variableScope });
    return 'error' in parsed
      ? { ok: false as const, message: parsed.error }
      : offsetSketch(sketch, { entityIds: modification.entityIds, value: parsed.value });
  }, [sketch, modification, variableScope, parseCadValue]);
  const extendPreview = useMemo(
    () =>
      sketch && modification.phase === 'extend' && modification.entityId && modification.end && modifyTarget
        ? extendSketchCurve(sketch, {
            entityId: modification.entityId,
            end: modification.end,
            target: modifyTarget,
            boundaryId: hoveredModifyCurve && hoveredModifyCurve !== modification.entityId ? hoveredModifyCurve : undefined,
          })
        : null,
    [sketch, modification, modifyTarget, hoveredModifyCurve]
  );
  const mirrorPreview = useMemo(
    () =>
      sketch && modification.phase === 'mirror' && modification.picking === 'axis' && modification.entityIds.length && hoveredModifyCurve
        ? mirrorSketchEntities(sketch, { entityIds: modification.entityIds, axisId: hoveredModifyCurve })
        : null,
    [sketch, modification, hoveredModifyCurve]
  );
  const modificationPreview = offsetPreview?.ok
    ? offsetPreview
    : extendPreview?.ok
      ? extendPreview
      : mirrorPreview?.ok
        ? mirrorPreview
        : null;
  const curvePreview = useMemo(() => {
    if (!sketch || !pending.length || !['conic', 'spline', 'bezier'].includes(tool)) return null;
    const locations = [...pending];
    if (Math.hypot(cursor.x - locations.at(-1)!.x, cursor.y - locations.at(-1)!.y) > 1e-7) locations.push(cursor);
    if (locations.length < 2) return null;
    try {
      const parsedRho = parseCadValue(rho, { unit: 'scalar' });
      if (tool === 'conic' && 'error' in parsedRho) return locations;
      const preview =
        tool === 'conic'
          ? locations[2]
            ? addConic(sketch, {
                start: locations[0]!,
                end: locations[1]!,
                control: locations[2]!,
                rho: 'value' in parsedRho ? parsedRho.value : 0.5,
                construction,
              })
            : null
          : (tool === 'spline' ? addSpline : addBezier)(sketch, { points: locations, construction });
      const curve = preview?.entities.at(-1);
      return curve && curve.type !== 'point' ? tessellateCurve(curve, pointsOf(preview!), 0.25 / markerScale) : locations;
    } catch {
      return locations;
    }
  }, [sketch, pending, cursor, tool, rho, construction, markerScale, parseCadValue]);
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
        setProblems(feedback.problems);
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
        setProblems([error instanceof Error ? error.message : String(error)]);
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
      creationValues.editing ? (creationInput.current?.value ?? creationValues.text) : lengthText(current.constraint.value),
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
  const keyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    // Keep native input and button events functional; prevent machine/global bubble handlers from seeing CAD keys.
    event.stopPropagation();
    if (event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229) return;
    if (event.altKey && !event.ctrlKey && !event.metaKey && !event.shiftKey && (event.code === 'KeyC' || event.key.toLowerCase() === 'c')) {
      event.preventDefault();
      if (!event.repeat && !busy) {
        toggleCommandSearch();
      }
      return;
    }
    if (editable(event.target)) return;
    // `?` (Shift+/) lists the shortcuts that work here; keys pressed in that list stay in it.
    if (event.key === '?' && !event.ctrlKey && !event.metaKey && !event.altKey) {
      event.preventDefault();
      if (!event.repeat) setShortcutsOpen(open => !open);
      return;
    }
    if (shortcutsOpen) return;
    if (studioSession && showWorkspace && !event.ctrlKey && !event.metaKey && !event.altKey) {
      if (event.code === 'KeyY') {
        event.preventDefault();
        if (event.repeat) return;
        if (event.shiftKey) {
          setHiddenParts(new Set());
          setTransparentParts(new Set());
        } else {
          const key = hoveredPart.current ?? part?.id;
          if (key) setHiddenParts(previous => (previous.has(key) ? previous : new Set([...previous, key])));
        }
        return;
      }
      if (event.shiftKey && event.code === 'KeyT') {
        event.preventDefault();
        if (event.repeat) return;
        const key = hoveredPart.current ?? part?.id;
        if (key)
          setTransparentParts(previous => {
            const next = new Set(previous);
            if (next.has(key)) next.delete(key);
            else next.add(key);
            return next;
          });
        return;
      }
      if (event.shiftKey && event.code === 'KeyI') {
        event.preventDefault();
        if (event.repeat || !part || !isCadPart(part)) return;
        isolatePart();
        return;
      }
      const name = studioViewShortcut(event);
      if (name) {
        event.preventDefault();
        if (!event.repeat) setViewRequest(previous => ({ name, seq: (previous?.seq ?? 0) + 1 }));
        return;
      }
      if (!event.shiftKey && event.key.toLowerCase() === 'p') {
        event.preventDefault();
        if (!event.repeat) setShowPlanes(previous => !previous);
        return;
      }
      // N looks straight at the picked plane or face, or the selected part's sketch plane; again, from its other side.
      if (!event.shiftKey && event.key.toLowerCase() === 'n') {
        const request = studioNormalView(documentRef.current, selectedPlane, selectedFace, part);
        if (!request) return;
        event.preventDefault();
        if (event.repeat) return;
        setViewRequest(request);
        return;
      }
    }
    // Shift+E extrudes the selected sketch or part, as in the reference.
    if (
      studioSession &&
      showWorkspace &&
      event.shiftKey &&
      !event.ctrlKey &&
      !event.metaKey &&
      !event.altKey &&
      event.key.toLowerCase() === 'e'
    ) {
      event.preventDefault();
      // A held key, as Shift+E pressed in a sketch closing into this Extrude, doesn't start another.
      if (!event.repeat && !busy && part && (partHasOutline || part.extrude === false)) studioCommand('extrude');
      return;
    }
    // Shift+S starts a sketch, on the plane or face picked if there is one, as in the reference.
    if (
      studioSession &&
      showWorkspace &&
      event.shiftKey &&
      !event.ctrlKey &&
      !event.metaKey &&
      !event.altKey &&
      event.key.toLowerCase() === 's'
    ) {
      event.preventDefault();
      if (!busy) studioCommand('sketch');
      return;
    }
    // The studio has no drawing tools: a sketch's shortcuts only work in an open sketch. Undo and redo still do.
    if (studioSession && showWorkspace && !event.ctrlKey && !event.metaKey) return;
    const key = event.key.toLowerCase();
    if (polygonTool && !event.ctrlKey && !event.metaKey && !event.altKey) {
      if (key === 'enter' && pending.length === 2) {
        event.preventDefault();
        addShape(pending[1]);
        return;
      }
      if (/^[0-9]$/.test(key)) {
        event.preventDefault();
        setPolygonSides(key);
        polygonInput.current?.focus();
        return;
      }
    }
    // A checkbox does not own drawing letters, but retains its native keyboard
    // activation and focus. Text fields remain isolated by the guard above.
    if (event.target instanceof HTMLInputElement && event.target.type === 'checkbox' && (key === ' ' || key === 'enter')) return;
    if (key === 'shift') {
      setDrawingCue(null);
      setSnapCue(null);
      return;
    }
    // A modifier press must not release a held selection before its shortcut's actual key arrives.
    if (key === 'control' || key === 'meta' || key === 'alt') return;
    if (
      drag.current ||
      annotationDrag.current ||
      boxGesture.current?.moved ||
      (drawingGesture.current.phase === 'pressed' && drawingGesture.current.moved)
    ) {
      event.preventDefault();
      if (key === 'escape') pointerEnd(true);
      return;
    }
    if (boxGesture.current) {
      boxGesture.current = null;
      setSelectionBox(null);
    }
    if (busy) return;
    if ((key === ' ' || key === 'enter') && event.target instanceof HTMLElement && event.target.closest('button,a')) return;
    if ((event.ctrlKey || event.metaKey) && (key === 'z' || key === 'y')) {
      event.preventDefault();
      navigateHistory(key === 'y' || event.shiftKey);
      return;
    }
    if ((event.ctrlKey || event.metaKey) && key === 'a') {
      event.preventDefault();
      // Everything drawn, not the edges of the face it's drawn on, so it can all be moved or patterned.
      const ids = sketch?.entities.filter(e => e.type !== 'point' && !e.faceEdge).map(e => e.id) ?? [];
      if (tool === 'transform' && !selected.length)
        setTransformParameters(initialTransformParameters(transformSelectionCenter(ids), lengthUnit));
      setSelected(ids);
      return;
    }
    if (event.ctrlKey || event.metaKey || event.altKey || event.repeat) return;
    // `n` looks straight at the sketch's plane, and again, at its other side, as in the reference.
    if (key === 'n' && sketchBackdrop) {
      event.preventDefault();
      setSketchTurn(normalTurn);
      setSketchCameraShift([0, 0]);
      return;
    }
    if (key === 'escape' && usingEdges) {
      event.preventDefault();
      setUsingEdges(false);
      setMessage('Choose a drawing tool or select geometry.');
      return;
    }
    // `u` uses the edges picked, or with none picked, starts Use: click edges to use them, as the reference teaches.
    if (key === 'u' && !event.shiftKey && sketchBackdrop) {
      event.preventDefault();
      if (pickedEdges.length) takeEdges();
      else if (usingEdges) {
        // U again ends Use, as choosing the tool again does in the reference.
        setUsingEdges(false);
        setMessage('Choose a drawing tool or select geometry.');
      } else {
        setUsingEdges(true);
        setMessage('Use: click the edges or vertices of the parts to bring them into the sketch. Esc ends.');
      }
      return;
    }
    if (modification.phase === 'offset' && modification.entityIds.length) {
      if (/^[0-9.,-]$/.test(key)) {
        event.preventDefault();
        setModification(previous => transitionModification(previous, { type: 'text', text: key }));
        return;
      }
      if (key === 'enter') {
        event.preventDefault();
        setModification(previous => transitionModification(previous, { type: 'edit' }));
        return;
      }
    }
    if (key === 'enter' && modification.phase === 'mirror' && modification.entityIds.length) {
      event.preventDefault();
      setModification(previous => transitionModification(previous, { type: 'mirrorPicking', picking: 'axis' }));
      setMessage('Select the mirror line.');
      return;
    }
    if (key === 'escape' && modification.phase !== 'idle') {
      event.preventDefault();
      chooseTool('select');
      setSelected([]);
      return;
    }
    if (key === 'contextmenu' || (event.shiftKey && key === 'f10')) {
      event.preventDefault();
      keyboardContext();
      return;
    }
    if (creationValues && part?.id === creationValues.partId && sketch && creationValueAt(creationValues, sketch)) {
      // A digit starts typing the value, and so does `#` for a variable or `=` for an expression, as in the reference.
      if (/^[0-9.,#=-]$/.test(key)) {
        event.preventDefault();
        setCreationValues({ ...creationValues, editing: true, text: key, selectAll: false });
        return;
      }
      if (key === 'enter') {
        event.preventDefault();
        applyCreationValue();
        return;
      }
      if (key === 'escape') setCreationValues(null);
    }
    if (event.shiftKey && key === 'a') {
      event.preventDefault();
      chooseTool('tangentArc');
      return;
    }
    if (event.shiftKey && key === 'f') {
      event.preventDefault();
      chooseTool('fillet');
      return;
    }
    if (event.shiftKey && key === 's') {
      event.preventDefault();
      chooseTool('point');
      return;
    }
    if (event.shiftKey && key === 'm') {
      event.preventDefault();
      constrain('midpoint');
      return;
    }
    if (event.shiftKey && key === 'j') {
      event.preventDefault();
      toggleFix();
      return;
    }
    // Normal, Pierce and Equal curvature have their keys reserved, so they never start the unshifted tool.
    if (event.shiftKey && (key === 'k' || key === 'g' || key === 'u')) {
      event.preventDefault();
      setMessage(`The ${key === 'k' ? 'Normal' : key === 'g' ? 'Pierce' : 'Equal curvature'} constraint isn’t available yet.`);
      return;
    }
    const constraintKey =
      event.shiftKey && key === 'q'
        ? 'symmetric'
        : event.shiftKey && key === 'o'
          ? 'concentric'
          : event.shiftKey && key === 'l'
            ? 'perpendicular'
            : !event.shiftKey
              ? (
                  { h: 'horizontal', v: 'vertical', i: 'coincident', e: 'equal', b: 'parallel', t: 'tangent' } as Record<
                    string,
                    ConstraintTool
                  >
                )[key]
              : undefined;
    if (constraintKey) {
      event.preventDefault();
      constrain(constraintKey);
      return;
    }
    if (key === 'escape') {
      event.preventDefault();
      if (dimensionFlow.phase !== 'idle' || dimension) {
        cancelDimensionEdit();
        return;
      }
      if ((tool === 'spline' || tool === 'bezier') && pending.length >= 2) {
        finishSpline(true);
        return;
      }
      if (pending.length) {
        drawingGesture.current = idleDrawingGesture();
        setPending([]);
        setLineContinuation(false);
        setChain(null);
        setDrawingCue(null);
        setSnapCue(null);
        hoveredReferences.current = [];
      } else {
        chooseTool('select');
        setSelected([]);
      }
    } else if (key === 'enter' && tool === 'slot') {
      event.preventDefault();
      acceptSlot();
    } else if (key === 'enter' && (tool === 'linearPattern' || tool === 'circularPattern')) {
      event.preventDefault();
      acceptLinearPattern();
    } else if (key === 'enter' && tool === 'transform') {
      event.preventDefault();
      acceptTransform();
    } else if (key === 'enter' && tool === 'fillet') {
      event.preventDefault();
      if (filletPreview?.ok) setFilletEditing(true);
      else setMessage(filletPreview && !filletPreview.ok ? filletPreview.message : 'Select shared corner points or adjacent lines.');
    } else if (key === 'enter' && (tool === 'spline' || tool === 'bezier')) {
      event.preventDefault();
      finishSpline();
    } else if (key === 'enter' && selectedConstraints.length === 1) {
      const c = sketch?.constraints.find(c => c.id === selectedConstraints[0]);
      if (c?.type === 'linearPattern' || c?.type === 'circularPattern') {
        event.preventDefault();
        editPattern(c.id);
        return;
      }
      if (c && numeric(c)) {
        event.preventDefault();
        editDimension(c.id);
      }
    } else if (key === ' ') {
      event.preventDefault();
      setSelected([]);
      setDimensionFlow(previous => idleDimensionWorkflow(previous.mode));
      setSelectedConstraints([]);
      setHoveredConstraintEntities([]);
    } else if (key === 'delete' || key === 'backspace') {
      event.preventDefault();
      removeSelected();
    } else if (key === 'q') {
      event.preventDefault();
      toggleConstruction();
    } else if (key === 's') {
      event.preventDefault();
      setSearchMode(false);
      setPalette(value => !value);
    } else if (key === 'f') {
      event.preventDefault();
      fit();
    } else if (key === 'd') {
      event.preventDefault();
      beginDimension();
    } else {
      // Drawing tools have single-letter keys; with Shift held, the key means something else.
      const command = event.shiftKey ? undefined : tools.find(t => t.key?.toLowerCase() === key)?.id;
      if (command) {
        event.preventDefault();
        chooseTool(command);
      }
    }
  };
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
    chamferDrag,
    chamferPreview,
    chamferSelection,
    changeSketch,
    chooseTool,
    circularDrag,
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
    patternDrag,
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
    slotDrag,
    snap,
    solveDrag,
    solving,
    splitFirst,
    svg,
    takeEdges,
    tangentAxis,
    tool,
    transformDrag,
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
  });
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
      const offsetError = acceptOffset();
      if (offsetError) return blocked(offsetError);
      const dimensionError = applyDimensionValue();
      if (dimensionError) return blocked(dimensionError);
      const rhoError = applyConicRho();
      if (rhoError) return blocked(rhoError);
      if (creationValues?.editing) {
        const creationError = applyCreationValue({ advance: false });
        if (creationError) return blocked(creationError);
      }
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
      const restored = { ...structuredClone(session.entry), revision: session.document.revision + 1 };
      session.document = restored;
      session.past = [];
      session.future = [];
      publish(restored);
      await callbacks.current.onCancel();
      endCadSession(doc.id);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  };
  const openFeature = (
    kind: 'extrude' | 'pattern' | 'hole',
    partId: string,
    before = documentRef.current,
    initialPatternKind?: PartPatternKind
  ) => {
    setSelectedFace(null);
    setPartCutting(null);
    setVariableDialog(null);
    setPlaneDialog(null);
    setMirrorDialog(null);
    setTransformDialog(null);
    setChoosingFace(false);
    cutSelection.selectPart(partId);
    setSelected([]);
    chooseTool('select');
    setShowWorkspace(true);
    setFeatureDialog({ kind, partId, before, initialPatternKind });
  };
  const closeFeature = (keep: boolean) => {
    setDirectionPicker(null);
    // Pattern candidates use the viewport preview transaction, so cancel has no source or history edit to undo.
    if (!keep && featureDialog && featureDialog.kind !== 'pattern') commit(featureDialog.before);
    // Regions picked apart are a part each.
    if (keep && featureDialog?.kind === 'extrude') {
      const split = splitApartRegions(documentRef.current, featureDialog.partId, apartIds);
      if (split !== documentRef.current) commit(split);
    }
    // A Remove is a cut in the board its sketch is drawn on, so that board is the one selected.
    const step = keep && featureDialog && documentRef.current.parts.find(p => p.id === featureDialog.partId);
    const on = step && step.remove && step.drawnOn?.on;
    if (on && !('plane' in on)) setPartId(on.partId);
    // An Add is part of the part it adds to.
    else if (step && step.addTo) setPartId(step.addTo);
    setFeatureDialog(null);
  };
  /** Opens a part's sketch from the studio, remembering the design to go back to if it's cancelled. */
  const openSketch = (stepPartId: string, before = documentRef.current) => {
    setSelectedFace(null);
    setCancelledSketch(null);
    // A shared sketch is edited where it's drawn, and every extrude of it follows.
    const partId = documentRef.current.parts.find(candidate => candidate.id === stepPartId)?.sketchOf ?? stepPartId;
    const opening = documentRef.current.parts.find(candidate => candidate.id === partId);
    if (opening?.faceProfile) return openFeature('extrude', partId);
    const carried = carriedSketchCamera(documentRef.current, opening, studioCamera.current, root.current);
    setSketchTurn(carried?.turn ?? straightOn);
    setSketchCameraShift(carried?.shift ?? [0, 0]);
    if (carried) setView(carried.view);
    sketchBefore.current = before;
    setFeatureDialog(null);
    setVariableDialog(null);
    setPlaneDialog(null);
    setMirrorDialog(null);
    setTransformDialog(null);
    setPartCutting(null);
    setChoosingFace(false);
    cutSelection.selectPart(partId);
    setSelected([]);
    setShowWorkspace(false);
    setShow3D(false);
    requestAnimationFrame(() => focusSketchCanvas(svg.current));
  };
  /** Back to the studio from a sketch: keeping it, or leaving the design as it was before it opened. */
  const closeSketch = (keep: boolean) => {
    if (keep) {
      // A value still being typed, such as a dimension, is part of the sketch being kept.
      const error =
        acceptOffset() ||
        applyDimensionValue() ||
        applyConicRho() ||
        (creationValues?.editing ? applyCreationValue({ advance: false }) : null);
      if (error) return setMessage(error);
    }
    captureSketchCamera(documentRef.current, part, studioCamera, view, sketchTurn, sketchCameraShift, canvasBox);
    if (!keep && sketchBefore.current) {
      const cancelled = { document: structuredClone(documentRef.current), partId: part!.id, before: sketchBefore.current };
      commit(sketchBefore.current);
      if (studioSession) setCancelledSketch(cancelled);
    }
    sketchBefore.current = null;
    // A sketch just finished is extruded with nothing picked yet.
    setSketchRowPicked(null);
    setMessage('');
    chooseTool('select');
    setSelected([]);
    setShow3D(false);
    // A lazy or inert view takes focus through onReady/solve completion, even when loading takes more than a second.
    if (svg.current === root.current?.ownerDocument.activeElement) svg.current?.blur();
    viewWantsKeyboard.current = true;
    setShowWorkspace(true);
    return true;
  };
  /** Opens what a step of the design made: its sketch, its dialog, or its part in 3D. */
  const openStep = (step: DesignStep) => {
    // In the studio a step opens its dialog, and a sketch opens to be drawn on, as the reference does.
    if (studioSession && step.kind === 'sketch') return openSketch(step.partId);
    if (studioSession && step.kind === 'extrude')
      return openFeature(documentRef.current.parts.find(p => p.id === step.partId)?.hole ? 'hole' : 'extrude', step.partId);
    if (studioSession && step.kind === 'move') return openTransform(step.partId, undefined, true);
    if (studioSession && step.kind === 'fillet') return setFilletDialog({ partId: step.partId, filletId: step.id });
    if (studioSession && step.kind === 'copy') {
      const copy = documentRef.current.parts.find(candidate => candidate.id === step.partId)?.copies?.find(c => c.id === step.copyId);
      if (copy?.offset) return openTransform(step.partId, copy.id);
      if (copy?.mirror) {
        setFeatureDialog(null);
        setPartCutting(null);
        setTransformDialog(null);
        setVariableDialog(null);
        setPlaneDialog(null);
        setChoosingFace(false);
        setDirectionPicker(null);
        return setMirrorDialog({ partId: step.partId, copyId: copy.id });
      }
    }
    if (studioSession && (step.kind === 'pattern' || step.kind === 'copy')) return openFeature('pattern', step.partId);
    // A cut opens its part's sketch view from the studio: cancelling there goes back to the design as it is now.
    if (studioSession && step.kind === 'cut') sketchBefore.current = documentRef.current;
    setPartId(step.partId);
    setSelected([]);
    chooseTool('select');
    if (step.kind === 'sketch') {
      setShowWorkspace(false);
      setShow3D(false);
    } else if (step.kind === 'pattern' || step.kind === 'copy') {
      setShowWorkspace(true);
    } else if (step.kind === 'partCut') {
      setShowWorkspace(true);
      setPartCutting({ id: step.partCutId });
    } else if (step.kind === 'cut' || step.kind === 'extrude') {
      setShowWorkspace(false);
      setShow3D(hasOutline(documentRef.current, step.partId));
    } else if (step.kind === 'faceSketch' && onEditFaceSketch && step.sketchId) {
      faceEditor.edit(step.partId, step.sketchId);
    }
  };
  /** A row of the studio's feature list: edited, deleted, suppressed, or its sketch opened. */
  const featureAction = (entry: FeatureEntry, action: FeatureAction) => {
    const current = documentRef.current;
    setStudioRefusal(null);
    if (entry.kind === 'plane') {
      if (action === 'newSketch') return newSketchOn(entry.id);
      if (action === 'edit') {
        if (!showWorkspace) {
          closeSketch(true);
          if (sketchBefore.current) return;
        }
        setFeatureDialog(null);
        setPartCutting(null);
        setTransformDialog(null);
        setVariableDialog(null);
        setMirrorDialog(null);
        return setPlaneDialog({ id: entry.id });
      }
      if (action === 'delete') {
        if (selectedPlane === entry.id) setSelectedPlane(null);
        return commit(removeDatumPlane(current, entry.id));
      }
      return;
    }
    if (entry.kind === 'variable') {
      if (action === 'edit') {
        // A variable is set in the studio, as any other step: an open sketch is finished first.
        if (!showWorkspace) {
          closeSketch(true);
          if (sketchBefore.current) return;
        }
        setFeatureDialog(null);
        setPartCutting(null);
        setTransformDialog(null);
        setPlaneDialog(null);
        setMirrorDialog(null);
        return setVariableDialog({ id: entry.id });
      }
      if (action === 'delete') {
        const result = removeCadVariable(current, entry.id);
        if ('error' in result) return setStudioRefusal(result.error);
        return commit(result.document);
      }
      return;
    }
    const { step } = entry;
    if (action === 'edit') return openStep(step);
    if (action === 'editSketch') return openSketch(step.partId);
    if (action === 'suppress' && step.kind === 'cut' && step.cutId) {
      const cut = current.parts.find(candidate => candidate.id === step.partId)?.features?.find(feature => feature.id === step.cutId);
      return commit(setCutSuppressed(current, step.partId, step.cutId, !(cut?.type === 'cut' && cut.suppressed)));
    }
    if (action === 'suppress') return commit(toggleSuppressed(current, step));
    if (action === 'rollTo') return setRolledTo(designSteps(current).at(-1)?.id === step.id ? null : step.id);
    if (action === 'rollToEnd') return setRolledTo(null);
    if (action !== 'delete') return;
    setFeatureDialog(null);
    if (step.kind === 'fillet') return commit(removeEdgeFillet(current, step.partId, step.id));
    if (step.kind === 'move')
      return commit(
        replacePart(current, step.partId, p => {
          const next = { ...p };
          delete next.moved;
          return next;
        })
      );
    // In the studio a sketch stands on its own, as in the reference: deleting its Extrude leaves the sketch.
    if (
      step.kind === 'extrude' &&
      studioSession &&
      !current.parts.find(p => p.id === step.partId)?.sketchOf &&
      !current.parts.find(p => p.id === step.partId)?.faceProfile
    )
      commit(replacePart(current, step.partId, withoutExtrude));
    else if (step.kind === 'sketch' || step.kind === 'extrude') {
      // A part is its sketch pushed out, so deleting either deletes the part.
      const parts = current.parts.filter(candidate => candidate.id !== step.partId);
      commit(withFeatureVersion({ ...current, parts }));
      setPartId(parts[0]?.id ?? '');
    } else if (step.kind === 'pattern') commit(setPartPattern(current, step.partId, null));
    else if (step.kind === 'partCut' && step.partCutId) commit(removePartCut(current, step.partCutId));
    else if (step.kind === 'cut' && step.cutId) commit(removeCadFeature(current, step.partId, step.cutId));
  };
  const openTransform = (partId: string, copyId?: string, move?: boolean) => {
    setFeatureDialog(null);
    setPartCutting(null);
    setVariableDialog(null);
    setPlaneDialog(null);
    setMirrorDialog(null);
    setChoosingFace(false);
    setPartId(partId);
    setShowWorkspace(true);
    setTransformDialog({ partId, ...(copyId && { copyId }), ...(move && { move }) });
  };
  /** Starts a new part drawn on a base plane or a part's face, or on one of the design's planes, and opens its sketch. */
  const newPartOn = (on: CadDrawnOn['on'], datum?: string) => {
    const before = documentRef.current;
    const made = newSketchPart(before, on, {
      variables: variableScope,
      studio: studioSession,
      thickness: part?.thickness,
      datum,
      rolledTo,
    });
    const drawn = made.part;
    commit(made.document);
    if (made.inserted) setRolledTo(`${drawn.id}:sketch`);
    const onName = (datum && pickedPlane(documentRef.current, datum)?.name) || drawnOnName(documentRef.current, on);
    setMessage(`Draw the new part's outline on ${onName}, then finish to see it in place.`);
    if (studioSession) return openSketch(drawn.id, before);
    setPartId(drawn.id);
    setSelected([]);
    setShowWorkspace(false);
    setShow3D(false);
    requestAnimationFrame(() => focusSketchCanvas(svg.current));
  };
  /**
   * A plane clicked in the view or the feature list: drawn on while choosing, otherwise picked for the next sketch. One
   * of the design's planes gives what it's offset from as a direction, as its normal is the same.
   */
  /** New sketch from a plane's menu: a new sketch on that plane, straight away. */
  const newSketchOn = (plane: string) => {
    const picked = pickedPlane(documentRef.current, plane);
    if (!picked || busy) return;
    setChoosingFace(false);
    setSelectedPlane(null);
    newPartOn(picked.on, picked.datum);
  };
  const pickPlane = (plane: string) => {
    const picked = pickedPlane(documentRef.current, plane);
    if (!picked) return;
    if (directionPicker) {
      directionPicker(picked.on, picked.datum);
      return setDirectionPicker(null);
    }
    if (choosingFace) {
      setChoosingFace(false);
      setSelectedPlane(null);
      return newPartOn(picked.on, picked.datum);
    }
    setSelectedFace(null);
    setSelectedPlane(picked => (picked === plane ? null : plane));
  };
  const studioCommand = (command: StudioCommand, initialPatternKind?: PartPatternKind) => {
    setStudioRefusal(null);
    // Starting one step closes any other step's dialog.
    setVariableDialog(null);
    setPlaneDialog(null);
    setMirrorDialog(null);
    setTransformDialog(null);
    if (command === 'sketch') {
      setFeatureDialog(null);
      setPartCutting(null);
      // A plane or face picked first is drawn on straight away, as the reference sketches on what's selected.
      // A face picked on a part that has since gone, as when it was deleted, is no longer there to draw on.
      const face = selectedFace && cadFaceFrame(documentRef.current, selectedFace);
      const plane = selectedPlane && pickedPlane(documentRef.current, selectedPlane);
      const picked = !choosingFace && (plane ? plane.on : face && !('error' in face) ? selectedFace : null);
      if (picked) {
        setSelectedPlane(null);
        setSelectedFace(null);
        return newPartOn(picked, plane ? plane.datum : undefined);
      }
      setChoosingFace(!choosingFace);
    } else if (command === 'transform') {
      if (part) cutSelection.transformPart(openTransform, setStudioRefusal);
    } else if (command === 'variable') {
      setFeatureDialog(null);
      setPartCutting(null);
      setChoosingFace(false);
      setVariableDialog({});
    } else if (command === 'hole') {
      const at = { partId: part?.id, copyId: cutSelection.pickedCopyId, cancel: () => featureDialog && closeFeature(false) };
      startHole({ ...at, rolledTo: userRollback, read: () => documentRef.current, commit, open: openFeature, refuse: setStudioRefusal });
    } else if (command === 'fillet') setFilletDialog({});
    else if (command === 'mirror') {
      if (part) setMirrorDialog({ partId: part.id });
    } else if (command === 'plane') {
      setFeatureDialog(null);
      setPartCutting(null);
      setChoosingFace(false);
      const preselected = planeOffsetFrom(documentRef.current, selectedPlane, selectedFace);
      setPlaneDialog(preselected ? { preselected } : {});
    } else if (command === 'cutParts') {
      setFeatureDialog(null);
      setChoosingFace(false);
      setPartCutting({});
    } else if (command === 'extrude' && (selectedFace || part)) {
      const before = documentRef.current;
      const from = selectedFace ? { face: selectedFace } : { part: part! };
      const started = startExtrude(before, from, part?.extrude === false && sketchRowPicked === part.id, profiles.pickedProfile);
      if ('refusal' in started) return setStudioRefusal(started.refusal);
      commit(started.document);
      openFeature('extrude', started.partId, before);
    } else if (part)
      cutSelection.featurePart(command, (kind, partId) => openFeature(kind, partId, undefined, initialPatternKind), setStudioRefusal);
  };
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
  const canEditCanvasDimensions =
    !constraintMode && !fixMode && dimensionFlow.phase === 'idle' && (tool === 'select' || tool === 'dimension');
  const activeSketchStatus = sketchStatuses[part?.id ?? ''];
  const variableProblems = cadVariableProblems(doc);
  // The face a part is drawn on, outlined on its drawing so it can be traced and lined up with.
  const drawnOnFace = part ? drawnOnOutline(doc, part) : null;
  // A dimension that can't follow its variables shows like a conflicting one.
  const shownConflicts = [...conflictedConstraints, ...variableProblems.flatMap(problem => problem.constraintIds ?? [])];
  /** Why a part can't take its current values, for the mark beside it in the list. */
  const partTrouble = (id: string) =>
    variableProblems.find(problem => problem.partId === id)?.message ??
    (sketchStatuses[id]?.status === 'conflict' ? 'This part’s sketch can’t be solved with its current values.' : null);
  const displayStatus =
    activeSketchStatus?.status === 'solved' && (inProgress || !problems.length)
      ? sketchDofStatus(activeSketchStatus.dof, !sketch?.entities.some(e => e.type !== 'point' && !e.construction))
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
  const chainPreview = sketch && chainGeometry(sketch, chain);
  const numberOfShapes = sketch?.entities.filter(e => e.type !== 'point' && !e.construction).length ?? 0;
  const acceptanceNotice = notice ?? useNotice ?? finishError;
  const profiles = useProfileSelection(doc, featureDialog, commit, setStudioRefusal);
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
  // The parts' edges the drawing shows: all of them looking straight at the plane, and once turned, those in it, the
  // only ones that still line up with what's seen.
  const shownEdges = sketchBackdrop ? partEdges.filter(edge => edge.onPlane || sketchTurn === straightOn) : [];
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
  // Whether the open sketch can be finished: closed back to the studio, or the whole design accepted outside one.
  const sketchFinishReason =
    busy || solving
      ? 'Wait for the current sketch check to finish.'
      : (pendingFinishReason ??
        (edgeOnBoard
          ? null
          : !faceSketch && !thicknessValid
            ? 'Enter a valid part thickness before finishing the sketch.'
            : problems.length
              ? problems.join(' ')
              : !faceSketch && numberOfShapes === 0
                ? 'Draw an outline before finishing the sketch.'
                : null));
  const sketchCanFinish = sketchFinishReason === null;
  // The studio's Parts list shows each physical instance, with an eye to show or hide it in the view.
  // The studio's parts: a sketch not yet extruded is a feature, not a part.
  // A tool used up by its cut isn't a part of its own any more.
  const builtParts = studioSession ? listedStudioParts(doc) : builtStudioParts(doc);
  const isolatePart = usePartIsolation(builtParts, cutSelection.selectedKey, hiddenParts, setHiddenParts);
  const physicalPartCount = builtParts.reduce((count, p) => count + 1 + (p.copies?.length ?? 0), 0);
  // An open sketch turned with its parts behind it, about the middle of the view.
  const turned = !!sketchBackdrop && sketchTurn !== straightOn;
  const [ta, tb, tc, td] = drawingMatrix(sketchTurn);
  const middle = { x: view.x + view.w / 2, y: view.y + view.h / 2 };
  const turnTransform = `translate(${middle.x + sketchCameraShift[0]} ${middle.y + sketchCameraShift[1]}) matrix(${ta} ${tb} ${tc} ${td} 0 0) translate(${-middle.x} ${-middle.y})`;
  const turnDet = ta * td - tb * tc || 1;
  // Labels and points are turned back where they stand, to read and look the same from any side.
  const unturn = `matrix(${td / turnDet}, ${-tb / turnDet}, ${-tc / turnDet}, ${ta / turnDet}, 0, 0)`;
  const studioDisabled = disabledStudioCommands(part, partHasOutline, builtParts.length);
  const featureShown = useFeatureShown(featureVisibility, shownDocument, pastRollback);
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
        onToggleHidden={key => setHiddenParts(previous => toggledKey(previous, key))}
        trouble={partTrouble}
        onPick={(partId, copyId) => {
          setSelectedFace(null);
          if (partCutting && showWorkspace) return cutSelection.pickForCut(partId, copyId);
          cutSelection.selectPart(partId, copyId);
          setSelected([]);
          chooseTool('select');
        }}
        onRename={(partId, copyId, name) =>
          commit(
            copyId
              ? renamePartCopy(documentRef.current, partId, copyId, name)
              : replacePart(documentRef.current, partId, current => ({
                  ...current,
                  // The features keep the names they had: renaming a part never renames them.
                  sketchName: current.sketchName ?? `Sketch · ${current.name}`,
                  extrudeName: current.extrudeName ?? `Extrude · ${current.name}`,
                  name,
                }))
          )
        }
      />
    </>
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
          active={
            choosingFace
              ? 'sketch'
              : partCutting
                ? 'cutParts'
                : variableDialog
                  ? 'variable'
                  : mirrorDialog
                    ? 'mirror'
                    : planeDialog
                      ? 'plane'
                      : transformDialog
                        ? 'transform'
                        : (featureDialog?.kind ?? null)
          }
          disabled={studioDisabled}
          canUndo={session.past.length > 0}
          canRedo={session.future.length > 0}
          canFinish={
            thicknessValid &&
            !solving &&
            !problems.length &&
            !featureDialog &&
            !partCutting &&
            !variableDialog &&
            !planeDialog &&
            !transformDialog
          }
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
            disabled={busy || !!rollbackStep || stepDialogOpen || !!filletDialog}
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
              onSelect={selectStudioFeature(doc, profiles.pickSketch, {
                sketch: setSketchRowPicked,
                face: () => setSelectedFace(null),
                part: cutSelection.selectPart,
                entities: () => setSelected([]),
              })}
              onAction={featureAction}
              rollback={rollbackStep}
              onRollTo={showWorkspace ? setRolledTo : undefined}
              onHover={entry => setHoveredStepParts(entry?.kind === 'step' ? featureRowParts(doc, entry.step) : null)}
              {...(showWorkspace && { selectedPlane, onPickPlane: pickPlane, onNewSketch: newSketchOn })}
              shown={featureShown}
              onToggleShown={id => setFeatureVisibility(previous => ({ ...previous, [id]: !featureShown(id) }))}
            />
          )}
          {!faceSketch && !studioSession && <CadVariablesPanel document={doc} onChange={commit} />}
          {!faceSketch && !studioSession && <DesignStepsList document={doc} selectedPartId={part?.id ?? null} onStep={openStep} />}
          {!studioSession && partsPanel}
          {part && !faceSketch && !(studioSession && showWorkspace) && (
            <div className="cad-properties">
              <h3>{part.name} · Sketch</h3>
              <label htmlFor="cad-part-name">Part name</label>
              <input
                id="cad-part-name"
                key={`${part.id}:${part.name}`}
                defaultValue={part.name}
                onKeyDown={event => {
                  if (event.key === 'Enter' && !event.nativeEvent.isComposing && event.nativeEvent.keyCode !== 229) {
                    event.preventDefault();
                    event.currentTarget.blur();
                    svg.current?.focus();
                  }
                  if (event.key === 'Escape') {
                    event.currentTarget.value = part.name;
                    event.currentTarget.blur();
                    svg.current?.focus();
                  }
                }}
                onBlur={event => {
                  const name = event.currentTarget.value.trim();
                  if (name && name !== part.name) commit(replacePart(doc, part.id, p => ({ ...p, name })));
                }}
              />
              {!studioSession && (
                <>
                  <CadThicknessField
                    key={part.id}
                    value={part.thickness}
                    expression={part.thicknessExpression}
                    variables={variableScope}
                    onValidityChange={setThicknessValid}
                    onDone={() => svg.current?.focus()}
                    onCommit={(thickness, thicknessExpression) =>
                      commit(
                        replacePart(doc, part.id, p => {
                          const next = { ...p, thickness, thicknessExpression };
                          if (thicknessExpression === undefined) delete next.thicknessExpression;
                          return next;
                        })
                      )
                    }
                  />
                  {part.drawnOn && (
                    <CadDrawnOnField
                      key={`${part.id}:drawn-on`}
                      document={doc}
                      part={part as typeof part & { drawnOn: NonNullable<typeof part.drawnOn> }}
                      variables={variableScope}
                      onDone={() => svg.current?.focus()}
                      onChange={drawnOn => commit(replacePart(documentRef.current, part.id, p => ({ ...p, drawnOn })))}
                    />
                  )}
                  <CadReliefField
                    key={`${part.id}:relief`}
                    relief={part.cornerRelief}
                    variables={variableScope}
                    onDone={() => svg.current?.focus()}
                    onChange={cornerRelief =>
                      commit(
                        replacePart(documentRef.current, part.id, p => {
                          const next = { ...p, cornerRelief };
                          if (!cornerRelief) delete next.cornerRelief;
                          return next;
                        })
                      )
                    }
                  />
                  <CadPartPatternField
                    key={`${part.id}:pattern`}
                    pattern={part.pattern}
                    document={doc}
                    pickDirection={picked => setDirectionPicker(() => picked)}
                    variables={variableScope}
                    onDone={() => svg.current?.focus()}
                    onChange={pattern => commit(setPartPattern(documentRef.current, part.id, pattern))}
                  />
                  <CadCopyNames
                    part={part}
                    onRename={(copyId, name) => commit(renamePartCopy(documentRef.current, part.id, copyId, name))}
                  />
                </>
              )}
              {variableProblems
                .filter(problem => problem.partId === part.id)
                .map((problem, index) => (
                  <p key={index} className="cad-variable-problem" role="alert">
                    Can’t follow the variables, so this part keeps its last good shape. {problem.message}
                  </p>
                ))}
              <button
                type="button"
                className="cad-delete-part"
                onClick={() => {
                  const parts = doc.parts.filter(p => p.id !== part.id);
                  commit(withFeatureVersion({ ...doc, parts }));
                  setPartId(parts[0]?.id ?? '');
                  setSelected([]);
                  chooseTool('select');
                }}>
                Delete part
              </button>
              {(!!part.features?.length || onEditFaceSketch) && (
                <PartFeatureList
                  part={part}
                  onRemove={featureId => commit(removeCadFeature(documentRef.current, part.id, featureId))}
                  onSwitchCut={(cutId, on) => commit(setCutSuppressed(documentRef.current, part.id, cutId, !on))}
                  onEdit={onEditFaceSketch && (sketchId => faceEditor.edit(part.id, sketchId))}
                  variables={variableScope}
                  onCutDepth={(cut, depth, expression) =>
                    commit(setCutDepth(documentRef.current, part.id, cut.sketchId, cut.regionId, depth, expression))
                  }
                  onMoveToTop={sketchId => commit(moveFaceSketch(documentRef.current, part.id, sketchId, 'top'))}
                  onNew={onEditFaceSketch && (face => faceEditor.create(face))}
                />
              )}
              <div className="cad-divider" />
              {!studioSession && (
                <label className="cad-show-constraints">
                  <input
                    type="checkbox"
                    checked={showConstraints}
                    onChange={event => {
                      setShowConstraints(event.target.checked);
                      setHoveredConstraintEntities([]);
                    }}
                  />
                  Show constraints
                </label>
              )}
              {(tool === 'dimension' || placingDimension || dimension !== null) && (
                <>
                  <label className="cad-dimension-mode" htmlFor="cad-dimension-mode">
                    Dimension type
                    <select
                      id="cad-dimension-mode"
                      value={dimensionMode}
                      onChange={event => applyDimensionEvent({ type: 'mode', mode: event.target.value as DimensionMode })}>
                      <option value="auto">Automatic</option>
                      <option value="distance">Length</option>
                      <option value="distanceX">Horizontal distance</option>
                      <option value="distanceY">Vertical distance</option>
                      <option value="angle">Angle</option>
                    </select>
                  </label>
                </>
              )}
              <p className="cad-muted">Select a constraint and press Delete to remove it. Double-click a dimension to edit its value.</p>
              {selected.length === 1 &&
                sketch?.entities.some(entity => entity.id === selected[0] && entity.type === 'conic') &&
                tool === 'select' && (
                  <button
                    type="button"
                    onClick={() => {
                      const curve = sketch.entities.find(entity => entity.id === selected[0]);
                      if (curve?.type === 'conic') {
                        setRho(String(curve.rho));
                        setConicEditing(curve.id);
                      }
                    }}>
                    Edit conic rho
                  </button>
                )}
            </div>
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
          {showWorkspace && (
            <StudioStepDialogs
              document={doc}
              variables={variableScope}
              transform={transformDialog}
              variable={variableDialog}
              plane={planeDialog}
              mirror={mirrorDialog}
              fillet={filletDialog}
              commit={next => commit(prepareStudioPreview(next))}
              onPreview={studioPreview.update}
              onConnectorsChange={setMateConnectors}
              setTransform={setTransformDialog}
              setVariable={setVariableDialog}
              setPlane={setPlaneDialog}
              setMirror={setMirrorDialog}
              setFillet={setFilletDialog}
              setDirectionPicker={picker => setDirectionPicker(() => picker)}
              pickPoint={pointPicker.start}
            />
          )}
          {showWorkspace && featureDialog && (
            <StudioFeatureDialog
              state={featureDialog}
              document={extrusionDepth.document}
              variables={variableScope}
              onChange={change => commit(change(documentRef.current))}
              onOk={() => closeFeature(true)}
              onCancel={() => closeFeature(false)}
              onPreview={studioPreview.update}
              depthDragging={extrusionDepth.control(shownDocument)?.dragging}
              profilePicking={profiles.enabled}
              onPickProfile={() => profiles.setEnabled(!profiles.enabled)}
              onEditSketch={openSketch}
              pickDirection={picked => setDirectionPicker(() => picked)}
              pickPoint={pointPicker.start}
            />
          )}
          {studioSession && !showWorkspace && part && (
            // The open sketch, closed from here as the reference's sketch dialog is: away from the studio's Done.
            <StudioSketchDialog
              key={`${doc.id}:${part.sketch.id}`}
              editor={root}
              title={part.sketchName ?? `Sketch · ${part.name}`}
              plane={part.drawnOn ? drawnOnName(doc, part.drawnOn.on) : 'Top plane'}
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
                const before = documentRef.current;
                const sketched = before.parts.find(candidate => candidate.id === part.id);
                const started = sketched && startExtrude(before, { part: sketched }, true, picked => picked);
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
          <div className="cad-canvas-bar">
            {showWorkspace ? (
              <span>
                <strong>PART STUDIO</strong> · {physicalPartCount === 1 ? 'one part' : `${physicalPartCount} parts`}
              </span>
            ) : studioSession && part ? (
              <span>
                <strong>SKETCH</strong> · {part.name}{' '}
                <span className="cad-muted">/ on {part.drawnOn ? drawnOnName(doc, part.drawnOn.on) : 'the top plane'}</span>
              </span>
            ) : (
              <span>
                <strong>{faceSketch?.below ? 'BOTTOM' : 'TOP'}</strong> · {part?.name ?? 'Sketch'}{' '}
                <span className="cad-muted">/ {faceSketch?.label ?? 'XY plane'}</span>
              </span>
            )}
            <div>
              {!faceSketch && !(studioSession && showWorkspace) && (
                <div className="cad-view-switch" role="group" aria-label="Show">
                  <button
                    type="button"
                    aria-pressed={!show3D && !showWorkspace}
                    title="The sketch, to draw on"
                    onClick={() => {
                      // Back on the drawing, its keys work straight away.
                      requestAnimationFrame(() => focusSketchCanvas(svg.current));
                      setShow3D(false);
                      setShowWorkspace(false);
                    }}>
                    Drawing
                  </button>
                  <button
                    type="button"
                    aria-pressed={show3D && !showWorkspace}
                    disabled={!partHasOutline}
                    title="This part in 3D, to set its cuts"
                    onClick={() => {
                      chooseTool('select');
                      setShowWorkspace(false);
                      setShow3D(true);
                    }}>
                    3D
                  </button>
                  {!studioSession && (
                    <button
                      type="button"
                      aria-pressed={showWorkspace}
                      disabled={!doc.parts.length}
                      title="Every part where it sits"
                      onClick={() => {
                        chooseTool('select');
                        setShowWorkspace(true);
                      }}>
                      All parts
                    </button>
                  )}
                </div>
              )}
              {!show3D && !showWorkspace && (
                <>
                  <button type="button" className="cad-bar-button" title="Zoom to show the whole sketch" onClick={() => fit()}>
                    Fit <kbd>F</kbd>
                  </button>
                  <button
                    type="button"
                    role="switch"
                    className="cad-switch"
                    aria-checked={snap}
                    title="Snap to points, lines and the grid while drawing"
                    onClick={() => {
                      setSnap(value => !value);
                      setDrawingCue(null);
                      setSnapCue(null);
                      hoveredReferences.current = [];
                      svg.current?.focus();
                    }}>
                    Snap
                    <span className="cad-switch-track" aria-hidden="true" />
                  </button>
                </>
              )}
            </div>
          </div>
          {studioSession && studioRefusal && (
            <p className="cad-notice cad-studio-refusal" role="alert">
              {studioRefusal}
            </p>
          )}
          {showWorkspace && (
            <Suspense fallback={<div className="cad-part-view" />}>
              <WorkspaceView
                cameraState={studioCamera}
                extrusionDepth={extrusionDepth.control(shownDocument)}
                measurementEnabled={!busy && !stepDialogOpen && !filletDialog && !choosingFace && !directionPicker && !pointPicker.onPick}
                onReady={focusViewIfIdle}
                document={shownDocument}
                profileDocument={doc}
                viewRequest={viewRequest}
                onViewRequest={
                  studioSession ? request => setViewRequest(previous => ({ ...request, seq: (previous?.seq ?? 0) + 1 })) : undefined
                }
                transparentIds={transparentParts}
                showPlanes={showPlanes}
                selectedId={cutSelection.selectedTool ? part!.id : null}
                selectedCopyId={cutSelection.selectedCopyId}
                onSelect={(id, copyId) => {
                  setSketchRowPicked(null);
                  if (partCutting) return cutSelection.pickForCut(id, copyId);
                  cutSelection.selectPart(id, copyId);
                  setSelected([]);
                }}
                highlightIds={partCutting ? cutSelection.cutPicked : cutSelection.selectedReferences}
                hiddenIds={hiddenParts}
                featureShown={featureShown}
                onHover={onHoverPart}
                onOpen={(id, copyId) => {
                  if (partCutting) return cutSelection.pickForCut(id, copyId);
                  if (studioSession) return openSketch(id);
                  setPartId(id);
                  setSelected([]);
                  setShowWorkspace(false);
                  setShow3D(hasOutline(documentRef.current, id));
                }}
                {...(studioSession
                  ? { choosing: choosingFace, onChoosingChange: setChoosingFace }
                  : { onCutParts: () => setPartCutting({}) })}
                onNewPart={newPartOn}
                selectedPlane={selectedPlane}
                {...{ selectedFace, pickingMirrorPlane: !!mirrorDialog && !!directionPicker }}
                onSelectPlane={pickPlane}
                hoverIds={hoveredStepParts ?? undefined}
                picked={
                  selectedPlane ? (pickedPlane(doc, selectedPlane)?.name ?? null) : selectedFace ? drawnOnName(doc, selectedFace) : null
                }
                regions={directionPicker ? [] : profiles.regions}
                onPickRegion={profiles.pickRegion}
                onPickSketch={
                  studioSession && !directionPicker && !choosingFace && !pointPicker.onPick && !partCutting
                    ? (id, region) => {
                        if (profiles.pickSketch(id, region)) return;
                        setSelectedFace(null);
                        setSketchRowPicked(id);
                        cutSelection.selectPart(id);
                        setSelected([]);
                      }
                    : undefined
                }
                onPickPoint={pointPicker.onPick}
                connectors={transformDialog ? mateConnectors : undefined}
                onSelectFace={on => {
                  if (directionPicker && on) {
                    directionPicker(on);
                    return setDirectionPicker(null);
                  }
                  if (on && profiles.pickFace(on)) return;
                  setSelectedFace(on);
                  if (on) setSelectedPlane(null);
                }}>
                {studioSession && choosingFace && (
                  // A new sketch waits for its plane, as the reference's sketch dialog does: a plane or a face picked
                  // in the view, or a plane in the feature list.
                  <FeatureDialog
                    title="Sketch"
                    okLabel="Pick a plane or face first"
                    okDisabled
                    onOk={() => {}}
                    onCancel={() => setChoosingFace(false)}
                    autoFocus={false}>
                    <div className="cad-feature-selection" data-active="">
                      <small>Sketch plane</small>
                      <span>Pick a plane or a face</span>
                    </div>
                  </FeatureDialog>
                )}
                {partCutting && (
                  <PartCutDialog
                    key={partCutting.id ?? 'new'}
                    document={doc}
                    onPreview={studioPreview.update}
                    step={doc.partCuts?.find(step => step.id === partCutting.id)}
                    tool={cutSelection.selectedTool}
                    variables={variableScope}
                    pick={cutSelection.cutPick}
                    onPicked={cutSelection.showCutPicked}
                    onClose={() => setPartCutting(null)}
                    onRemove={
                      partCutting.id
                        ? () => {
                            commit(removePartCut(documentRef.current, partCutting.id!));
                            setPartCutting(null);
                          }
                        : undefined
                    }
                    onSave={change => {
                      const { clearance, clearanceExpression, split, consumeTools, ...parts } = change;
                      const made = partCutting.id
                        ? updatePartCut(documentRef.current, partCutting.id, change)
                        : addPartCut(
                            documentRef.current,
                            parts.tools,
                            parts.targets,
                            { value: clearance, expression: clearanceExpression },
                            split
                          );
                      const document = 'document' in made ? made.document : made;
                      const id = 'document' in made ? made.id : partCutting.id!;
                      commit(prepareStudioPreview(updatePartCut(document, id, { consumeTools })));
                      setPartCutting(null);
                    }}
                  />
                )}
              </WorkspaceView>
            </Suspense>
          )}
          {!showWorkspace && show3D && partHasOutline && part && (
            <Suspense fallback={<div className="cad-part-view" />}>
              <PartView3D
                key={part.id}
                part={part}
                document={doc}
                variables={variableScope}
                onChoose={(entry, depth, expression) => commit(withRegionDepth(documentRef.current, part.id, entry, depth, expression))}
                onSketchFace={onEditFaceSketch && faceEditor.create}
                cameraState={partCameraState}
                onSketchSide={
                  studioSession
                    ? (face, snapshot) => {
                        studioCamera.current = assemblyCameraFromPart(documentRef.current, part.id, snapshot);
                        newPartOn({ partId: part.id, face });
                      }
                    : undefined
                }
              />
            </Suspense>
          )}
          {sketchBackdrop && canvasBox && (
            <Suspense fallback={null}>
              <div className="cad-sketch-backdrop-frame" style={canvasBox}>
                {faceSketch?.scene ? (
                  <FaceSketchBackdrop scene={faceSketch.scene} view={sketchBackdrop.view} />
                ) : (
                  <SketchBackdrop
                    document={sketchBackdrop.document}
                    view={sketchBackdrop.view}
                    planes={showPlanes ? basePlaneViews(doc).filter(plane => featureShown(plane.id)) : []}
                    hiddenIds={hiddenParts}
                    onEdges={setPartEdges}
                  />
                )}
              </div>
            </Suspense>
          )}
          <svg
            ref={svg}
            className={`cad-canvas cad-tool-${tool}${sketchBackdrop ? ' cad-canvas-over-parts' : ''}${usingEdges ? ' cad-using-edges' : ''}`}
            style={showWorkspace || (show3D && partHasOutline) ? { display: 'none' } : undefined}
            data-sketch-turned={sketchBackdrop && sketchTurn !== straightOn ? '' : undefined}
            data-testid="cad-canvas"
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
            {/*
             * A turned sketch is turned inside the drawing, not as a whole, so its lines keep their width and its labels
             * and points their shape, however far it's turned.
             */}
            <g
              ref={drawingGroup}
              data-testid="cad-drawing"
              className={turned ? 'cad-drawing-turned' : undefined}
              transform={turned ? turnTransform : undefined}
              style={turned ? ({ '--unturn': unturn } as CSSProperties) : undefined}>
              <defs>
                <pattern id={`cad-grid-${doc.id}`} width={grid} height={grid} patternUnits="userSpaceOnUse">
                  <circle cx="0" cy="0" r={grid * 0.025} fill="#ccd5df" />
                </pattern>
              </defs>
              <rect x={view.x - view.w} y={view.y - view.h} width={view.w * 3} height={view.h * 3} fill={`url(#cad-grid-${doc.id})`} />
              {shownEdges.length > 0 && <PartReferenceGeometry edges={shownEdges} picked={pickedEdges} pixelScale={markerScale} />}
              <SketchRegion
                document={doc}
                partId={part?.id}
                verified={
                  !solving &&
                  !splitFirst &&
                  !(
                    (tool === 'slot' || tool === 'transform' || tool === 'linearPattern' || tool === 'circularPattern') &&
                    selected.length
                  ) &&
                  !((tool === 'slot' || tool === 'fillet' || tool === 'chamfer' || tool === 'transform') && selected.length) &&
                  activeSketchStatus?.status === 'solved' &&
                  lastCheckedRevision.current === `${doc.id}:${doc.revision}`
                }
              />
              {faceSketch && (
                <path
                  data-face-outline
                  className="cad-face-outline"
                  d={faceSketch.outline.map((p, i) => `${i ? 'L' : 'M'}${p.x} ${-p.y}`).join(' ') + ' Z'}
                  pointerEvents="none"
                />
              )}
              {!faceSketch && drawnOnFace && (
                <path
                  data-drawn-on-face
                  className="cad-face-outline"
                  d={drawnOnFace.map((p, i) => `${i ? 'L' : 'M'}${p.x} ${-p.y}`).join(' ') + ' Z'}
                  pointerEvents="none"
                />
              )}
              {faceSketch?.floor && (
                <path
                  data-face-floor
                  d={faceSketch.floor.map((p, i) => `${i ? 'L' : 'M'}${p.x} ${-p.y}`).join(' ') + ' Z'}
                  fill="#c99a5b"
                  fillOpacity={0.25}
                  stroke="#7a5526"
                  strokeWidth={1 / markerScale}
                  pointerEvents="none"
                />
              )}
              {!faceSketch && <CutOverlay part={part} millimetresPerPixel={1 / markerScale} />}
              <line
                x1={view.x - view.w}
                x2={view.x + view.w * 2}
                y1="0"
                y2="0"
                pointerEvents="none"
                stroke="#db9d9d"
                strokeWidth="1"
                vectorEffect="non-scaling-stroke"
              />
              <line
                x1="0"
                x2="0"
                y1={view.y - view.h}
                y2={view.y + view.h * 2}
                pointerEvents="none"
                stroke="#92bfa2"
                strokeWidth="1"
                vectorEffect="non-scaling-stroke"
              />
              {shownSketch && (
                <SketchGeometry
                  entities={shownSketch.entities}
                  selectedIds={[
                    ...dimensionSelection,
                    ...hoveredConstraintEntities,
                    ...selectedConstraints.flatMap(id => associatedEntityIds(sketch, id)),
                  ]}
                  stroke={cornerPreview?.ok || transformPreview?.ok || linearPreview?.ok || slotPreview?.ok ? '#858d96' : stroke}
                  entityStatus={entityStatus}
                  pixelScale={markerScale}
                  hoveredPointId={hoveredPoint}
                  interactive={tool === 'select' && !constraintMode && !fixMode && !placingDimension}
                  onEditConic={id => {
                    const curve = sketch?.entities.find(entity => entity.id === id);
                    if (curve?.type === 'conic') {
                      setRho(String(curve.rho));
                      setConicEditing(id);
                    }
                  }}
                />
              )}
              {tool === 'slot' && slotWidthCircle?.type === 'circle' && slotWidthCenter?.type === 'point' && (
                <SketchSlotWidthHandle
                  center={slotWidthCenter}
                  radius={slotWidthCircle.radius}
                  pixelScale={markerScale}
                  onStart={e => {
                    slotDrag.current = { center: slotWidthCenter, width: slotWidth };
                    svg.current?.setPointerCapture(e.pointerId);
                    svg.current?.focus();
                  }}
                />
              )}
              {tool === 'circularPattern' && selected.length > 0 && parsedCircular.ok && linearPreview?.ok && (
                <SketchCircularPatternManipulator
                  center={parsedCircular.center}
                  anchor={patternAnchor}
                  count={parsedCircular.count}
                  angle={parsedCircular.angle}
                  closed={parsedCircular.closed}
                  pixelScale={markerScale}
                  onEdit={field => {
                    circularFields.current[field]?.focus();
                    circularFields.current[field]?.select();
                  }}
                  onStart={(kind, event) => {
                    const matrix = (drawingGroup.current ?? svg.current)?.getScreenCTM();
                    if (!matrix) return;
                    const raw = new DOMPoint(event.clientX, event.clientY).matrixTransform(matrix.inverse());
                    circularDrag.current = {
                      kind,
                      start: { x: raw.x, y: -raw.y },
                      parameters: circularParameters,
                      last: Math.atan2(-raw.y - parsedCircular.center.y, raw.x - parsedCircular.center.x),
                      sweep:
                        ((parsedCircular.angle * Math.PI) / 180) *
                        (parsedCircular.closed ? (parsedCircular.count - 1) / parsedCircular.count : 1),
                    };
                    svg.current?.setPointerCapture(event.pointerId);
                    svg.current?.focus();
                  }}
                />
              )}
              {tool === 'linearPattern' && selected.length > 0 && parsedLinear.ok && (
                <SketchLinearPatternManipulator
                  anchor={patternAnchor}
                  steps={linearParameters.secondDirection ? [parsedLinear.stepX, parsedLinear.stepY] : [parsedLinear.stepX]}
                  counts={[parsedLinear.countX, parsedLinear.countY]}
                  pixelScale={markerScale}
                  onStart={(index, event) => {
                    patternDrag.current = { index, anchor: patternAnchor, parameters: linearParameters };
                    svg.current?.setPointerCapture(event.pointerId);
                  }}
                  onEdit={field => {
                    patternFields.current[field]?.focus();
                    patternFields.current[field]?.select();
                  }}
                />
              )}
              {tool === 'transform' && selected.length > 0 && parsedTransform.ok && (
                <SketchTransformManipulator
                  pivot={{
                    x: parsedTransform.pivot.x + parsedTransform.translation.x,
                    y: parsedTransform.pivot.y + parsedTransform.translation.y,
                  }}
                  pixelScale={markerScale}
                  onStart={(kind, event) => {
                    const matrix = (drawingGroup.current ?? svg.current)?.getScreenCTM();
                    if (!matrix) return;
                    const raw = new DOMPoint(event.clientX, event.clientY).matrixTransform(matrix.inverse());
                    transformDrag.current = { kind, start: { x: raw.x, y: -raw.y }, parameters: transformParameters };
                    svg.current?.setPointerCapture(event.pointerId);
                  }}
                />
              )}
              {tool === 'split' && splitFirst && (
                <circle
                  cx={splitFirst.point.x}
                  cy={-splitFirst.point.y}
                  r={5 / markerScale}
                  fill="#fff"
                  stroke="#2467d1"
                  vectorEffect="non-scaling-stroke"
                  pointerEvents="none"
                  data-split-first="true"
                />
              )}
              {tool === 'chamfer' &&
                chamferPreview?.ok &&
                chamferPreview.dimensionIds.map((id, side) => {
                  const dimension = chamferPreview.sketch.constraints.find(c => c.id === id);
                  if (dimension?.type !== 'distance') return null;
                  const origin = chamferPreview.sketch.entities.find(e => e.id === dimension.pointAId);
                  const point = chamferPreview.sketch.entities.find(e => e.id === dimension.pointBId);
                  if (origin?.type !== 'point' || point?.type !== 'point') return null;
                  const length = Math.hypot(point.x - origin.x, point.y - origin.y);
                  return (
                    <circle
                      key={side}
                      data-chamfer-handle={side}
                      cx={point.x}
                      cy={-point.y}
                      r={6 / markerScale}
                      fill="#fff"
                      stroke="#2467d1"
                      vectorEffect="non-scaling-stroke"
                      style={{ cursor: 'move' }}
                      onPointerDown={event => {
                        event.stopPropagation();
                        event.preventDefault();
                        chamferDrag.current = {
                          side,
                          origin,
                          direction: { x: (point.x - origin.x) / length, y: (point.y - origin.y) / length },
                          previous: chamferDistances,
                        };
                        svg.current?.setPointerCapture(event.pointerId);
                      }}
                    />
                  );
                })}
              {(tool === 'fillet' || tool === 'chamfer') &&
                cornerPreview &&
                !cornerPreview.ok &&
                cornerPreview.cornerPointIds.map(id => {
                  const point = sketch?.entities.find(entity => entity.type === 'point' && entity.id === id);
                  return point?.type === 'point' ? (
                    <circle
                      key={id}
                      data-fillet-error={id}
                      cx={point.x}
                      cy={-point.y}
                      r={8 / markerScale}
                      fill="#c43b3522"
                      stroke="#c43b35"
                      vectorEffect="non-scaling-stroke"
                      pointerEvents="none"
                    />
                  ) : null;
                })}
              {annotationSketch && showConstraints && (
                <InlineConstraints
                  sketch={annotationSketch}
                  scale={markerScale}
                  selectedConstraintIds={selectedConstraints}
                  conflictedConstraintIds={shownConflicts}
                  interactive={tool === 'select' && !constraintMode && !fixMode && !placingDimension}
                  onSelect={(id, additive) => {
                    setSelectedConstraints(previous =>
                      additive ? (previous.includes(id) ? previous.filter(existing => existing !== id) : [...previous, id]) : [id]
                    );
                    if (!additive) setSelected([]);
                    setDimension(null);
                    setMessage('Constraint selected. Press Delete to remove it; Undo restores it.');
                    svg.current?.focus();
                  }}
                  onHover={(_id, ids) => setHoveredConstraintEntities(ids)}
                  onEdit={editPattern}
                />
              )}
              {annotationSketch &&
                annotationSketch.constraints
                  .filter(numeric)
                  .map(c => (
                    <DimensionGraphics
                      key={c.id}
                      constraint={c}
                      sketch={annotationSketch}
                      pixelScale={markerScale}
                      selected={
                        selectedConstraints.includes(c.id) ||
                        (dimensionFlow.phase === 'placing' && dimensionFlow.existingConstraintId === c.id)
                      }
                      conflicted={shownConflicts.includes(c.id)}
                      interactive={canEditCanvasDimensions}
                      onSelect={additive => selectDimension(c.id, additive)}
                      onEdit={() => editDimension(c.id)}
                      onLabelPointerDown={event => startAnnotationDrag(c.id, event)}
                    />
                  ))}
              {sketch && dimensionDraft && (
                <DimensionGraphics
                  constraint={dimensionDraft}
                  sketch={sketch}
                  pixelScale={markerScale}
                  position={cursor}
                  selected
                  interactive={false}
                />
              )}
              {snapCue && (
                <g pointerEvents="none">
                  <circle
                    cx={snapCue.point.x}
                    cy={-snapCue.point.y}
                    r={5 / markerScale}
                    fill="none"
                    stroke="#bd7b18"
                    strokeWidth="1.5"
                    vectorEffect="non-scaling-stroke"
                  />
                  <text
                    x={snapCue.point.x + 9 / markerScale}
                    y={-snapCue.point.y - 8 / markerScale}
                    fontSize={11 / markerScale}
                    fill="#9b6516">
                    {snapCue.label}
                  </text>
                </g>
              )}
              {modificationPreview && (
                <ModificationPreview
                  sketch={modificationPreview.sketch}
                  curveIds={
                    offsetPreview?.ok
                      ? offsetPreview.entityIds
                      : extendPreview?.ok
                        ? [extendPreview.entityId]
                        : mirrorPreview?.ok
                          ? mirrorPreview.createdEntityIds
                          : []
                  }
                  pixelScale={markerScale}
                />
              )}
              {offsetDimension && offsetPreview?.ok && (
                <DimensionGraphics
                  constraint={offsetDimension}
                  sketch={offsetPreview.sketch}
                  pixelScale={markerScale}
                  interactive={false}
                  showLabel={false}
                />
              )}
              {modification.phase === 'extend' &&
                modification.entityId &&
                sketch &&
                (() => {
                  const curve = sketch.entities.find(e => e.id === modification.entityId);
                  const point =
                    curve &&
                    (curve.type === 'line' || curve.type === 'arc') &&
                    pointsOf(sketch).get(modification.end === 'start' ? curve.startId : curve.endId);
                  return point ? (
                    <circle
                      data-extend-endpoint={modification.end}
                      cx={point.x}
                      cy={-point.y}
                      r={5 / markerScale}
                      fill="none"
                      stroke={SKETCH_APPEARANCE.selectedColor}
                      strokeWidth={1.5}
                      vectorEffect="non-scaling-stroke"
                      pointerEvents="none"
                    />
                  ) : null;
                })()}
              {extendPreview?.ok && extendPreview.kind === 'delete' && (
                <text
                  data-extend-removes-curve="true"
                  x={cursor.x + 10 / markerScale}
                  y={-cursor.y - 10 / markerScale}
                  fontSize={13 / markerScale}
                  fill="#c73535"
                  pointerEvents="none">
                  Remove curve
                </text>
              )}
              <SketchToolPreview
                tool={tool}
                pending={pending}
                cursor={cursor}
                curvePreview={curvePreview}
                tangent={chainPreview?.tangent}
                polygonSides={Number(polygonSides)}
                sweepIntent={centerArcSweep.current?.sweep}
                pixelScale={markerScale}
                construction={construction}
              />
              {sketch && drawingCue && (
                <DrawingInferencePreview
                  inference={drawingCue}
                  orientation={inference.current}
                  axis={tangentAxis.current}
                  start={chainPreview?.point ?? pending[0]}
                  sketch={sketch}
                  pixelScale={markerScale}
                />
              )}
              {selectionBox && (
                <rect
                  data-sketch-selection-box={selectionBox.end.x >= selectionBox.start.x ? 'window' : 'crossing'}
                  x={Math.min(selectionBox.start.x, selectionBox.end.x)}
                  y={-Math.max(selectionBox.start.y, selectionBox.end.y)}
                  width={Math.abs(selectionBox.end.x - selectionBox.start.x)}
                  height={Math.abs(selectionBox.end.y - selectionBox.start.y)}
                  fill={selectionBox.end.x >= selectionBox.start.x ? '#438bd522' : '#32a76a22'}
                  stroke={selectionBox.end.x >= selectionBox.start.x ? '#438bd5' : '#32a76a'}
                  strokeWidth="1"
                  strokeDasharray={selectionBox.end.x >= selectionBox.start.x ? undefined : '4 3'}
                  vectorEffect="non-scaling-stroke"
                  pointerEvents="none"
                />
              )}
            </g>
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
            sections={studioSession ? (showWorkspace ? studioShortcuts : studioSketchShortcuts) : sketchShortcuts}
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
            <StudioCommandSearch disabled={studioDisabled} workspace={root} onOpenChange={setPalette} onCommand={studioCommand} />
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
          {tool === 'slot' && selected.length > 0 && (
            <SketchSlotControls
              width={slotWidth}
              onWidth={setSlotWidth}
              chain={slotChain}
              onChain={setSlotChain}
              inputRef={slotWidthField}
              onApply={acceptSlot}
              onCancel={() => {
                chooseTool('select');
                setSelected([]);
              }}
              error={slotPreview && !slotPreview.ok ? slotPreview.message : undefined}
            />
          )}
          {tool === 'circularPattern' && selected.length > 0 && (
            <SketchCircularPatternControls
              parameters={circularParameters}
              onChange={setCircularParameters}
              onApply={acceptCircularPattern}
              onCancel={() => {
                chooseTool('select');
                setSelected([]);
              }}
              error={linearPreview && !linearPreview.ok ? linearPreview.message : undefined}
              previewLimited={parsedCircular.ok && parsedCircular.count > 10}
              releasedCount={linearPreview?.ok ? linearPreview.releasedConstraintIds.length : 0}
              onField={(key, element) => {
                if (element) circularFields.current[key] = element;
                else delete circularFields.current[key];
              }}
            />
          )}
          {tool === 'linearPattern' && selected.length > 0 && (
            <SketchLinearPatternControls
              parameters={linearParameters}
              onChange={setLinearParameters}
              onApply={acceptLinearPattern}
              onCancel={() => {
                chooseTool('select');
                setSelected([]);
              }}
              error={linearPreview && !linearPreview.ok ? linearPreview.message : undefined}
              releasedCount={linearPreview?.ok ? linearPreview.releasedConstraintIds.length : 0}
              previewLimited={parsedLinear.ok && parsedLinear.countX * parsedLinear.countY > 10}
              onField={(key, element) => {
                if (element) patternFields.current[key] = element;
                else delete patternFields.current[key];
              }}
            />
          )}
          {patternNotice && (
            <div className="cad-create-size" role="status">
              {patternNotice}
            </div>
          )}
          {tool === 'transform' && selected.length > 0 && (
            <SketchTransformControls
              parameters={transformParameters}
              onChange={next => {
                if (next.pivotX !== transformParameters.pivotX || next.pivotY !== transformParameters.pivotY) {
                  const parsed = parseTransformParameters(next, lengthUnit);
                  setTransformParameters(parsed.ok ? repositionTransformPivot(transformParameters, parsed.pivot, lengthUnit) : next);
                } else setTransformParameters(next);
              }}
              onApply={acceptTransform}
              onCancel={() => {
                chooseTool('select');
                setSelected([]);
              }}
              error={transformPreview && !transformPreview.ok ? transformPreview.message : undefined}
              releasedCount={transformPreview?.ok ? transformPreview.releasedConstraintIds.length : 0}
            />
          )}
          {transformNotice && (
            <div className="cad-create-size" role="status">
              {transformNotice}
            </div>
          )}
          {tool === 'split' && splitNotice && (
            <div className="cad-create-size" role="status">
              {splitNotice}
            </div>
          )}
          {tool === 'chamfer' && selected.length > 0 && (
            <SketchChamferForm
              distances={chamferDistances}
              preview={chamferPreview}
              selection={chamferSelection}
              onDistances={setChamferDistances}
              onApply={acceptChamfer}
              onCancel={() => {
                chooseTool('select');
                setSelected([]);
              }}
            />
          )}
          {tool === 'fillet' && selected.length > 0 && (
            <SketchFilletForm
              inputRef={filletInput}
              radius={filletRadius}
              preview={filletPreview}
              onRadius={setFilletRadius}
              onFocus={() => setFilletEditing(true)}
              onApply={acceptFillet}
              onCancel={() => {
                chooseTool('select');
                setSelected([]);
              }}
            />
          )}
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
        <span className={problems.length && !inProgress ? 'cad-error' : ''}>
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
      {!acceptanceNotice && <SketchProblems problems={problems} inProgress={inProgress} />}
    </div>
  );
  return <DesignUnitContext value={lengthUnit}>{content}</DesignUnitContext>;
}
