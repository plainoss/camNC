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
  CAD_GEOMETRY_TOLERANCE,
  addArc,
  addInscribedPolygon,
  addCircumscribedPolygon,
  addCenterPointArc,
  centerPointArcFromPoints,
  addBezier,
  addCircle,
  addThreePointCircle,
  addEllipse,
  addConic,
  addCenterRectangle,
  addConstraint,
  addLine,
  addPoint,
  addRectangle,
  addAlignedRectangle,
  addSpline,
  createCadPart,
  constraintEntityIds,
  dimensionValueError,
  entityPointIds as curvePointIds,
  filletLineCorners,
  chamferLineCorners,
  splitSketchCurve,
  transformSketchEntities,
  sketchPatternOwner,
  linearPatternSketchEntities,
  circularPatternSketchEntities,
  patternDeletionNotice,
  slotDeletionNotice,
  isClosedSketchCurve,
  evaluateCurvePoint,
  resolveChamferCorners,
  extendSketchCurve,
  mirrorSketchEntities,
  offsetSketch,
  insertCurveControlPoint,
  isSplineTangentHandle,
  isOwnedSplineHandle,
  removeEntity,
  originId,
  newCadId,
  pointEquivalence,
  resolveFilletCorners,
  setConicRho,
  setDimensionDriven,
  tessellateCurve,
  updateDimension,
  visibleSketchPointIds,
  withDimensionPlacement,
  type CadConstraint,
  type CadDimension,
  type CadDimensionMode,
  type CadDocument,
  type CadDrawnOn,
  type CadEntity,
  type CadPart,
  type CadSketch,
  type CadSketchSolveStatus,
  type CadSolveOptions,
  addFaceSketch,
  evaluateCadPart,
  moveFaceSketch,
  removeCadFeature,
  removeCadVariable,
  cadCopyName,
  setCadVariable,
  type CadFaceRef,
  setCutDepth,
  setCutSuppressed,
  withFeatureVersion,
  type CadPoint,
  cadVariableProblems,
  drawnOnOutline,
  cadFaceFrame,
  extrudeRemove,
  cadDrawnOnSupports,
  CAD_IDENTITY_PLACEMENT,
  withFaceEdges,
  cadVariableScope,
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
  type KeyboardEvent,
  type PointerEvent,
  type Ref,
} from 'react';
import { prepareDimensionCreation, solveCadDocument } from './solveCad';
import { acquireCadKeyboard } from './keyboardOwnership';
import {
  amendCadSession,
  acceptCadSession,
  cadCommandCheckpoint,
  cadSession,
  commitCadSession,
  endCadSession,
  redoCadSession,
  undoCadSession,
  type CadCommandCheckpoint,
} from './session';
import { DimensionGraphics } from './DimensionGraphics';
import {
  idleDimensionWorkflow,
  transitionDimensionWorkflow,
  type DimensionWorkflow,
  type DimensionWorkflowEvent,
} from './dimensionWorkflow';
import { idleDrawingGesture, transitionDrawingGesture, type DrawingGesture } from './drawingGesture';
import { advanceCreationValue, beginCreationValues, creationValueAnchor, creationValueAt, type CreationValues } from './creationValues';
import { CreationValueControls } from './CreationValueControls';
import { CadValueInput } from './CadValueInput';
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
import { formatCadValue, parseCadValue } from './valueExpressions';
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
  pickSketchContextTarget,
  selectedSketchContextTarget,
  toggleContextConstruction,
  transitionSketchContextPress,
  type SketchContext,
  type SketchContextAction,
  type SketchContextPress,
  type SketchContextTarget,
} from './sketchContext';
import { dimensionAnchor } from './dimensionGeometry';
import { tangentArcFrom, threePointArc } from './geometry';
import { trimSketchCurveAt } from './trimCurves';
import { pickBezierControlPolygon, pickSketchPoint, pickSketchSnap, type CadSnapResult } from './picking';
import { inferDrawingPoint, inferredPointConstraints, type CadDrawingInference } from './drawingInference';
import { DrawingInferencePreview } from './DrawingInferencePreview';
import { tangentLineAxis, type InferredLineAxis } from './lineInference';
import { buildConstraintForSelection, constraintPrompt, type ConstraintCommandTool } from './constraintCommands';
import { cadViewState, saveCadViewState } from './viewState';
import { dragTargets, hasDragMovement } from './drag';
import { dragSnapConstraints, inferDragPoint } from './dragSnap';
import { boxSelectSketch, type CadSelectionBox } from './boxSelection';
import { constraintColorNotice, sketchDofStatus, sketchFeedback } from './sketchFeedback';
import { isDemoMode } from '@/lib/demo/demo-mode';
import { CommandSearch, type SearchCommand } from './CommandSearch';
import { SketchToolbar } from './SketchToolbar';
import { cutRegionAt, cutRegions, topRegions, withRegionDepth, type CutRegion } from './cutRegions';
import { CutOverlay } from './CutOverlay';
import { PartFeatureList } from './PartFeatureList';
import { RegionDepthField } from './RegionDepthField';
import { sketchTools as tools, type SketchTool } from './sketchTools';
import { SketchGeometry } from './SketchGeometry';
import { SketchRegion } from './SketchRegion';
import { SketchToolPreview } from './SketchToolPreview';
import { ModificationControls } from './ModificationControls';
import { ModificationPreview } from './ModificationPreview';
import {
  beginModification,
  idleModificationWorkflow,
  modificationSourceIds,
  transitionModification,
  type ModificationWorkflow,
} from './modificationWorkflow';
import { useSvgPixelScale, SKETCH_APPEARANCE } from './sketchAppearance';
import { InlineConstraints } from './inlineConstraints';
import { associatedEntityIds, removeInlineConstraint } from './inlineConstraintLayout';
import { StudioToolbar, type StudioCommand } from './StudioToolbar';
import { FeatureDialog } from './FeatureDialog';
import { FeatureList, type FeatureAction, type FeatureEntry } from './FeatureList';
import { VariableDialog } from './VariableDialog';
import type { BasePlane } from './basePlanes';
import { designSteps, rolledBackTo, type DesignStep } from './designSteps';
import type { PartEdge } from './partEdges';
import { drawingMatrix, edgeOn, normalTurn, straightOn, turnAxes, turnedBy, type SketchTurn } from './sketchOrbit';
import { ExtrudeDialog, type ExtrudeRemoval, PartPatternDialog, TransformDialog } from './PartFeatureDialogs';
import { useProvideCadVariableFields, type CadVariableFields } from './variableFields';
import './cad.css';

type Point = { x: number; y: number };
type SketchPoint = Extract<CadEntity, { type: 'point' }>;
type NumericConstraint = Extract<CadConstraint, { value: number }>;
type Tool = SketchTool;
type DimensionMode = CadDimensionMode;
type ConstraintTool = ConstraintCommandTool;
type ChainAnchor = { pointId: string; curveId: string };
const snapLabels: Record<CadSnapResult['kind'], string> = {
  endpoint: 'Endpoint',
  center: 'Center',
  point: 'Point',
  midpoint: 'Midpoint',
  pointOnCurve: 'On curve',
};
interface DragGesture {
  origin: Point;
  target: Point;
  document: CadDocument;
  preview: CadDocument;
  partId: string;
  selectedIds: string[];
  points: string[];
  radiusEntityId?: string;
  moved: boolean;
  request: number;
  solvedRequest: number;
  working: boolean;
  ended: boolean;
  failure?: string;
  snapPointId?: string;
  dropInference?: CadDrawingInference | null;
}
interface BoxGesture extends CadSelectionBox {
  screenStart: Point;
  selected: string[];
  additive: boolean;
  moved: boolean;
}
interface AnnotationGesture {
  id: string;
  document: CadDocument;
  screenStart: Point;
  worldStart: Point;
  position: Point;
  moved: boolean;
}

type View = { x: number; y: number; w: number; h: number };
const initialView: View = { x: -35, y: -175, w: 300, h: 210 };
const rounded = (n: number) => Math.round(n * 100) / 100;
const numeric = (c: CadConstraint): c is NumericConstraint => 'value' in c;

const pointsOf = (sketch: CadSketch) => new Map(sketch.entities.flatMap(e => (e.type === 'point' ? [[e.id, e] as const] : [])));
const editable = (target: EventTarget | null) =>
  target instanceof HTMLElement && !!target.closest('input:not([type="checkbox"]),textarea,select,[contenteditable]');
const entityPointIds = (entity: CadEntity): string[] => {
  if (entity.type === 'point') return [entity.id];
  return curvePointIds(entity);
};
const PartView3D = lazy(() => import('./PartView3D'));
const WorkspaceView = lazy(() => import('./WorkspaceView'));
const SketchBackdrop = lazy(() => import('./SketchBackdrop'));
/** A face sketch is drawn over the part's outline, so a part needs one first. */
/** A sketch of one straight line and nothing else, as a board drawn edge-on is. */
const isSingleLine = (part: CadPart) => {
  const curves = part.sketch.entities.filter(entity => entity.type !== 'point' && !entity.construction);
  return curves.length === 1 && curves[0]!.type === 'line';
};
/** A part with nothing drawn yet, such as a new design's first: the studio asks what it's sketched on first. */
const isBlank = (part: CadPart) => !part.drawnOn && part.sketch.entities.every(entity => entity.type === 'point' && entity.fixed);
const hasOutline = (document: CadDocument, partId: string) => !!evaluateCadPart(document.parts.find(part => part.id === partId)!).part;
function replacePart(document: CadDocument, partId: string, change: (part: CadPart) => CadPart): CadDocument {
  return { ...document, parts: document.parts.map(p => (p.id === partId ? change(p) : p)) };
}
function chainGeometry(sketch: CadSketch, chain: ChainAnchor | null) {
  if (!chain) return null;
  const points = pointsOf(sketch);
  const point = points.get(chain.pointId);
  const curve = sketch.entities.find(e => e.id === chain.curveId);
  if (!point || !curve) return null;
  if (curve.type === 'line') {
    const other = points.get(curve.startId === point.id ? curve.endId : curve.startId);
    if (other) return { point, tangent: { x: point.x - other.x, y: point.y - other.y }, curve };
  }
  if (curve.type === 'arc') {
    const center = points.get(curve.centerId);
    if (center) {
      const direction = curve.endId === point.id ? 1 : -1;
      return { point, tangent: { x: -(point.y - center.y) * direction, y: (point.x - center.x) * direction }, curve };
    }
  }
  return null;
}

export interface CadEditorController {
  /** Commit valid open value fields to the draft without accepting it or navigating. */
  prepareDocument: () => CadDocument | null;
  /** Use the same validation and accepted-session boundary as the Finish button. */
  finish: () => Promise<boolean>;
}

export interface CadEditorProps {
  document: CadDocument;
  onDraftChange: (document: CadDocument) => void;
  onFinish: (document: CadDocument) => void | Promise<void>;
  onCancel: () => void | Promise<void>;
  onFinishBlocked?: (reason: string) => void;
  saveStatus?: string;
  notice?: string | null;
  preferredPartId?: string;
  controller?: Ref<CadEditorController>;
  /** Hosts that can open a face sketch offer drawing on the part's top face. */
  onEditFaceSketch?: (document: CadDocument, partId: string, sketchId: string) => void;
  /** Editing one face sketch, with the part's outline shown behind it. It can be open, and it isn't a profile. */
  faceSketch?: { outline: CadPoint[]; floor?: CadPoint[]; label: string; below?: boolean };
  /** Open in 3D, when there's an outline to show: the whole design, or with `'part'` the selected part on its own. */
  startIn3D?: boolean | 'part';
}

/** Native editable source stays in one document while CAM remains a derived consumer of accepted revisions. */
export function CadEditor({
  document: initialDocument,
  onDraftChange,
  onFinish,
  onCancel,
  onFinishBlocked,
  saveStatus,
  notice,
  preferredPartId,
  controller,
  onEditFaceSketch,
  faceSketch,
  startIn3D,
}: CadEditorProps) {
  const [session] = useState(() => cadSession(initialDocument));
  const [doc, setDocument] = useState(session.document);
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
  const [view, setView] = useState(savedView.view);
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
  const [width, setWidth] = useState('100');
  const [height, setHeight] = useState('60');
  const [radius, setRadius] = useState('10');
  const [slotWidth, setSlotWidth] = useState('10');
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
  const [linearParameters, setLinearParameters] = useState(initialLinearPatternParameters);
  const [patternEditId, setPatternEditId] = useState<string | null>(null);
  const [patternNotice, setPatternNotice] = useState('');
  const patternCommandId = useRef('');
  const patternFields = useRef<Partial<Record<Exclude<keyof LinearPatternParameters, 'secondDirection'>, HTMLInputElement>>>({});
  const patternDrag = useRef<{ index: number; anchor: CadPoint; parameters: LinearPatternParameters } | null>(null);
  const [transformParameters, setTransformParameters] = useState(initialTransformParameters);
  const [transformNotice, setTransformNotice] = useState('');
  const transformDrag = useRef<{ kind: TransformDragKind; start: CadPoint; parameters: TransformParameters } | null>(null);
  const [splitNotice, setSplitNotice] = useState('');
  const [splitFirst, setSplitFirst] = useState<{ entityId: string; parameter: number; point: CadPoint } | null>(null);
  const chamferDrag = useRef<{ side: number; origin: CadPoint; direction: CadPoint; previous: string[] } | null>(null);
  const [chamferDistances, setChamferDistances] = useState(['10', '10']);
  const [filletRadius, setFilletRadius] = useState('10');
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
  const startsBlank = startIn3D === true && !faceSketch && doc.parts.length === 1 && isBlank(doc.parts[0]!);
  const [showWorkspace, setShowWorkspace] = useState(
    () => startIn3D === true && (startsBlank || doc.parts.some(candidate => hasOutline(doc, candidate.id)))
  );
  const sketchOnly = !!faceSketch;
  // Opened as a Part Studio: the studio is home, a sketch is opened from it and closed back to it, and steps are set
  // in dialogs over the view.
  const studioSession = startIn3D !== undefined && !faceSketch;
  // A "cut parts" step being added, or the one being changed.
  const [partCutting, setPartCutting] = useState<{ id?: string } | null>(null);
  // A part clicked while a cut-parts step is open, which goes into the box being filled, and what both boxes hold.
  const [cutPick, setCutPick] = useState<{ partId: string; seq: number } | null>(null);
  const [cutPicked, setCutPicked] = useState<string[]>([]);
  const showCutPicked = useCallback(
    ({ tools, targets }: { tools: string[]; targets: string[] }) => setCutPicked([...tools, ...targets]),
    []
  );
  const pickForCut = (partId: string) => setCutPick(previous => ({ partId, seq: (previous?.seq ?? 0) + 1 }));
  // A part's step open in its dialog, with the design as it was when it opened, to go back to on cancel.
  const [featureDialog, setFeatureDialog] = useState<{
    kind: 'extrude' | 'pattern';
    partId: string;
    before: CadDocument;
    /** Set while the extrude is a Remove, with the design as it was as a part, to go back to on New. */
    remove?: ExtrudeRemoval & { solid: CadDocument };
  } | null>(null);
  // Picking the plane or face a new part is sketched on.
  const [choosingFace, setChoosingFace] = useState(startsBlank);
  // A base plane picked in the studio, in its view or feature list, for the next sketch to be drawn on.
  const [selectedPlane, setSelectedPlane] = useState<BasePlane | null>(null);
  // The face of the part last clicked in the studio, which the next sketch is drawn on, as with a picked plane.
  const [selectedFace, setSelectedFace] = useState<Extract<CadDrawnOn['on'], { partId: string }> | null>(null);
  // A picked face goes with its part.
  useEffect(() => {
    if (selectedFace && !doc.parts.some(candidate => candidate.id === selectedFace.partId)) setSelectedFace(null);
  }, [doc.parts, selectedFace]);
  // Where the drawing sits in its pane, for the parts shown behind a sketch to line up with it.
  const [canvasBox, setCanvasBox] = useState<{ left: number; top: number; width: number; height: number } | null>(null);
  // How far the open sketch's view is turned off straight at its plane, by right-dragging; `n` turns it back.
  const [sketchTurn, setSketchTurn] = useState<SketchTurn>(straightOn);
  // The edges of the parts behind a studio sketch, laid on its plane, and those picked to use in it with `u`.
  const [partEdges, setPartEdges] = useState<PartEdge[]>([]);
  const [pickedEdges, setPickedEdges] = useState<string[]>([]);
  // Parts hidden from the studio's view by their eye in the parts list.
  const [hiddenParts, setHiddenParts] = useState<ReadonlySet<string>>(() => new Set());
  // A variable being added, or the one being changed.
  const [variableDialog, setVariableDialog] = useState<{ id?: string } | null>(null);
  // Why something asked for in the studio wasn't done, such as deleting a variable that's in use.
  const [studioRefusal, setStudioRefusal] = useState<string | null>(null);
  // A part being copied by a transform, or the transformed copy being changed.
  const [transformDialog, setTransformDialog] = useState<{ partId: string; copyId?: string } | null>(null);
  // The design as it was when the open sketch was opened from the studio, to go back to if it's cancelled.
  // A sketch open from the start, such as a new design's first, goes back to the design as it opened.
  const sketchBefore = useRef<CadDocument | null>(studioSession && !showWorkspace ? doc : null);
  // A part sketched new, whose extrude opens once its sketch is closed. A new design's first part is one.
  const extrudeAfterSketch = useRef<string | null>(null);
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
    if (studioSession && !showWorkspace && !show3D) svg.current?.focus();
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
  // Every value field can use the design's variables by name.
  const variableScope = useMemo(() => cadVariableScope(doc), [doc]);
  // What every value field offers after `#`, and how it makes a variable from `#name = value`.
  const variableFields = useMemo<CadVariableFields>(
    () => ({
      variables: (doc.variables ?? []).map(variable => {
        const result = variableScope[variable.name];
        const unitText = result?.kind === 'length' ? ' mm' : result?.kind === 'angle' ? '°' : '';
        return { name: variable.name, shown: result ? `${formatCadValue(result.value)}${unitText}` : variable.expression };
      }),
      define: (name, expression) => {
        const current = documentRef.current;
        const existing = current.variables?.find(variable => variable.name === name);
        const result = setCadVariable(current, { ...(existing && { id: existing.id }), name, expression });
        if ('error' in result) return result.error;
        commit(result.document);
        return null;
      },
    }),
    // commit and documentRef are stable for the session.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [doc.variables, variableScope]
  );
  useProvideCadVariableFields(variableFields);
  // The step being edited in its dialog. Like the reference, the studio shows the design only as far as that step.
  const rollbackStep =
    !studioSession || !showWorkspace
      ? null
      : featureDialog
        ? featureDialog.kind === 'extrude'
          ? `${featureDialog.partId}:extrude`
          : (doc.parts.find(candidate => candidate.id === featureDialog.partId)?.pattern?.id ?? null)
        : (partCutting?.id ?? null);
  const shownDocument = useMemo(() => (rollbackStep ? rolledBackTo(doc, rollbackStep) : doc), [doc, rollbackStep]);
  documentRef.current = doc;
  const callbacks = useRef({ onDraftChange, onFinish, onCancel, onFinishBlocked });
  const finishing = useRef(false);
  const preparingDimension = useRef(false);
  const mounted = useRef(true);
  callbacks.current = { onDraftChange, onFinish, onCancel, onFinishBlocked };
  const deferredCanvasFocus = useRef<(() => void) | null>(null);
  useLayoutEffect(() => {
    if (!busy) {
      const restore = deferredCanvasFocus.current;
      deferredCanvasFocus.current = null;
      restore?.();
    }
  }, [busy]);
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
  }, [sketch, filletSelection, filletRadius, variableScope]);
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
  }, [sketch, chamferSelection, chamferDistances, selected, variableScope]);
  const cornerPreview = tool === 'chamfer' ? chamferPreview : filletPreview;
  const parsedTransform = useMemo(() => parseTransformParameters(transformParameters), [transformParameters]);
  const transformPreview = useMemo(() => {
    if (!sketch || tool !== 'transform' || !selected.length) return null;
    return parsedTransform.ok ? transformSketchEntities(sketch, { ...parsedTransform, entityIds: selected }) : parsedTransform;
  }, [sketch, tool, selected, parsedTransform]);
  const parsedCircular = useMemo(() => parseCircularPatternParameters(circularParameters), [circularParameters]);
  const parsedLinear = useMemo(() => parseLinearPatternParameters(linearParameters, variableScope), [linearParameters, variableScope]);
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
    () => (sketch && tool === 'slot' && selected.length ? previewSlot(sketch, selected, slotWidth, slotChain, sharedSlotWidth) : null),
    [sketch, tool, selected, slotWidth, slotChain, sharedSlotWidth]
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
  }, [sketch, modification, variableScope]);
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
  }, [sketch, pending, cursor, tool, rho, construction, markerScale]);
  useEffect(() => {
    svg.current?.focus();
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

  useEffect(() => {
    const canvas = svg.current;
    if (!canvas) return;
    const zoom = (event: WheelEvent) => {
      if (!event.deltaY) return;
      event.preventDefault();
      const matrix = canvas.getScreenCTM();
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
    setFinishError(null);
    documentRef.current = next;
    setDocument(next);
    callbacks.current.onDraftChange(next);
  };
  const commit = (next: CadDocument) => publish(commitCadSession(session, next));
  const changeSketch = (next: CadSketch) => part && commit(replacePart(documentRef.current, part.id, p => ({ ...p, sketch: next })));

  const solveDrag = async (moving: DragGesture) => {
    if (moving.working || (moving.failure && !moving.ended)) return;
    moving.working = true;
    const fail = (reason: string) => {
      moving.failure = `Drag cancelled. ${reason}`;
      moving.preview = moving.document;
      documentRef.current = moving.document;
      setDocument(moving.document);
      setDrawingCue(null);
      setSnapCue(null);
      setMessage(moving.failure);
    };
    try {
      // Keep only the latest pointer intent while the worker is busy.
      while (drag.current === moving && !moving.failure && moving.solvedRequest < moving.request) {
        const request = moving.request;
        const sourcePart = moving.document.parts.find(p => p.id === moving.partId)!;
        const source = sourcePart.sketch;
        const options: CadSolveOptions = {};
        if (moving.radiusEntityId) {
          const circle = source.entities.find(e => e.id === moving.radiusEntityId);
          const center = circle?.type === 'circle' ? source.entities.find(e => e.id === circle.centerId) : undefined;
          if (center?.type === 'point')
            options.radiusDrag = {
              entityId: moving.radiusEntityId,
              radius: Math.max(0.1, Math.hypot(moving.target.x - center.x, moving.target.y - center.y)),
            };
        } else
          options.drag = dragTargets(source, moving.selectedIds, {
            x: moving.target.x - moving.origin.x,
            y: moving.target.y - moving.origin.y,
          });
        const result = await solveCadDocument({ ...moving.document, parts: [sourcePart] }, options);
        if (drag.current !== moving) return;
        moving.solvedRequest = request;
        const restarted = result.diagnostics.find(diagnostic => diagnostic.code === 'solver-restarted');
        if (restarted) {
          fail(restarted.message);
          break;
        }
        if (result.sketches.length && result.sketches.every(s => s.status === 'solved')) {
          moving.preview = replacePart(moving.document, moving.partId, () => result.document.parts[0]!);
          documentRef.current = moving.preview;
          setDocument(moving.preview);
        }
      }
    } catch (error) {
      if (drag.current === moving) {
        const reason = error instanceof Error ? error.message : String(error);
        fail(`${reason} Your sketch is unchanged; try dragging again.`);
      }
    } finally {
      moving.working = false;
      if (drag.current === moving && moving.ended) {
        let accepted = moving.preview;
        let appliedAutomatic = false;
        if (!moving.failure && moving.snapPointId && moving.dropInference && moving.moved) {
          const previewPart = accepted.parts.find(part => part.id === moving.partId)!;
          const proposals = dragSnapConstraints(previewPart.sketch, moving.snapPointId, moving.dropInference, {
            project: projectPoint,
            tolerancePx: 1,
          });
          if (proposals.length) {
            let snapped = previewPart.sketch;
            for (const proposal of proposals) snapped = addConstraint(snapped, proposal);
            try {
              const result = await solveCadDocument({ ...accepted, parts: [{ ...previewPart, sketch: snapped }] });
              if (
                drag.current === moving &&
                result.sketches.every(state => state.status === 'solved') &&
                result.diagnostics.every(
                  diagnostic => diagnostic.severity !== 'error' || ['open-profile', 'empty-sketch'].includes(diagnostic.code)
                )
              ) {
                accepted = replacePart(accepted, moving.partId, () => result.document.parts[0]!);
                appliedAutomatic = true;
              } else if (drag.current === moving) {
                const restarted = result.diagnostics.find(diagnostic => diagnostic.code === 'solver-restarted');
                setMessage(
                  restarted
                    ? 'Point moved. The solver engine reset, so the automatic constraint was not applied. Try snapping the point again.'
                    : 'Point moved. The automatic constraint could not be applied; adjust the geometry and try again.'
                );
              }
            } catch (error) {
              if (drag.current === moving)
                setMessage(
                  `Point moved. The automatic constraint was not applied. ${error instanceof Error ? error.message : String(error)}`
                );
            }
          }
        }
        if (drag.current === moving) {
          drag.current = null;
          if (!moving.failure && (appliedAutomatic || hasDragMovement(moving.document, accepted))) commit(accepted);
          else {
            documentRef.current = moving.document;
            setDocument(moving.document);
            requestSketchCheck();
            setMessage(
              moving.failure ?? 'The current constraints keep this geometry in place. Edit a dimension or remove a constraint to move it.'
            );
          }
          setBusy(false);
          restoreCanvasKeyboard();
        }
      }
    }
  };

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
        const feedback = sketchFeedback(result);
        setProblems(feedback.problems);
        setConflictedConstraints(feedback.conflictedConstraintIds);
        setInProgress(feedback.inProgress);
        // A part's profile comes first and is what the editor shows, whatever its face sketches report.
        setSketchStatuses(Object.fromEntries([...result.sketches].reverse().map(state => [state.partId, state])));
        setStatus(feedback.status);
        // Solver normalization belongs to the same user command, never another undo entry.
        if (result.sketches.some(s => s.status === 'solved') && JSON.stringify(result.document) !== JSON.stringify(documentRef.current)) {
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
  }, [doc, session, checkEpoch, sketchOnly]);

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
  const editDimension = (id: string) => {
    newDimensionCommand.current = null;
    setDimensionFlow(previous => idleDimensionWorkflow(previous.mode));
    setSelectedConstraints([id]);
    setSelected([]);
    const constraint = sketch?.constraints.find(c => c.id === id);
    if (constraint && numeric(constraint) && constraint.driven) {
      setDimension(null);
      setMessage('Reference dimensions follow the geometry. Change it to driving from its context menu to edit the value.');
      svg.current?.focus();
      return;
    }
    setDimension(id);
    setMessage('Enter a dimension. Enter applies it; Escape cancels.');
  };
  const startAnnotationDrag = (id: string, event: PointerEvent<SVGGElement>) => {
    if (event.button !== 0 || event.shiftKey || event.ctrlKey || event.metaKey || busy || solving || !sketch) return;
    const constraint = sketch.constraints.find(c => c.id === id);
    const matrix = svg.current?.getScreenCTM();
    const position = constraint && numeric(constraint) ? dimensionAnchor(constraint, sketch, markerScale) : null;
    if (!matrix || !position) return;
    const point = new DOMPoint(event.clientX, event.clientY).matrixTransform(matrix.inverse());
    event.preventDefault();
    selectDimension(id);
    annotationDrag.current = {
      id,
      document: documentRef.current,
      screenStart: { x: event.clientX, y: event.clientY },
      worldStart: { x: point.x, y: -point.y },
      position,
      moved: false,
    };
    // Keep fast drags/releases outside the canvas owned by this label, including ordinary double-clicks.
    event.currentTarget.setPointerCapture(event.pointerId);
    svg.current?.focus();
  };
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
  const chooseTool = (next: Tool) => {
    slotDrag.current = null;
    if (next === 'slot') {
      setSlotWidth('10');
      setSlotChain(false);
      setSharedSlotWidth(undefined);
    }
    circularDrag.current = null;
    patternDrag.current = null;
    setPatternEditId(null);
    setPatternNotice('');
    if (next === 'circularPattern') {
      setCircularParameters(initialCircularPatternParameters());
      patternCommandId.current = newCadId();
    }
    if (next === 'linearPattern') {
      setLinearParameters(initialLinearPatternParameters());
      patternCommandId.current = newCadId();
    }

    setContextMenu(null);
    transformDrag.current = null;
    setTransformNotice('');
    if (next === 'transform') setTransformParameters(initialTransformParameters(transformSelectionCenter(selected)));
    contextPress.current = { phase: 'idle' };
    setCreationValues(null);
    drawingGesture.current = idleDrawingGesture();
    setConstraintMode(null);
    setDimension(null);
    setPalette(false);
    setFilletEditing(false);
    setSplitFirst(null);
    setSplitNotice('');
    chamferDrag.current = null;
    setConicEditing(null);
    setModification(idleModificationWorkflow());
    setHoveredModifyCurve(null);
    setModifyTarget(null);
    newCurveCommand.current = null;
    boxGesture.current = null;
    setSelectionBox(null);
    tangentAxis.current = null;
    hoveredReferences.current = [];
    lastDrawingHint.current = null;
    setDrawingCue(null);
    setSnapCue(null);
    newDimensionCommand.current = null;
    setSelectedConstraints([]);
    setHoveredConstraintEntities([]);
    setDimensionFlow(previous => idleDimensionWorkflow(previous.mode));
    if (next === 'line' && tool === 'arc' && contextualArc && lineContinuation && chain) {
      setTool('line');
      setContextualArc(false);
      setMessage('Click the next line endpoint, or press A to continue with an arc.');
      svg.current?.focus();
      return;
    }
    if (next === 'arc' && tool === 'line' && pending[0]) {
      const anchor = sketch && chainGeometry(sketch, chain);
      const start = anchor?.point ?? pending[0];
      setTool('arc');
      setContextualArc(true);
      setPending([{ x: start.x, y: start.y }]);
      setConstraintMode(null);
      setDimension(null);
      setPalette(false);
      setMessage('From the current endpoint: click the arc end, then a point on the arc.');
      svg.current?.focus();
      return;
    }
    if (next === 'tangentArc' && tool === 'tangentArc') {
      setTool('line');
      setMessage('Click the next line endpoint, or press Shift+A to continue with a tangent arc.');
      svg.current?.focus();
      return;
    }
    if (next === tool && next !== 'select') next = 'select';
    if (sketch && (next === 'offset' || next === 'mirror' || next === 'extend')) {
      setModification(beginModification(sketch, next, selected));
      setSelected(modificationSourceIds(sketch, selected, next));
    }
    if (next === 'tangentArc') {
      const anchor = sketch && chainGeometry(sketch, chain);
      if (!anchor || !lineContinuation) {
        setTool(next);
        setPending([]);
        setChain(null);
        setLineContinuation(false);
        setMessage('Click an endpoint of a line or arc, then click the tangent arc end.');
        svg.current?.focus();
        return;
      }
      setTool(next);
      setConstraintMode(null);
      setDimension(null);
      setPalette(false);
      setPending([{ x: anchor.point.x, y: anchor.point.y }]);
      setMessage('Click the end of the tangent arc. The line tool resumes automatically.');
      svg.current?.focus();
      return;
    }
    setTool(next);
    setContextualArc(false);
    setConstraintMode(null);
    setChain(null);
    pendingSnaps.current = [];
    setPending([]);
    setLineContinuation(false);
    setPalette(false);
    setDimension(null);
    setMessage(
      next === 'offset'
        ? 'Select curves to offset. Type a distance or press Enter to edit; click to place. Shift-click adds curves.'
        : next === 'mirror'
          ? selected.length
            ? 'Select the mirror line.'
            : 'Select entities, then choose Mirror line.'
          : next === 'extend'
            ? 'Select near the end to extend, then click its new end or a boundary.'
            : next === 'select'
              ? 'Click geometry to select. Drag to move. Shift-click adds to selection.'
              : next === 'rectangle' || next === 'centerRectangle'
                ? `Click or drag from the ${next === 'centerRectangle' ? 'center' : 'first corner'} to the opposite corner. Or enter sizes below.`
                : next === 'inscribedPolygon' || next === 'circumscribedPolygon'
                  ? 'Click the center, set the construction circle, then choose 3–50 sides and click or press Enter.'
                  : next === 'alignedRectangle'
                    ? 'Click the first edge start and end, then the perpendicular extent.'
                    : next === 'ellipse'
                      ? 'Click the center, then the first axis radius, then the second axis radius.'
                      : next === 'threePointCircle'
                        ? 'Click three points along the circle circumference.'
                        : next === 'circle'
                          ? 'Click or drag from the center to a point on the circle. Or enter a radius below.'
                          : next === 'centerPointArc'
                            ? 'Click the arc center, start, then end. Move around the center to choose its sweep.'
                            : next === 'arc'
                              ? 'Click the start, end, then a point on the arc.'
                              : next === 'point'
                                ? 'Click to place a sketch point. Snap to endpoints, midpoints or curves, or place it freely.'
                                : next === 'line'
                                  ? 'Click or drag from start to end. Lines continue from the last endpoint; Escape ends the chain.'
                                  : next === 'slot'
                                    ? 'Select source curves, set the slot diameter, then click empty space or press Enter. Select more paths to share the same width.'
                                    : next === 'circularPattern'
                                      ? 'Select geometry, then set instances, center and sweep. Drag the center or sweep handle; Enter or click empty space applies.'
                                      : next === 'linearPattern'
                                        ? 'Select geometry, then set instance counts, spacing and directions. Enter or click empty space applies; Escape cancels.'
                                        : next === 'transform'
                                          ? 'Select geometry, then drag the manipulator or enter translation, rotation and scale. Enter or click empty space applies; Escape cancels.'
                                          : next === 'split'
                                            ? 'Click a curve to split it. Closed curves require two distinct split points.'
                                            : next === 'trim'
                                              ? 'Click an interval to trim between intersections or placed points.'
                                              : next === 'chamfer'
                                                ? 'Select a shared corner or two adjacent lines, then enter both setback distances.'
                                                : next === 'fillet'
                                                  ? 'Select shared corner points or pairs of adjacent lines. Enter chooses the shared radius; Escape cancels.'
                                                  : next === 'conic'
                                                    ? 'Click the start, end, then control point. Enter rho to shape the conic.'
                                                    : next === 'spline' || next === 'bezier'
                                                      ? `Click ${next === 'spline' ? 'fit' : 'control'} points. Double-click the last point or press Enter to finish.`
                                                      : next === 'curveControlPoint'
                                                        ? 'Click an open spline or a segment of a Bezier control polygon to add a point while preserving its shape.'
                                                        : 'Select a line, circle, point pair or existing dimension.'
    );
    svg.current?.focus();
  };
  const navigateHistory = (redo = false) => {
    chooseTool('select');
    setSelected([]);
    publish(redo ? redoCadSession(session) : undoCadSession(session));
  };
  const fit = (entityIds?: readonly string[]) => {
    if (!sketch) return;
    const points = pointsOf(sketch);
    const included =
      entityIds &&
      new Set(
        entityIds.flatMap(id => {
          const entity = sketch.entities.find(e => e.id === id);
          return entity ? curvePointIds(entity) : [];
        })
      );
    const bounds = [...points.values()].filter(p => !included || included.has(p.id)).map(p => ({ x: p.x, y: p.y }));
    // A face sketch is framed by the face, not just what's drawn on it so far, and so is a part drawn on a face.
    if (faceSketch && !entityIds) bounds.push(...faceSketch.outline);
    const drawnOnFace = !faceSketch && !entityIds && part ? drawnOnOutline(documentRef.current, part) : null;
    if (drawnOnFace) bounds.push(...drawnOnFace);
    for (const e of sketch.entities)
      if ((!entityIds || entityIds.includes(e.id)) && (e.type === 'circle' || e.type === 'arc')) {
        const p = points.get(e.centerId);
        if (p) bounds.push({ x: p.x - e.radius, y: p.y - e.radius }, { x: p.x + e.radius, y: p.y + e.radius });
      }
    if (!bounds.length) return setView(initialView);
    const xmin = Math.min(...bounds.map(p => p.x)),
      xmax = Math.max(...bounds.map(p => p.x));
    const ymin = Math.min(...bounds.map(p => p.y)),
      ymax = Math.max(...bounds.map(p => p.y));
    const margin = 35;
    setView({ x: xmin - margin, y: -ymax - margin, w: Math.max(100, xmax - xmin + margin * 2), h: Math.max(80, ymax - ymin + margin * 2) });
  };
  useEffect(() => {
    if (faceSketch) fit();
    // Only on opening: afterwards the view is the user's.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const projectPoint = (point: Point) => {
    const matrix = svg.current?.getScreenCTM();
    if (!matrix) return { x: point.x, y: -point.y };
    const p = new DOMPoint(point.x, -point.y).matrixTransform(matrix);
    return { x: p.x, y: p.y };
  };
  const pointAt = (event: { clientX: number; clientY: number; shiftKey?: boolean }): Point => {
    const matrix = svg.current?.getScreenCTM();
    lastSnap.current = null;
    lastDrawingHint.current = null;
    inference.current = null;
    tangentAxis.current = null;
    if (!matrix) return cursor;
    const converted = new DOMPoint(event.clientX, event.clientY).matrixTransform(matrix.inverse());
    const raw = { x: converted.x, y: -converted.y };
    const drawing = [
      'line',
      'rectangle',
      'centerRectangle',
      'alignedRectangle',
      'circle',
      'threePointCircle',
      'ellipse',
      'arc',
      'tangentArc',
      'centerPointArc',
      'inscribedPolygon',
      'circumscribedPolygon',
      'point',
      'conic',
      'spline',
      'bezier',
    ].includes(tool);
    if (!snap || !sketch || (drawing && event.shiftKey)) return raw;
    const hit = pickSketchSnap(
      sketch,
      { x: event.clientX, y: event.clientY },
      { project: projectPoint, excludePointIds: drag.current?.points, selectedEntityIds: dimensionSelection }
    );
    lastSnap.current = hit;
    let point = hit?.point ?? raw;
    const lockedAxes: { x?: number; y?: number } = {};
    if (tool === 'line' && pending[0]) {
      const anchor = lineContinuation ? chainGeometry(sketch, chain) : null;
      const start = anchor?.point ?? pending[0];
      const scale = Math.hypot(matrix.a, matrix.b);
      const dx = point.x - start.x,
        dy = point.y - start.y;
      if (anchor?.curve.type === 'arc') {
        const length = Math.hypot(anchor.tangent.x, anchor.tangent.y);
        const unit = { x: anchor.tangent.x / length, y: anchor.tangent.y / length };
        const along = dx * unit.x + dy * unit.y;
        const perpendicular = Math.abs(dx * unit.y - dy * unit.x);
        if (along > 0 && perpendicular * scale <= 8 && Math.atan2(perpendicular, along) <= Math.PI / 30 && (!hit || perpendicular < 1e-7)) {
          point = { x: start.x + along * unit.x, y: start.y + along * unit.y };
          inference.current = 'tangent';
          tangentAxis.current = tangentLineAxis(anchor.tangent, start, raw, scale);
          if (tangentAxis.current === 'horizontal') {
            point.y = start.y;
            lockedAxes.y = start.y;
          } else if (tangentAxis.current === 'vertical') {
            point.x = start.x;
            lockedAxes.x = start.x;
          } else {
            lockedAxes.x = point.x;
            lockedAxes.y = point.y;
          }
        }
      }
      if (!inference.current && Math.hypot(dx, dy) * scale > 8) {
        if (Math.abs(dy) * scale <= 8 && (!hit || Math.abs(dy) < 1e-7)) {
          point = { x: point.x, y: start.y };
          inference.current = 'horizontal';
          lockedAxes.y = start.y;
        } else if (Math.abs(dx) * scale <= 8 && (!hit || Math.abs(dx) < 1e-7)) {
          point = { x: start.x, y: point.y };
          inference.current = 'vertical';
          lockedAxes.x = start.x;
        }
      }
    }
    if (drawing) {
      if (hit?.targetPointId)
        hoveredReferences.current = [hit.targetPointId, ...hoveredReferences.current.filter(id => id !== hit.targetPointId)].slice(0, 4);
      const startId =
        lineContinuation && chain
          ? chain.pointId
          : pending[0] && sketch.entities.find(e => e.type === 'point' && Math.hypot(e.x - pending[0]!.x, e.y - pending[0]!.y) < 1e-7)?.id;
      const result = inferDrawingPoint(sketch, raw, {
        project: projectPoint,
        directSnap: hit,
        lockedAxes,
        preferredPointIds: hoveredReferences.current,
        excludePointIds: [...(drag.current?.points ?? []), ...(tool === 'line' && startId && inference.current ? [startId] : [])],
      });
      point = { ...result.point };
      // Grid rounding is only a fallback; it must never manufacture a constraint inside a pixel tolerance.
      if (!hit) {
        if (lockedAxes.x === undefined && !result.alignments.some(a => a.type === 'verticalPoints')) point.x = Math.round(point.x);
        if (lockedAxes.y === undefined && !result.alignments.some(a => a.type === 'horizontalPoints')) point.y = Math.round(point.y);
      }
      lastDrawingHint.current = { ...result, point, guides: result.guides.map(g => ({ ...g, to: point })) };
    } else if (!hit) point = { x: Math.round(raw.x), y: Math.round(raw.y) };
    return point;
  };
  const addSnapRelations = (source: CadSketch, hints: (CadDrawingInference | null)[], curvePointIndex: number | readonly number[] = -1) => {
    let next = source;
    const createdCurve = source.entities.find(
      e => (e.type === 'circle' || e.type === 'arc') && !sketch?.entities.some(before => before.id === e.id)
    );
    const polygonEdge =
      tool === 'inscribedPolygon'
        ? source.entities.find(e => e.type === 'line' && !sketch?.entities.some(before => before.id === e.id))
        : undefined;
    const rectangleTop =
      tool === 'alignedRectangle'
        ? source.entities.filter(e => e.type === 'line' && !sketch?.entities.some(before => before.id === e.id))[2]
        : undefined;
    for (const [index, inference] of hints.entries()) {
      if (!inference || (!inference.snap && !inference.alignments.length)) continue;
      const hint = inference.snap;
      const candidates = next.entities.filter(
        (e): e is SketchPoint => e.type === 'point' && Math.hypot(e.x - inference.point.x, e.y - inference.point.y) < 1e-7
      );
      let point: SketchPoint | undefined = candidates.find(e => !sketch?.entities.some(before => before.id === e.id)) ?? candidates[0];
      if ((Array.isArray(curvePointIndex) ? curvePointIndex.includes(index) : index === curvePointIndex) && createdCurve) {
        // A circle's rim / arc's through click needs a concrete construction point to retain its inferred intent.
        if (!point) {
          next = addPoint(next, { ...inference.point, construction: true, standalone: false });
          point = next.entities.find(
            (e): e is SketchPoint => e.type === 'point' && Math.hypot(e.x - inference.point.x, e.y - inference.point.y) < 1e-7
          );
        }
        const pointId = point?.id;
        if (pointId && !next.constraints.some(c => c.type === 'pointOnCircle' && c.pointId === pointId && c.entityId === createdCurve.id))
          next = addConstraint(next, { type: 'pointOnCircle', pointId, entityId: createdCurve.id });
      }
      if (index === 1 && polygonEdge?.type === 'line') {
        if (!point) {
          next = addPoint(next, { ...inference.point, construction: true, standalone: false });
          point = next.entities.at(-1) as SketchPoint;
        }
        next = addConstraint(next, { type: 'midpoint', pointId: point.id, entityId: polygonEdge.id });
      }
      if (index === 2 && rectangleTop?.type === 'line') {
        if (!point) {
          next = addPoint(next, { ...inference.point, construction: true, standalone: false });
          point = next.entities.at(-1) as SketchPoint;
        }
        const equivalent = pointEquivalence(next.constraints);
        if (![rectangleTop.startId, rectangleTop.endId].some(id => equivalent.equivalent(id, point!.id)))
          next = addConstraint(next, { type: 'pointOnLine', pointId: point.id, entityId: rectangleTop.id });
      }
      if (point) for (const relation of inferredPointConstraints(inference, point.id, next)) next = addConstraint(next, relation);
      if (point && hint?.targetPointId && point.id !== hint.targetPointId) {
        if (
          !next.constraints.some(
            c =>
              c.type === 'coincident' &&
              [c.pointAId, c.pointBId].includes(point.id) &&
              [c.pointAId, c.pointBId].includes(hint.targetPointId!)
          )
        )
          next = addConstraint(next, { type: 'coincident', pointAId: point.id, pointBId: hint.targetPointId });
        continue;
      }
      if (!hint?.intent) continue;
      const curve = sketch?.entities.find(e => e.id === hint.intent!.entityId);
      if (!point || !curve) continue;
      const type =
        hint.intent.type === 'midpoint'
          ? 'midpoint'
          : curve.type === 'line'
            ? 'pointOnLine'
            : curve.type === 'circle' || curve.type === 'arc'
              ? 'pointOnCircle'
              : 'pointOnCurve';
      if (
        !next.constraints.some(
          c => c.type === type && 'pointId' in c && c.pointId === point.id && 'entityId' in c && c.entityId === curve.id
        )
      )
        next =
          type === 'pointOnCurve'
            ? addConstraint(next, { type, pointId: point.id, entityId: curve.id, parameter: hint.parameter ?? 0.5 })
            : addConstraint(next, { type, pointId: point.id, entityId: curve.id });
    }
    return next;
  };
  const addShape = (end?: Point) => {
    if (!sketch || !pending[0]) return;
    const anchor = lineContinuation ? chainGeometry(sketch, chain) : null;
    const start = anchor?.point ?? pending[0];
    let next = sketch;
    const sizeExpressions: Record<string, string | undefined> = {};
    let continued: ChainAnchor | null = null;
    let actualEnd = end;
    if (polygonTool && pending[1]) {
      try {
        next = (tool === 'inscribedPolygon' ? addInscribedPolygon : addCircumscribedPolygon)(sketch, {
          center: start,
          point: pending[1],
          sides: Number(polygonSides),
          construction,
        });
      } catch (error) {
        return setMessage(error instanceof Error ? error.message : String(error));
      }
    } else if (tool === 'rectangle' || tool === 'centerRectangle') {
      const centered = tool === 'centerRectangle';
      const widthValue = end ? null : parseCadValue(width, { unit: 'mm', variables: variableScope });
      const heightValue = end ? null : parseCadValue(height, { unit: 'mm', variables: variableScope });
      if (widthValue && 'error' in widthValue) return setMessage(`Rectangle width: ${widthValue.error}`);
      if (heightValue && 'error' in heightValue) return setMessage(`Rectangle height: ${heightValue.error}`);
      const w = end ? (end.x - start.x) * (centered ? 2 : 1) : widthValue!.value;
      const h = end ? (end.y - start.y) * (centered ? 2 : 1) : heightValue!.value;
      if (!end && (w <= 0 || h <= 0)) return setMessage('Rectangle width and height must be greater than zero.');
      if (!Number.isFinite(w) || !Number.isFinite(h) || Math.abs(w) < 0.1 || Math.abs(h) < 0.1)
        return setMessage('Width and height must be greater than zero.');
      next = (centered ? addCenterRectangle : addRectangle)(sketch, {
        x: centered ? start.x : Math.min(start.x, start.x + w),
        y: centered ? start.y : Math.min(start.y, start.y + h),
        width: Math.abs(w),
        height: Math.abs(h),
        construction,
        dimensioned: end === undefined,
      });
      if (!end) {
        sizeExpressions.Width = widthValue?.expression;
        sizeExpressions.Height = heightValue?.expression;
      }
    } else if (tool === 'alignedRectangle' && pending[1] && end) {
      try {
        next = addAlignedRectangle(sketch, { start, end: pending[1], through: end, construction });
      } catch (error) {
        return setMessage(error instanceof Error ? error.message : String(error));
      }
    } else if (tool === 'ellipse' && pending[1] && end) {
      try {
        next = addEllipse(sketch, { center: start, axis: pending[1], through: end, construction });
      } catch (error) {
        return setMessage(error instanceof Error ? error.message : String(error));
      }
    } else if (tool === 'threePointCircle' && pending[1] && end) {
      try {
        next = addThreePointCircle(sketch, { points: [start, pending[1], end], construction });
      } catch (error) {
        return setMessage(error instanceof Error ? error.message : String(error));
      }
    } else if (tool === 'circle') {
      const radiusValue = end ? null : parseCadValue(radius, { unit: 'mm', variables: variableScope });
      if (radiusValue && 'error' in radiusValue) return setMessage(`Circle radius: ${radiusValue.error}`);
      const r = end ? Math.hypot(end.x - start.x, end.y - start.y) : radiusValue!.value;
      if (!Number.isFinite(r) || r < 0.1) return setMessage('Radius must be greater than zero.');
      next = addCircle(sketch, { ...start, radius: r, construction, dimensioned: end === undefined });
      if (!end && radiusValue?.expression) sizeExpressions.Diameter = `2*(${radiusValue.expression})`;
    } else if (tool === 'line' && end) {
      if (Math.hypot(end.x - start.x, end.y - start.y) < 0.1) return;
      next = addLine(sketch, { x1: start.x, y1: start.y, x2: end.x, y2: end.y, construction });
      const line = next.entities.at(-1);
      if (line?.type === 'line') {
        continued = { pointId: line.endId, curveId: line.id };
        if (inference.current === 'horizontal' || inference.current === 'vertical')
          next = addConstraint(next, { type: inference.current, entityId: line.id });
        else if (inference.current === 'tangent' && anchor) {
          next = addConstraint(next, { type: 'tangent', entityAId: anchor.curve.id, entityBId: line.id });
          if (tangentAxis.current) next = addConstraint(next, { type: tangentAxis.current, entityId: line.id });
        }
      }
    } else if (tool === 'tangentArc' && anchor && end) {
      const arc = tangentArcFrom(anchor.point, anchor.tangent, end);
      if (!arc) return setMessage('Choose an arc endpoint away from its tangent line.');
      next = addArc(sketch, { ...arc, construction });
      const created = next.entities.at(-1);
      if (created?.type === 'arc') {
        next = addConstraint(next, { type: 'tangent', entityAId: anchor.curve.id, entityBId: created.id });
        const endId = pointEquivalence(next.constraints).equivalent(created.startId, anchor.point.id) ? created.endId : created.startId;
        continued = { pointId: endId, curveId: created.id };
      }
      setTool('line');
      setMessage('Click the next line endpoint, or Shift+A for another tangent arc.');
    } else if (tool === 'conic' && pending[1] && end) {
      try {
        const parsedRho = parseCadValue(rho, { unit: 'scalar' });
        if ('error' in parsedRho) return setMessage(`Conic rho: ${parsedRho.error}`);
        next = addConic(sketch, { start, end: pending[1], control: end, rho: parsedRho.value, construction });
      } catch (error) {
        return setMessage(error instanceof Error ? error.message : String(error));
      }
    } else if (tool === 'centerPointArc' && pending[1] && end) {
      try {
        next = addCenterPointArc(sketch, {
          center: start,
          start: pending[1],
          end,
          sweepIntent: centerArcSweep.current?.sweep,
          construction,
        });
      } catch (error) {
        return setMessage(error instanceof Error ? error.message : String(error));
      }
    } else if (tool === 'arc' && pending[1] && end) {
      const arc = threePointArc(start, pending[1], end);
      if (!arc || arc.radius < 0.1) return setMessage('Three points on the arc must not lie on one straight line.');
      next = addArc(sketch, { ...arc, construction });
      if (contextualArc) {
        const created = next.entities.at(-1);
        const gestureEnd = pending[1];
        if (created?.type === 'arc') {
          const point = next.entities.find(
            (e): e is SketchPoint =>
              e.type === 'point' &&
              [created.startId, created.endId].includes(e.id) &&
              Math.hypot(e.x - gestureEnd.x, e.y - gestureEnd.y) < 1e-7
          );
          if (point) continued = { pointId: point.id, curveId: created.id };
          actualEnd = gestureEnd;
        }
      }
    } else return;
    if (Object.values(sizeExpressions).some(Boolean))
      next = {
        ...next,
        constraints: next.constraints.map(c =>
          !sketch.constraints.some(before => before.id === c.id) && c.label && sizeExpressions[c.label]
            ? { ...c, expression: sizeExpressions[c.label] }
            : c
        ),
      };
    const hints = polygonTool
      ? pendingSnaps.current.slice(0, 2)
      : end
        ? [...pendingSnaps.current, lastDrawingHint.current]
        : pendingSnaps.current;
    if (tool === 'centerPointArc' && end && pending[1] && hints[2]) {
      const arc = centerPointArcFromPoints(start, pending[1], end, centerArcSweep.current?.sweep);
      if (arc) {
        const angle = Math.atan2(end.y - start.y, end.x - start.x);
        const projected = { x: arc.cx + arc.radius * Math.cos(angle), y: arc.cy + arc.radius * Math.sin(angle) };
        // A radial projection must not attach the endpoint to an off-circle snap target.
        hints[2] =
          Math.hypot(projected.x - hints[2].point.x, projected.y - hints[2].point.y) > CAD_GEOMETRY_TOLERANCE
            ? null
            : { ...hints[2], point: projected };
      }
    }
    next = addSnapRelations(
      next,
      hints,
      tool === 'threePointCircle' ? [0, 1, 2] : end && (tool === 'circle' || tool === 'arc') ? hints.length - 1 : -1
    );
    changeSketch(next);
    drawingGesture.current = idleDrawingGesture();
    if (tool === 'conic') {
      const curve = next.entities.find(entity => entity.type === 'conic' && !sketch.entities.some(before => before.id === entity.id));
      if (curve?.type === 'conic') {
        newCurveCommand.current = { id: curve.id, checkpoint: cadCommandCheckpoint(session) };
        setConicEditing(curve.id);
        setRho(String(curve.rho));
      }
    }
    if (polygonTool) setMessage('Click the center, set the construction circle, then choose 3–50 sides and click or press Enter.');
    if (tool === 'threePointCircle') setMessage('Click three points along the circle circumference.');
    if (tool === 'centerPointArc') setMessage('Click the arc center, start, then end. Move around the center to choose its sweep.');
    if (tool === 'alignedRectangle') setMessage('Click the first edge start and end, then the perpendicular extent.');
    setDrawingCue(null);
    setSnapCue(null);
    setChain(continued);
    setPending(continued && actualEnd ? [actualEnd] : []);
    setLineContinuation(!!continued);
    pendingSnaps.current = [];
    const added = next.entities.filter(e => !sketch.entities.some(before => before.id === e.id) && e.type !== 'point');
    setCreationValues(
      end && part
        ? beginCreationValues(
            tool,
            part.id,
            next,
            added.map(entity => entity.id),
            end
          )
        : null
    );
    setSelected(
      added
        .filter(
          e =>
            tool !== 'centerRectangle' ||
            next.constraints.some(
              c => ['horizontal', 'vertical', 'parallel', 'perpendicular'].includes(c.type) && constraintEntityIds(c).includes(e.id)
            )
        )
        .map(e => e.id)
    );
    // Passive measured values leave shortcuts live; numeric typing turns them into drivers.
    setDimension(null);
    svg.current?.focus();
  };
  const currentDimension = dimensionDraft?.id === dimension ? dimensionDraft : sketch?.constraints.find(c => c.id === dimension);
  const rejectValue = (reason: string, input?: HTMLInputElement | null) => {
    setMessage(reason);
    input?.focus();
    return reason;
  };
  const applyDimensionValue = (): string | null => {
    if (!currentDimension || !numeric(currentDimension)) return null;
    const input = dimensionInput.current;
    if (!input?.value.trim()) return rejectValue('Enter a dimension value.', input);
    const parsed = parseCadValue(input.value, { unit: currentDimension.type === 'angle' ? 'deg' : 'mm', variables: variableScope });
    if ('error' in parsed) return rejectValue(parsed.error, input);
    const valueError = dimensionValueError(currentDimension, parsed.value);
    if (valueError) return rejectValue(valueError, input);
    const next = updateDimension(documentRef.current, currentDimension.id, parsed.value, parsed.expression);
    const command = newDimensionCommand.current;
    const amended = command?.id === currentDimension.id ? amendCadSession(session, next, command.checkpoint) : null;
    if (amended) publish(amended);
    else commit(next);
    newDimensionCommand.current = null;
    setDimension(null);
    setMessage('Dimension applied. Select geometry or choose a tool.');
    svg.current?.focus();
    return null;
  };
  const applyCreationValue = ({ advance = true } = {}): string | null => {
    if (!creationValues || !part || !sketch || creationValues.partId !== part.id) return null;
    const current = creationValueAt(creationValues, sketch);
    if (!current) return rejectValue('This drawing value no longer applies. Select its geometry again.', creationInput.current);
    const parsed = parseCadValue(
      creationValues.editing ? (creationInput.current?.value ?? creationValues.text) : String(current.constraint.value),
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
  const finishSpline = (keepTool = false) => {
    if (!sketch || (tool !== 'spline' && tool !== 'bezier') || pending.length < 2) return;
    try {
      let next = (tool === 'spline' ? addSpline : addBezier)(sketch, { points: pending, construction });
      next = addSnapRelations(next, pendingSnaps.current);
      const curve = next.entities.find(entity => entity.type === tool && !sketch.entities.some(before => before.id === entity.id));
      changeSketch(next);
      chooseTool('select');
      if (keepTool) setTool(tool);
      setSelected(curve ? [curve.id] : []);
      setMessage(`${tool === 'spline' ? 'Spline' : 'Bezier'} created. Drag its visible points to edit the curve.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    }
  };
  const editPattern = (id: string) => {
    const pattern = sketch?.constraints.find(c => c.id === id);
    if (pattern?.type !== 'linearPattern' && pattern?.type !== 'circularPattern') return;
    chooseTool(pattern.type);
    setPatternEditId(id);
    patternCommandId.current = id;
    if (pattern.type === 'linearPattern') setLinearParameters(linearPatternParameters(pattern));
    else setCircularParameters(circularPatternParameters(pattern, sketch!));
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
  const acceptCircularPattern = () => {
    if (!sketch || !parsedCircular.ok) return setMessage(parsedCircular.ok ? 'Select source geometry.' : parsedCircular.message);
    const old = patternEditId && sketch.constraints.find(c => c.id === patternEditId),
      center = old && old.type === 'circularPattern' ? sketch.entities.find(e => e.id === old.centerId) : undefined;
    if (
      old &&
      old.type === 'circularPattern' &&
      old.countX === parsedCircular.count &&
      old.angle === parsedCircular.angle &&
      old.closed === parsedCircular.closed &&
      center?.type === 'point' &&
      Math.hypot(center.x - parsedCircular.center.x, center.y - parsedCircular.center.y) < CAD_GEOMETRY_TOLERANCE
    ) {
      chooseTool('select');
      setSelected([]);
      setSelectedConstraints([old.id]);
      return;
    }
    const result = circularPatternSketchEntities(sketch, {
      ...parsedCircular,
      entityIds: selected,
      patternId: patternEditId ?? patternCommandId.current,
    });
    if (!result.ok) return setMessage(result.message);
    changeSketch(result.sketch);
    chooseTool('select');
    setSelected([]);
    setSelectedConstraints([result.patternId]);
    if (result.releasedConstraintIds.length)
      setPatternNotice(`${result.releasedConstraintIds.length} relations on removed instances were released.`);
    setMessage('Circular pattern applied. Double-click its pattern icon or use Edit pattern to change it.');
  };
  const acceptLinearPattern = () => {
    if (tool === 'circularPattern') return acceptCircularPattern();
    if (!sketch || !parsedLinear.ok) return setMessage(parsedLinear.ok ? 'Select source geometry.' : parsedLinear.message);
    const existing = patternEditId && sketch.constraints.find(c => c.id === patternEditId);
    const same =
      existing &&
      existing.type === 'linearPattern' &&
      existing.countX === parsedLinear.countX &&
      existing.countY === parsedLinear.countY &&
      Math.hypot(existing.stepX.x - parsedLinear.stepX.x, existing.stepX.y - parsedLinear.stepX.y) < CAD_GEOMETRY_TOLERANCE &&
      Math.hypot(existing.stepY.x - parsedLinear.stepY.x, existing.stepY.y - parsedLinear.stepY.y) < CAD_GEOMETRY_TOLERANCE &&
      JSON.stringify(existing.expressions ?? null) === JSON.stringify(parsedLinear.expressions ?? null);
    if (same) {
      const id = existing.id;
      chooseTool('select');
      setSelected([]);
      setSelectedConstraints([id]);
      return;
    }
    const result = linearPatternSketchEntities(sketch, {
      ...parsedLinear,
      entityIds: selected,
      patternId: patternEditId ?? patternCommandId.current,
    });
    if (!result.ok) return setMessage(result.message);
    changeSketch(result.sketch);
    chooseTool('select');
    setSelected([]);
    setSelectedConstraints([result.patternId]);
    if (result.releasedConstraintIds.length)
      setPatternNotice(`${result.releasedConstraintIds.length} relations on removed instances were released.`);
    setMessage('Linear pattern applied. Double-click its pattern icon or use Edit pattern to change it.');
  };
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
  const acceptChamfer = () => {
    if (!chamferPreview?.ok)
      return setMessage(
        chamferPreview?.message ?? (chamferSelection && !chamferSelection.ok ? chamferSelection.message : 'Select corners to chamfer.')
      );
    const next = structuredClone(chamferPreview.sketch);
    chamferPreview.dimensionIds.forEach((id, index) => {
      const value = parseCadValue(chamferDistances[index]!, { unit: 'mm', variables: variableScope });
      const dimension = next.constraints.find(c => c.id === id);
      if (dimension && 'value' in dimension && 'value' in value && value.expression) dimension.expression = value.expression;
    });
    changeSketch(next);
    chooseTool('select');
    setSelected([]);
    setSelectedConstraints(chamferPreview.dimensionIds);
    setMessage('Chamfers created. Double-click either setback dimension to edit the group.');
  };
  const acceptFillet = () => {
    if (!filletPreview?.ok) {
      setMessage(
        filletPreview && !filletPreview.ok
          ? filletPreview.message
          : filletSelection && !filletSelection.ok
            ? filletSelection.message
            : 'Select corners to fillet.'
      );
      return;
    }
    const radiusId = filletPreview.radiusConstraintId;
    const parsed = parseCadValue(filletRadius, { unit: 'mm', variables: variableScope });
    const next =
      'value' in parsed && parsed.expression
        ? {
            ...filletPreview.sketch,
            constraints: filletPreview.sketch.constraints.map(c => (c.id === radiusId ? { ...c, expression: parsed.expression } : c)),
          }
        : filletPreview.sketch;
    changeSketch(next);
    chooseTool('select');
    setSelected([]);
    setSelectedConstraints([radiusId]);
    setMessage('Fillets created. Double-click the shared radius to edit the group.');
  };
  const acceptOffset = (): string | null => {
    if (modification.phase !== 'offset' || !modification.entityIds.length) return null;
    if (!offsetPreview?.ok) return rejectValue(offsetPreview?.message ?? 'Select curves to offset.', offsetInput.current);
    const parsed = parseCadValue(modification.text, { unit: 'mm', variables: variableScope });
    const next =
      'value' in parsed && parsed.expression
        ? {
            ...offsetPreview.sketch,
            constraints: offsetPreview.sketch.constraints.map(c =>
              c.id === offsetPreview.dimensionId ? { ...c, expression: parsed.expression } : c
            ),
          }
        : offsetPreview.sketch;
    changeSketch(next);
    setModification(previous => transitionModification(previous, { type: 'complete' }));
    setSelected([]);
    setMessage('Offset created. Double-click its dimension to edit; select more curves to offset again.');
    svg.current?.focus();
    return null;
  };
  const applyConicRho = (): string | null => {
    if (!sketch || !part || !conicEditing) return null;
    try {
      const parsed = parseCadValue(rhoInput.current?.value ?? rho, { unit: 'scalar' });
      if ('error' in parsed) return rejectValue(`Conic rho: ${parsed.error}`, rhoInput.current);
      const next = replacePart(documentRef.current, part.id, current => ({
        ...current,
        sketch: setConicRho(current.sketch, conicEditing, parsed.value),
      }));
      const command = newCurveCommand.current;
      const amended = command?.id === conicEditing ? amendCadSession(session, next, command.checkpoint) : null;
      if (amended) publish(amended);
      else commit(next);
      const curveId = conicEditing;
      chooseTool('select');
      setSelected([curveId]);
      setMessage('Conic applied. Drag its control point to reshape it.');
      return null;
    } catch (error) {
      return rejectValue(error instanceof Error ? error.message : String(error), rhoInput.current);
    }
  };
  const removeSelected = (entityIds: readonly string[] = selected, constraintIds: readonly string[] = selectedConstraints) => {
    if (
      (tool === 'slot' ||
        tool === 'fillet' ||
        tool === 'chamfer' ||
        tool === 'transform' ||
        tool === 'linearPattern' ||
        tool === 'circularPattern') &&
      selected.length
    ) {
      chooseTool('select');
      setSelected([]);
      return;
    }
    if (dimensionFlow.phase !== 'idle') {
      cancelDimensionEdit();
      return;
    }
    if (!sketch) return;
    if (!constraintIds.length && entityIds.length && entityIds.every(id => isSplineTangentHandle(sketch, id))) {
      setMessage('Spline tangent handles cannot be deleted individually. Select the curve to delete it.');
      return;
    }
    if (!constraintIds.length && entityIds.length && entityIds.every(id => sketch.entities.some(e => e.id === id && e.faceEdge))) {
      setMessage('The edges of the face this part is drawn on stay. Draw onto them so the part follows that face.');
      return;
    }
    let next = sketch;
    if (constraintIds.length) {
      constraintIds.forEach(id => {
        next = removeInlineConstraint(next, id);
      });
      setSelectedConstraints([]);
      setDimension(null);
    }
    // Protection belongs to the command's original graph, even if deleting its
    // parent first leaves a handle point in use by an unselected curve.
    entityIds
      .filter(id => !isSplineTangentHandle(sketch, id))
      .forEach(id => {
        next = removeEntity(next, id);
      });
    const remainingIds = new Set(next.entities.map(entity => entity.id));
    const missing = (id: string | undefined) => !!id && !remainingIds.has(id);
    const lostChain = chain && (missing(chain.curveId) || missing(chain.pointId));
    const lostPendingReference = pendingSnaps.current.some(
      hint =>
        hint &&
        (missing(hint.snap?.targetPointId) ||
          missing(hint.snap?.entityId) ||
          missing(hint.snap?.intent?.entityId) ||
          hint.alignments.some(alignment => missing(alignment.sourcePointId)))
    );
    if (lostChain || lostPendingReference) chooseTool('select');
    if (sketch.entities.some(entity => !remainingIds.has(entity.id))) {
      setHoveredPoint(null);
      setSnapCue(null);
      setDrawingCue(null);
      hoveredReferences.current = [];
      lastSnap.current = null;
      lastDrawingHint.current = null;
      inference.current = null;
      tangentAxis.current = null;
    }
    const notice = entityIds.length ? (patternDeletionNotice(sketch, next) ?? slotDeletionNotice(sketch, next)) : null;
    changeSketch(next);
    if (notice) {
      setMessage(notice);
      setPatternNotice(notice);
    }
    setSelected([]);
    setHoveredConstraintEntities([]);
    svg.current?.focus();
  };
  const openContext = (target: SketchContextTarget, position: Point) => {
    if (!sketch || busy || drag.current || annotationDrag.current) return;
    const context = createSketchContext(sketch, target, position, { entityIds: dimensionSelection, constraintIds: selectedConstraints });
    chooseTool('select');
    setSelected([...context.entityIds]);
    setSelectedConstraints([...context.constraintIds]);
    setContextMenu(context);
  };
  const contextTarget = (target: Element, position: Point) =>
    sketch
      ? target.closest('[data-constraint-id]')
        ? sketch.constraints.some(
            c =>
              (c.type === 'linearPattern' || c.type === 'circularPattern' || c.type === 'slot') &&
              c.id === target.closest('[data-constraint-id]')?.getAttribute('data-constraint-id')
          )
          ? { kind: 'constraint' as const, id: target.closest('[data-constraint-id]')!.getAttribute('data-constraint-id')! }
          : ({ kind: 'blank' } as const)
        : pickSketchContextTarget(sketch, position, {
            project: projectPoint,
            selectedEntityIds: dimensionSelection,
            targetDimensionId: target.closest('[data-dimension]')?.getAttribute('data-dimension') ?? undefined,
            targetEntityId: target.closest('[data-entity-id]')?.getAttribute('data-entity-id') ?? undefined,
          })
      : ({ kind: 'blank' } as const);
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
  const contextAction = (action: SketchContextAction, context: SketchContext) => {
    if (!sketch) return;
    if (action === 'fit') fit();
    else if (action === 'edit-pattern') {
      const id =
        context.target.kind === 'constraint'
          ? context.target.id
          : context.entityIds.map(id => sketchPatternOwner(sketch, id)?.id).find(Boolean);
      if (id) editPattern(id);
    } else if (action === 'fit-selection') fit(context.entityIds);
    else if (action === 'clear') {
      setSelected([]);
      setSelectedConstraints([]);
      setHoveredConstraintEntities([]);
    } else if (action === 'construction') changeSketch(toggleContextConstruction(sketch, context.entityIds));
    else if (action === 'delete-entities' || action === 'delete-dimensions') removeSelected(context.entityIds, context.constraintIds);
    else if (context.target.kind === 'dimension') {
      const id = context.target.id,
        constraint = sketch.constraints.find(c => c.id === id);
      if (action === 'edit-dimension') editDimension(id);
      else if (constraint && numeric(constraint)) {
        commit(setDimensionDriven(documentRef.current, id, !constraint.driven));
        setDimension(null);
        setMessage(constraint.driven ? 'Dimension is driving the geometry.' : 'Reference dimension follows the geometry.');
      }
    }
  };
  const placeDimension = async (placed: CadDimension) => {
    if (!part || busy || preparingDimension.current) return;
    const source = documentRef.current;
    const snapshot = JSON.stringify(source);
    preparingDimension.current = true;
    setBusy(true);
    try {
      const result = await prepareDimensionCreation(part, placed);
      if (!mounted.current) return;
      if (JSON.stringify(documentRef.current) !== snapshot) {
        setMessage('The sketch changed while the dimension was checked. Select geometry again.');
        return;
      }
      if (!result.ok) {
        setMessage(result.message);
        return;
      }
      commit(replacePart(source, part.id, () => result.part));
      setSelectedConstraints([placed.id]);
      if (result.driven) {
        setDimension(null);
        setMessage('Reference dimension created. Existing constraints already determine this measurement.');
        svg.current?.focus();
      } else {
        newDimensionCommand.current = { id: placed.id, checkpoint: cadCommandCheckpoint(session) };
        setDimension(placed.id);
        setMessage('Enter a dimension. Enter applies it; Escape cancels.');
      }
    } catch (error) {
      if (mounted.current) setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      preparingDimension.current = false;
      if (mounted.current) setBusy(false);
    }
  };
  const applyDimensionEvent = (event: DimensionWorkflowEvent) => {
    if (!sketch) return;
    const transition = transitionDimensionWorkflow(sketch, dimensionFlow, event);
    setDimensionFlow(transition.state);
    if (transition.message) setMessage(transition.message);
    if (transition.effect?.type === 'edit-existing') {
      editDimension(transition.effect.constraintId);
      return;
    }
    if (transition.effect?.type === 'create') {
      const placed = transition.effect.constraint;
      if (!constraintEntityIds(placed).every(id => sketch.entities.some(entity => entity.id === id))) {
        cancelDimensionEdit();
        setMessage('The dimension geometry changed. Select geometry again to create a dimension.');
        return;
      }
      void placeDimension(placed);
    }
  };
  const beginDimension = () => {
    chooseTool('dimension');
    if (tool === 'dimension' || !sketch) return;
    const transition = transitionDimensionWorkflow(sketch, idleDimensionWorkflow(dimensionMode), {
      type: 'begin',
      entityIds: selected,
      previewId: newCadId(),
      pickHints: selectionHints.current,
    });
    setDimensionFlow(transition.state);
    setSelected([]);
    if (transition.message) setMessage(transition.message);
    svg.current?.focus();
  };
  const constrain = (type: ConstraintTool) => {
    if (!sketch) return;
    const references = [...dimensionSelection];
    // Constraint commands replace drawing/dimension placement just like the other sketch tools.
    chooseTool('select');
    setSelected(references);
    if (constraintMode === type) {
      setConstraintMode(null);
      setSelected([]);
      setMessage('Click geometry to select. Drag to move. Shift-click adds to selection.');
      svg.current?.focus();
      return;
    }
    const result = buildConstraintForSelection(sketch, type, references);
    if (result.constraint || result.constraints?.length) {
      changeSketch((result.constraints ?? [result.constraint!]).reduce((next, c) => addConstraint(next, c), sketch));
      setConstraintMode(null);
      setMessage(result.message);
    } else if (result.alreadyApplied) {
      setConstraintMode(null);
      setMessage(result.message);
    } else {
      setConstraintMode(type);
      setMessage(result.message);
      if (!result.needsMore) setSelected([]);
    }
  };
  const toggleFix = () => {
    if (!sketch) return;
    const ids = new Set(
      selected.flatMap(id => {
        const entity = sketch.entities.find(e => e.id === id);
        return entity ? entityPointIds(entity) : [];
      })
    );
    ids.delete(originId(sketch));
    for (const e of sketch.entities) if (e.faceEdge) ids.delete(e.id);
    if (!ids.size) return setMessage('Select geometry to fix. The origin and the edges of the face it’s drawn on always stay fixed.');
    const shouldFix = sketch.entities.some(e => e.type === 'point' && ids.has(e.id) && !e.fixed);
    changeSketch({ ...sketch, entities: sketch.entities.map(e => (e.type === 'point' && ids.has(e.id) ? { ...e, fixed: shouldFix } : e)) });
    setMessage(shouldFix ? 'Selected geometry fixed. Shift+J unfixes it.' : 'Selected geometry unfixed.');
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
        setSearchMode(true);
        setPalette(value => !value);
      }
      return;
    }
    if (editable(event.target)) return;
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
      if (tool === 'transform' && !selected.length) setTransformParameters(initialTransformParameters(transformSelectionCenter(ids)));
      setSelected(ids);
      return;
    }
    if (event.ctrlKey || event.metaKey || event.altKey || event.repeat) return;
    // `n` looks straight at the sketch's plane, and again, at its other side, as in the reference.
    if (key === 'n' && sketchBackdrop) {
      event.preventDefault();
      setSketchTurn(normalTurn);
      return;
    }
    if (key === 'u' && pickedEdges.length) {
      event.preventDefault();
      takeEdges();
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
      const command = tools.find(t => t.key?.toLowerCase() === key)?.id;
      if (command) {
        event.preventDefault();
        chooseTool(command);
      }
    }
  };
  const pointerDown = (event: PointerEvent<SVGSVGElement>) => {
    if (busy) return;
    svg.current?.focus();
    if (event.button === 1 || event.button === 2) {
      event.preventDefault();
      if (event.button === 2)
        contextPress.current = transitionSketchContextPress(contextPress.current, {
          type: 'press',
          pointerId: event.pointerId,
          position: { x: event.clientX, y: event.clientY },
          target: contextTarget(event.target as Element, { x: event.clientX, y: event.clientY }),
        }).state;
      pan.current = { x: event.clientX, y: event.clientY, view, turn: event.button === 2 && sketchBackdrop ? sketchTurn : undefined };
      event.currentTarget.setPointerCapture(event.pointerId);
      return;
    }
    if (event.button !== 0 || !sketch) return;
    // Seen edge-on, a click can't say where on the plane it is.
    if (sketchBackdrop && edgeOn(sketchTurn)) return;
    // A part's edge behind the sketch is picked to use in it, as the reference's Use takes it.
    const edgeKey = (event.target as Element).closest('[data-part-edge]')?.getAttribute('data-part-edge');
    if (edgeKey && tool === 'select') {
      setPickedEdges(picked =>
        picked.includes(edgeKey) ? picked.filter(key => key !== edgeKey) : event.shiftKey ? [...picked, edgeKey] : [edgeKey]
      );
      return;
    }
    if (pickedEdges.length) setPickedEdges([]);
    setCreationValues(null);
    setRegionField(null);
    if (conicEditing) {
      setConicEditing(null);
      newCurveCommand.current = null;
    }
    const p = pointAt(event);
    const target = event.target as Element;
    if (target.closest('[data-dimension]')) return;
    if (target.closest('[data-constraint-id]')) return;
    if (!event.shiftKey) setSelectedConstraints([]);
    const directEntityId = target.closest('[data-entity-id]')?.getAttribute('data-entity-id') ?? undefined;
    const pointHit = pickSketchPoint(
      sketch,
      { x: event.clientX, y: event.clientY },
      { project: projectPoint, selectedEntityIds: dimensionSelection, preferredPointId: directEntityId }
    );
    const curveHit = pointHit
      ? null
      : pickSketchSnap(
          sketch,
          { x: event.clientX, y: event.clientY },
          { project: projectPoint, includeMidpoints: false, selectedEntityIds: dimensionSelection, preferredCurveId: directEntityId }
        );
    const id = pointHit?.targetPointId ?? curveHit?.entityId;
    if (modification.phase !== 'idle') {
      // The command may remove the clicked endpoint. Keep the browser's later mousedown
      // from assigning focus to that disappearing target instead of the sketch canvas.
      event.preventDefault();
      const hit = pickSketchSnap(
        sketch,
        { x: event.clientX, y: event.clientY },
        { project: projectPoint, pointRadiusPx: -1, includeMidpoints: false }
      );
      const curveId = hit?.entityId;
      if (modification.phase === 'offset') {
        if (!modification.entityIds.length || event.shiftKey) {
          if (!curveId) return setMessage('Select a line, circle or arc to offset.');
          const next = modification.entityIds.includes(curveId)
            ? modification.entityIds.filter(id => id !== curveId)
            : modificationSourceIds(sketch, [...modification.entityIds, curveId], 'offset');
          setModification(previous => transitionModification(previous, { type: 'sources', entityIds: next }));
          setSelected(next);
        } else {
          event.preventDefault();
          acceptOffset();
        }
      } else if (modification.phase === 'mirror') {
        if (modification.picking === 'entities' || event.shiftKey) {
          const pickedId = curveId ?? pointHit?.targetPointId;
          if (!pickedId) return;
          const next = modification.entityIds.includes(pickedId)
            ? modification.entityIds.filter(id => id !== pickedId)
            : modificationSourceIds(sketch, [...modification.entityIds, pickedId], 'mirror');
          setModification(previous => transitionModification(previous, { type: 'sources', entityIds: next }));
          setSelected(next);
          setMessage('Add entities, then press Enter or choose Mirror line.');
        } else if (curveId) {
          const result = mirrorSketchEntities(sketch, { entityIds: modification.entityIds, axisId: curveId });
          if (!result.ok) return setMessage(result.message);
          changeSketch(result.sketch);
          setModification(previous => transitionModification(previous, { type: 'complete' }));
          setSelected([]);
          setHoveredModifyCurve(null);
          setMessage('Mirrored geometry created. Select entities to mirror again.');
        }
      } else if (!modification.entityId) {
        const curve = sketch.entities.find(entity => entity.id === curveId);
        if (!curve || (curve.type !== 'line' && curve.type !== 'arc')) return setMessage('Select near an endpoint of a line or arc.');
        const points = pointsOf(sketch),
          start = points.get(curve.startId)!,
          end = points.get(curve.endId)!;
        const endName = Math.hypot(p.x - start.x, p.y - start.y) <= Math.hypot(p.x - end.x, p.y - end.y) ? 'start' : 'end';
        setModification(previous => transitionModification(previous, { type: 'extendPick', entityId: curve.id, end: endName }));
        setSelected([curve.id]);
        setModifyTarget(null);
        setMessage('Click the new endpoint or a boundary. Escape cancels this extension.');
      } else {
        const result = extendSketchCurve(sketch, {
          entityId: modification.entityId,
          end: modification.end!,
          target: p,
          boundaryId: curveId !== modification.entityId ? curveId : undefined,
        });
        if (!result.ok) return setMessage(result.message);
        changeSketch(result.sketch);
        setModification(previous => transitionModification(previous, { type: 'complete' }));
        setSelected([]);
        setModifyTarget(null);
        setMessage(
          result.kind === 'delete'
            ? 'Curve removed by crossing its opposite endpoint. Undo restores it.'
            : 'Curve extended. Select another endpoint.'
        );
      }
      return;
    }
    if (tool === 'fillet' || tool === 'chamfer') {
      if (id) {
        setSelected(previous => (previous.includes(id) ? previous.filter(existing => existing !== id) : [...previous, id]));
        setFilletEditing(false);
      }
      return;
    }
    if (tool === 'curveControlPoint') {
      const polygon = pickBezierControlPolygon(sketch, { x: event.clientX, y: event.clientY }, { project: projectPoint, curveRadiusPx: 8 });
      if (polygon?.kind === 'vertex') return setMessage('Choose a segment of the Bezier control polygon, away from its vertices.');
      const hit =
        polygon ??
        pickSketchSnap(
          sketch,
          { x: event.clientX, y: event.clientY },
          { project: projectPoint, pointRadiusPx: -1, curveRadiusPx: 8, includeMidpoints: false }
        );
      const curve = sketch.entities.find(entity => entity.id === hit?.entityId);
      if (!curve || (curve.type !== 'spline' && curve.type !== 'bezier'))
        return setMessage('Choose an open spline or a Bezier control-polygon segment.');
      try {
        changeSketch(insertCurveControlPoint(sketch, curve.id, hit?.parameter ?? 0.5));
        chooseTool('select');
        setSelected([curve.id]);
        setMessage('Control point added. Drag its handle to reshape the curve.');
      } catch (error) {
        setMessage(error instanceof Error ? error.message : String(error));
      }
      return;
    }
    if (tool === 'tangentArc' && !pending.length) {
      const point = pointHit?.targetPointId && sketch.entities.find(entity => entity.id === pointHit.targetPointId);
      if (!point || point.type !== 'point') return setMessage('Choose an existing endpoint of a line or arc.');
      const equivalent = pointEquivalence(sketch.constraints);
      const candidates = sketch.entities.filter(
        entity =>
          (entity.type === 'line' || entity.type === 'arc') &&
          [entity.startId, entity.endId].some(id => equivalent.equivalent(id, point.id))
      );
      const curve = candidates.find(candidate => selected.includes(candidate.id)) ?? (candidates.length === 1 ? candidates[0] : undefined);
      if (!curve) return setMessage('Choose an unambiguous line or arc endpoint, or preselect its curve.');
      if (curve.type !== 'line' && curve.type !== 'arc') return;
      const pointId = equivalent.equivalent(curve.startId, point.id) ? curve.startId : curve.endId;
      setChain({ pointId, curveId: curve.id });
      setPending([{ x: point.x, y: point.y }]);
      pendingSnaps.current = [];
      setLineContinuation(true);
      setMessage('Click the tangent arc end.');
      return;
    }
    if (constraintMode) {
      if (!id) return;
      const next = selected.includes(id) ? selected : [...selected, id];
      const axisIds =
        constraintMode === 'symmetric' && sketch.entities.some(e => e.id === next[0] && e.type === 'line') ? next.slice(0, 1) : [];
      const result = buildConstraintForSelection(sketch, constraintMode, next);
      if (result.constraint || result.constraints?.length) {
        changeSketch((result.constraints ?? [result.constraint!]).reduce((next, c) => addConstraint(next, c), sketch));
        setSelected(constraintMode === 'symmetric' ? axisIds : []);
        setMessage(
          `${result.message} ${constraintMode === 'symmetric' ? 'Select the next pair relative to this symmetry line.' : constraintPrompt(constraintMode)}`
        );
      } else if (result.alreadyApplied) {
        setSelected(constraintMode === 'symmetric' ? axisIds : []);
        setMessage(result.message);
      } else {
        setSelected(result.needsMore ? next : constraintMode === 'symmetric' ? axisIds : [id]);
        setMessage(result.message);
      }
      return;
    }
    if (tool === 'point') {
      let next = addPoint(sketch, { ...p, construction });
      next = addSnapRelations(next, [lastDrawingHint.current]);
      changeSketch(next);
      const added = next.entities.find(e => e.type === 'point' && !sketch.entities.some(before => before.id === e.id));
      setSelected(added ? [added.id] : pointHit?.targetPointId ? [pointHit.targetPointId] : []);
      svg.current?.focus();
      return;
    }
    if (tool === 'slot') {
      const hit = pickSketchSnap(
        sketch,
        { x: event.clientX, y: event.clientY },
        { project: projectPoint, pointRadiusPx: -1, curveRadiusPx: 8, includeMidpoints: false }
      );
      const sourceId =
        directEntityId && sketch.entities.some(e => e.id === directEntityId && e.type !== 'point') ? directEntityId : hit?.entityId;
      if (sourceId)
        setSelected(previous => (previous.includes(sourceId) ? previous.filter(id => id !== sourceId) : [...previous, sourceId]));
      else if (selected.length) acceptSlot();
      return;
    }
    if (tool === 'linearPattern' || tool === 'circularPattern') {
      const hit = pickSketchSnap(
        sketch,
        { x: event.clientX, y: event.clientY },
        { project: projectPoint, pointRadiusPx: -1, curveRadiusPx: 8, includeMidpoints: false }
      );
      const sourceId =
        directEntityId && sketch.entities.some(e => e.id === directEntityId) ? directEntityId : (hit?.entityId ?? pointHit?.targetPointId);
      if (sourceId) {
        if (!patternEditId)
          setSelected(previous => (previous.includes(sourceId) ? previous.filter(id => id !== sourceId) : [...previous, sourceId]));
      } else if (selected.length) acceptLinearPattern();
      return;
    }
    if (tool === 'transform') {
      const hit = pickSketchSnap(
        sketch,
        { x: event.clientX, y: event.clientY },
        { project: projectPoint, pointRadiusPx: -1, curveRadiusPx: 8, includeMidpoints: false }
      );
      const selectedId =
        directEntityId && sketch.entities.some(e => e.id === directEntityId) ? directEntityId : (hit?.entityId ?? pointHit?.targetPointId);
      if (selectedId) {
        const next = selected.includes(selectedId) ? selected.filter(id => id !== selectedId) : [...selected, selectedId];
        if (!selected.length) setTransformParameters(initialTransformParameters(transformSelectionCenter(next)));
        setSelected(next);
      } else if (selected.length) acceptTransform();
      return;
    }
    if (tool === 'split') {
      const hit = pickSketchSnap(
        sketch,
        { x: event.clientX, y: event.clientY },
        { project: projectPoint, pointRadiusPx: -1, curveRadiusPx: 8, includeMidpoints: false }
      );
      const curve = sketch.entities.find(e => e.id === hit?.entityId);
      if (!curve || curve.type === 'point' || isOwnedSplineHandle(curve) || hit?.parameter === undefined)
        return setMessage('Select a sketch curve, away from its endpoints or tangent handles.');
      const tau = Math.PI * 2;
      const wrap = (angle: number) => ((angle % tau) + tau) % tau;
      const parameter =
        curve.type === 'circle'
          ? wrap(hit.parameter) / tau
          : curve.type === 'arc'
            ? wrap(hit.parameter - curve.startAngle) / (wrap(curve.endAngle - curve.startAngle) || tau)
            : hit.parameter;
      if (isClosedSketchCurve(curve) && splitFirst?.entityId !== curve.id) {
        const points = new Map(sketch.entities.filter(e => e.type === 'point').map(e => [e.id, e]));
        setSplitFirst({ entityId: curve.id, parameter, point: evaluateCurvePoint(curve, points, parameter) });
        setMessage('Choose a second distinct point on the same closed curve. Escape cancels both split points.');
        return;
      }
      const result = splitSketchCurve(sketch, curve.id, isClosedSketchCurve(curve) ? [splitFirst!.parameter, parameter] : [parameter]);
      if (!result.ok) return setMessage(result.message);
      changeSketch(result.sketch);
      setSplitFirst(null);
      setSelected([]);
      const notice =
        result.releasedConstraintIds.length || result.releasedFixedPointIds.length
          ? `Released relations: ${result.releasedConstraintIds.length}; released fixed control points: ${result.releasedFixedPointIds.length}. The exact pieces are independently editable.`
          : '';
      setSplitNotice(notice);
      setMessage(
        notice ? 'Curve split. Review the released relations shown above.' : 'Curve split. Click another curve to split, or press Escape.'
      );
      return;
    }
    if (tool === 'trim') {
      // Trimming may replace the clicked circle or delete its interval before mousedown.
      event.preventDefault();
      if (id) {
        const entity = sketch.entities.find(entity => entity.id === id);
        if (entity && isOwnedSplineHandle(entity))
          return setMessage('Spline tangent handles cannot be trimmed. Edit their constraints or reshape the spline.');
        if (sketchPatternOwner(sketch, id)) return setMessage('Remove the pattern relation before trimming its finite geometry.');
        const trimmed = trimSketchCurveAt(sketch, id, p);
        if (trimmed) changeSketch(trimmed);
        else setMessage('Trim supports line, circle and arc intervals. Select other curves and press Delete to remove them.');
      }
      return;
    }
    if (tool === 'dimension') {
      if (id) {
        const position = curveHit?.point ?? pointHit?.point ?? p;
        setCursor(position);
        applyDimensionEvent({ type: 'pick', entityId: id, previewId: newCadId(), additive: event.shiftKey, position });
      } else {
        const matrix = svg.current?.getScreenCTM();
        if (!matrix) return;
        const raw = new DOMPoint(event.clientX, event.clientY).matrixTransform(matrix.inverse());
        // Placement opens the input during pointerdown; suppress the following native mousedown focus.
        event.preventDefault();
        applyDimensionEvent({ type: 'place', position: { x: raw.x, y: -raw.y } });
      }
      return;
    }
    if (tool === 'select') {
      // The canvas owns keyboard focus throughout selection and geometry drags.
      event.preventDefault();
      if (!id) {
        if (tool === 'select') {
          const matrix = svg.current?.getScreenCTM();
          if (matrix) {
            const raw = new DOMPoint(event.clientX, event.clientY).matrixTransform(matrix.inverse());
            const start = { x: raw.x, y: -raw.y };
            boxGesture.current = {
              start,
              end: start,
              screenStart: { x: event.clientX, y: event.clientY },
              selected: [...selected],
              additive: event.shiftKey,
              moved: false,
            };
            event.preventDefault();
            event.currentTarget.setPointerCapture(event.pointerId);
          }
        }
        if (!event.shiftKey) setSelected([]);
        setDimension(null);
        return;
      }
      const next = event.shiftKey
        ? selected.includes(id)
          ? selected.filter(existing => existing !== id)
          : [...selected, id]
        : selected.includes(id)
          ? selected
          : [id];
      selectionHints.current[id] = { ...(curveHit?.point ?? pointHit?.point ?? p) };
      setSelected(next);
      setDimension(null);
      const entity = sketch.entities.find(e => e.id === id);
      if (entity && !event.shiftKey) {
        const radiusEntityId =
          next.length === 1 &&
          entity.type === 'circle' &&
          !sketch.constraints.some(c => (c.type === 'radius' || c.type === 'diameter') && !c.driven && c.entityId === entity.id)
            ? entity.id
            : undefined;
        const targets = dragTargets(sketch, next, { x: 0, y: 0 });
        if (!radiusEntityId && !targets.length) {
          setMessage('The selected points are fixed. Unfix them or edit the dimensions to move this geometry.');
          return;
        }
        drag.current = {
          origin: p,
          target: p,
          document: doc,
          preview: doc,
          partId: part!.id,
          selectedIds: next,
          points: radiusEntityId && entity.type === 'circle' ? [entity.centerId] : targets.map(t => t.pointId),
          radiusEntityId,
          moved: false,
          request: 0,
          solvedRequest: 0,
          working: false,
          ended: false,
          snapPointId: entity.type === 'point' && next.length === 1 ? entity.id : undefined,
        };
        event.currentTarget.setPointerCapture(event.pointerId);
      }
      return;
    }
    if (tool === 'spline' || tool === 'bezier') {
      const last = pending.at(-1);
      if (!last || Math.hypot(last.x - p.x, last.y - p.y) > 1e-7) {
        setPending([...pending, p]);
        pendingSnaps.current.push(lastDrawingHint.current);
      }
    } else if (!pending.length) {
      setPending([p]);
      centerArcSweep.current = null;
      pendingSnaps.current = [lastDrawingHint.current];
      setLineContinuation(false);
      const gesture = transitionDrawingGesture(drawingGesture.current, {
        type: 'press',
        tool,
        pointerId: event.pointerId,
        position: { x: event.clientX, y: event.clientY },
        canStart: true,
      });
      drawingGesture.current = gesture.state;
      if (gesture.state.phase === 'pressed') {
        setCursor(p);
        event.preventDefault();
        event.currentTarget.setPointerCapture(event.pointerId);
      }
      if (tool === 'arc') setMessage('Click the arc end, then move to shape the arc.');
    } else if (
      (tool === 'arc' ||
        tool === 'conic' ||
        tool === 'ellipse' ||
        tool === 'threePointCircle' ||
        tool === 'alignedRectangle' ||
        tool === 'centerPointArc' ||
        polygonTool) &&
      pending.length === 1
    ) {
      if (
        (tool === 'ellipse' || tool === 'threePointCircle' || tool === 'alignedRectangle' || tool === 'centerPointArc' || polygonTool) &&
        Math.hypot(p.x - pending[0]!.x, p.y - pending[0]!.y) < 0.1
      )
        return;
      if (polygonTool) {
        event.preventDefault();
        polygonCountGesture.current = { sides: Number(polygonSides), radius: Math.hypot(p.x - pending[0]!.x, p.y - pending[0]!.y) };
      }
      setPending([...pending, p]);
      if (tool === 'centerPointArc') centerArcSweep.current = { last: Math.atan2(p.y - pending[0]!.y, p.x - pending[0]!.x), sweep: 0 };
      pendingSnaps.current.push(lastDrawingHint.current);
      setMessage(
        polygonTool
          ? 'Enter the number of sides, or move toward/away from the center to adjust it. Click or press Enter to finish.'
          : tool === 'centerPointArc'
            ? 'Move clockwise or counterclockwise around the center, then click the arc end.'
            : tool === 'alignedRectangle'
              ? 'Click to set the perpendicular extent of the rectangle.'
              : tool === 'threePointCircle'
                ? 'Click the third point on the circle circumference.'
                : tool === 'ellipse'
                  ? 'Click to set the second axis radius, perpendicular to the first.'
                  : tool === 'arc'
                    ? 'Move to shape the arc, then click a point on it.'
                    : 'Click the conic control point.'
      );
    } else {
      // Rho opens during this pointerdown. Suppress the browser's following mousedown
      // focus so the new input keeps ownership after the complete click sequence.
      if (tool === 'conic') event.preventDefault();
      addShape(p);
    }
  };
  const pointerMove = (event: PointerEvent<SVGSVGElement>) => {
    if (slotDrag.current) {
      const matrix = svg.current?.getScreenCTM();
      if (!matrix) return;
      const raw = new DOMPoint(event.clientX, event.clientY).matrixTransform(matrix.inverse()),
        center = slotDrag.current.center;
      setSlotWidth(String(Math.round(2 * Math.hypot(raw.x - center.x, -raw.y - center.y) * 1e6) / 1e6));
      return;
    }
    if (circularDrag.current) {
      const matrix = svg.current?.getScreenCTM();
      if (!matrix) return;
      const raw = new DOMPoint(event.clientX, event.clientY).matrixTransform(matrix.inverse()),
        point = { x: raw.x, y: -raw.y },
        gesture = circularDrag.current,
        parsed = parseCircularPatternParameters(gesture.parameters);
      if (!parsed.ok) return;
      const text = (n: number) => String(Math.round(n * 1e6) / 1e6);
      if (gesture.kind === 'center')
        setCircularParameters({
          ...gesture.parameters,
          centerX: text(parsed.center.x + point.x - gesture.start.x),
          centerY: text(parsed.center.y + point.y - gesture.start.y),
        });
      else {
        const a = Math.atan2(point.y - parsed.center.y, point.x - parsed.center.x);
        gesture.sweep += Math.atan2(Math.sin(a - gesture.last), Math.cos(a - gesture.last));
        gesture.last = a;
        setCircularParameters({
          ...gesture.parameters,
          closed: false,
          angle: text(Math.max(-359.999999, Math.min(359.999999, (gesture.sweep * 180) / Math.PI))),
        });
      }
      return;
    }
    if (patternDrag.current) {
      const matrix = svg.current?.getScreenCTM();
      if (!matrix) return;
      const raw = new DOMPoint(event.clientX, event.clientY).matrixTransform(matrix.inverse()),
        { index, anchor, parameters } = patternDrag.current;
      const x = raw.x - anchor.x,
        y = -raw.y - anchor.y,
        spacing = String(Math.round(Math.hypot(x, y) * 1e6) / 1e6),
        angle = String(Math.round(((Math.atan2(y, x) * 180) / Math.PI) * 1e6) / 1e6);
      setLinearParameters({
        ...parameters,
        ...(index === 0 ? { spacingX: spacing, angleX: angle } : { spacingY: spacing, angleY: angle }),
      });
      return;
    }

    if (transformDrag.current) {
      const matrix = svg.current?.getScreenCTM();
      if (!matrix) return;
      const raw = new DOMPoint(event.clientX, event.clientY).matrixTransform(matrix.inverse());
      let point = { x: raw.x, y: -raw.y };
      const { kind, start, parameters } = transformDrag.current,
        parsed = parseTransformParameters(parameters);
      if (!parsed.ok) return;
      const text = (n: number) => String(Math.round(n * 1e6) / 1e6);
      const center = { x: parsed.pivot.x + parsed.translation.x, y: parsed.pivot.y + parsed.translation.y };
      if (kind === 'translate')
        setTransformParameters({
          ...parameters,
          dx: text(parsed.translation.x + point.x - start.x),
          dy: text(parsed.translation.y + point.y - start.y),
        });
      if (kind === 'rotate') {
        const delta = Math.atan2(point.y - center.y, point.x - center.x) - Math.atan2(start.y - center.y, start.x - center.x);
        setTransformParameters({ ...parameters, angle: text(parsed.angle + (delta * 180) / Math.PI) });
      }
      if (kind === 'scale') {
        const initial = Math.hypot(start.x - center.x, start.y - center.y);
        if (initial > CAD_GEOMETRY_TOLERANCE)
          setTransformParameters({
            ...parameters,
            scale: text(Math.max(0.001, (parsed.scale * Math.hypot(point.x - center.x, point.y - center.y)) / initial)),
          });
      }
      if (kind === 'pivot') {
        const snap = pickSketchPoint(shownSketch!, { x: event.clientX, y: event.clientY }, { project: projectPoint });
        if (snap) point = snap.point;
        const r = (parsed.angle * Math.PI) / 180,
          worldDx = point.x - start.x,
          worldDy = point.y - start.y;
        const x = parsed.pivot.x + (Math.cos(r) * worldDx + Math.sin(r) * worldDy) / parsed.scale,
          y = parsed.pivot.y + (-Math.sin(r) * worldDx + Math.cos(r) * worldDy) / parsed.scale;
        const dx = parsed.pivot.x - x,
          dy = parsed.pivot.y - y,
          c = parsed.scale * Math.cos(r),
          s = parsed.scale * Math.sin(r);
        setTransformParameters({
          ...parameters,
          pivotX: text(x),
          pivotY: text(y),
          dx: text(parsed.translation.x + (1 - c) * dx + s * dy),
          dy: text(parsed.translation.y - s * dx + (1 - c) * dy),
        });
      }
      return;
    }

    if (chamferDrag.current) {
      const matrix = svg.current?.getScreenCTM();
      if (!matrix) return;
      const point = new DOMPoint(event.clientX, event.clientY).matrixTransform(matrix.inverse());
      const { side, origin, direction } = chamferDrag.current;
      const distance = Math.max(0.001, (point.x - origin.x) * direction.x + (-point.y - origin.y) * direction.y);
      setChamferDistances(previous =>
        previous.map((value, index) => (index === side ? String(Math.round(distance * 1000) / 1000) : value))
      );
      return;
    }

    contextPress.current = transitionSketchContextPress(contextPress.current, {
      type: 'move',
      pointerId: event.pointerId,
      position: { x: event.clientX, y: event.clientY },
    }).state;
    drawingGesture.current = transitionDrawingGesture(drawingGesture.current, {
      type: 'move',
      pointerId: event.pointerId,
      position: { x: event.clientX, y: event.clientY },
    }).state;
    const annotation = annotationDrag.current;
    if (annotation) {
      const matrix = svg.current?.getScreenCTM();
      if (
        !matrix ||
        (!annotation.moved && Math.hypot(event.clientX - annotation.screenStart.x, event.clientY - annotation.screenStart.y) < 3)
      )
        return;
      annotation.moved = true;
      const point = new DOMPoint(event.clientX, event.clientY).matrixTransform(matrix.inverse());
      const labelPosition = {
        x: annotation.position.x + point.x - annotation.worldStart.x,
        y: annotation.position.y - point.y - annotation.worldStart.y,
      };
      const next = {
        ...annotation.document,
        parts: annotation.document.parts.map(p => ({
          ...p,
          sketch: {
            ...p.sketch,
            constraints: p.sketch.constraints.map(c =>
              c.id === annotation.id && numeric(c) ? withDimensionPlacement(p.sketch, c, labelPosition) : c
            ),
          },
        })),
      };
      documentRef.current = next;
      setDocument(next);
      return;
    }
    const box = boxGesture.current;
    if (box) {
      const matrix = svg.current?.getScreenCTM();
      if (!matrix) return;
      const raw = new DOMPoint(event.clientX, event.clientY).matrixTransform(matrix.inverse());
      box.end = { x: raw.x, y: -raw.y };
      box.additive ||= event.shiftKey;
      box.moved ||= Math.hypot(event.clientX - box.screenStart.x, event.clientY - box.screenStart.y) >= 3;
      if (box.moved) setSelectionBox({ start: box.start, end: box.end });
      setSnapCue(null);
      setDrawingCue(null);
      setHoveredPoint(null);
      return;
    }
    let p = pointAt(event);
    if (sketch && modification.phase !== 'idle') {
      const hit = pickSketchSnap(
        sketch,
        { x: event.clientX, y: event.clientY },
        { project: projectPoint, pointRadiusPx: -1, includeMidpoints: false }
      );
      setHoveredModifyCurve(hit?.entityId ?? null);
      if (modification.phase === 'extend' && modification.entityId) setModifyTarget(p);
    }
    if (placingDimension) {
      const matrix = svg.current?.getScreenCTM();
      if (matrix) {
        const raw = new DOMPoint(event.clientX, event.clientY).matrixTransform(matrix.inverse());
        p = { x: raw.x, y: -raw.y };
        if (sketch) setDimensionFlow(transitionDimensionWorkflow(sketch, dimensionFlow, { type: 'hover', position: p }).state);
      }
    }
    const movingPoint = drag.current;
    let drop: CadDrawingInference | null = null;
    if (movingPoint?.snapPointId) {
      const source = movingPoint.document.parts.find(part => part.id === movingPoint.partId)!.sketch;
      const point = source.entities.find(entity => entity.id === movingPoint.snapPointId)!;
      const matrix = svg.current?.getScreenCTM();
      if (point.type === 'point' && matrix) {
        const raw = new DOMPoint(event.clientX, event.clientY).matrixTransform(matrix.inverse());
        drop = inferDragPoint(
          source,
          point.id,
          { x: point.x + raw.x - movingPoint.origin.x, y: point.y - raw.y - movingPoint.origin.y },
          { project: projectPoint, excludePointIds: movingPoint.points, enabled: snap && !event.shiftKey }
        );
        movingPoint.dropInference = drop;
        p = { x: movingPoint.origin.x + drop.point.x - point.x, y: movingPoint.origin.y + drop.point.y - point.y };
      }
    }
    if (tool === 'centerPointArc' && pending.length === 2 && centerArcSweep.current) {
      const center = pending[0]!;
      if (Math.hypot(p.x - center.x, p.y - center.y) > 1e-6) {
        const angle = Math.atan2(p.y - center.y, p.x - center.x),
          previous = centerArcSweep.current;
        previous.sweep += Math.atan2(Math.sin(angle - previous.last), Math.cos(angle - previous.last));
        previous.last = angle;
      }
    }
    if (polygonTool && pending.length === 2 && polygonCountGesture.current) {
      const anchor = polygonCountGesture.current,
        center = pending[0]!;
      if (Number.isInteger(anchor.sides))
        setPolygonSides(
          String(
            Math.max(
              3,
              Math.min(50, Math.round(anchor.sides + ((Math.hypot(p.x - center.x, p.y - center.y) - anchor.radius) * markerScale) / 12))
            )
          )
        );
    }
    setCursor(drop?.point ?? p);
    setDrawingCue(movingPoint?.snapPointId ? (snap && !event.shiftKey ? drop : null) : lastDrawingHint.current);
    const pointHit = sketch
      ? pickSketchPoint(
          sketch,
          { x: event.clientX, y: event.clientY },
          { project: projectPoint, excludePointIds: drag.current?.points, selectedEntityIds: dimensionSelection }
        )
      : null;
    setHoveredPoint(pointHit?.targetPointId ?? null);
    setSnapCue(
      snap && !(movingPoint?.snapPointId && event.shiftKey)
        ? drop?.snap
          ? { point: drop.point, label: snapLabels[drop.snap.kind] }
          : inference.current
            ? { point: p, label: inference.current }
            : lastSnap.current
              ? { point: lastSnap.current.point, label: snapLabels[lastSnap.current.kind] }
              : null
        : null
    );
    if (pan.current?.turn && (contextPress.current.phase !== 'pressed' || contextPress.current.moved))
      setSketchTurn(turnedBy(pan.current.turn, event.clientX - pan.current.x, event.clientY - pan.current.y));
    else if (pan.current && (contextPress.current.phase !== 'pressed' || contextPress.current.moved)) {
      const v = pan.current;
      // Its own size, which a turned drawing's box isn't.
      const width = svg.current!.clientWidth,
        height = svg.current!.clientHeight;
      // A turned drawing moves along its own axes, so the move on screen is taken back through its turn.
      let dx = event.clientX - v.x,
        dy = event.clientY - v.y;
      if (sketchBackdrop && sketchTurn !== straightOn) {
        if (edgeOn(sketchTurn)) return;
        const [a, b, c, d] = drawingMatrix(sketchTurn),
          det = a * d - b * c;
        [dx, dy] = [(d * dx - c * dy) / det, (a * dy - b * dx) / det];
      }
      setView({
        ...v.view,
        x: v.view.x - (dx * v.view.w) / width,
        y: v.view.y - (dy * v.view.h) / height,
      });
    }
    const moving = drag.current;
    if (!moving || moving.ended || moving.failure) return;
    const dx = p.x - moving.origin.x,
      dy = p.y - moving.origin.y;
    if (!moving.moved && Math.hypot(dx, dy) < 0.25) return;
    moving.moved = true;
    moving.target = p;
    moving.request++;
    void solveDrag(moving);
  };
  const pointerEnd = (cancel = false, event?: PointerEvent<SVGSVGElement>) => {
    if (slotDrag.current) {
      if (cancel) setSlotWidth(slotDrag.current.width);
      slotDrag.current = null;
      return;
    }
    if (circularDrag.current) {
      if (cancel) setCircularParameters(circularDrag.current.parameters);
      circularDrag.current = null;
      return;
    }
    if (patternDrag.current) {
      if (cancel) setLinearParameters(patternDrag.current.parameters);
      patternDrag.current = null;
      return;
    }

    if (transformDrag.current) {
      if (cancel) setTransformParameters(transformDrag.current.parameters);
      transformDrag.current = null;
      return;
    }

    if (chamferDrag.current) {
      if (cancel) setChamferDistances(chamferDrag.current.previous);
      chamferDrag.current = null;
      return;
    }

    pan.current = null;
    if (contextPress.current.phase === 'pressed') {
      const context = transitionSketchContextPress(
        contextPress.current,
        cancel || !event
          ? { type: 'cancel' }
          : { type: 'release', pointerId: event.pointerId, position: { x: event.clientX, y: event.clientY } }
      );
      contextPress.current = context.state;
      if (context.open) openContext(context.open.target, context.open.position);
      return;
    }
    if (drawingGesture.current.phase === 'pressed') {
      const gesture = transitionDrawingGesture(
        drawingGesture.current,
        cancel || !event
          ? { type: 'cancel' }
          : { type: 'release', pointerId: event.pointerId, position: { x: event.clientX, y: event.clientY } }
      );
      drawingGesture.current = gesture.state;
      if (gesture.effect === 'cancel') {
        setPending([]);
        pendingSnaps.current = [];
        setLineContinuation(false);
        setDrawingCue(null);
        setSnapCue(null);
      } else if (gesture.effect === 'complete' && event) {
        const end = pointAt(event);
        setCursor(end);
        addShape(end);
      }
      return;
    }
    const box = boxGesture.current;
    if (box) {
      boxGesture.current = null;
      setSelectionBox(null);
      if (cancel) setSelected(box.selected);
      else if (box.moved && sketch) {
        const result = boxSelectSketch(sketch, box, {
          visiblePointIds: visibleSketchPointIds(sketch, selected),
          curveTolerance: 0.25 / markerScale,
        });
        setSelected(box.additive ? [...new Set([...box.selected, ...result.entityIds])] : result.entityIds);
        if (!box.additive) setSelectedConstraints([]);
      } else if (!cancel && !box.moved && !box.additive && tool === 'select' && !faceSketch && part) {
        const entry = cutRegionAt(topRegions(cutRegions(part)), box.start);
        if (entry) setRegionField({ entry, anchor: box.start });
      }
      return;
    }
    const annotation = annotationDrag.current;
    if (annotation) {
      annotationDrag.current = null;
      if (cancel) {
        documentRef.current = annotation.document;
        setDocument(annotation.document);
      } else if (annotation.moved) commit(documentRef.current);
      if (cancel || !annotation.moved) requestSketchCheck();
      svg.current?.focus();
      return;
    }
    const moving = drag.current;
    if (!moving) return;
    // Pointer capture is lost after a normal release; it must not cancel the finishing solve.
    if (moving.ended) return;
    if (cancel) {
      drag.current = null;
      setDocument(moving.document);
      documentRef.current = moving.document;
      setBusy(false);
      requestSketchCheck();
    } else if (moving.moved) {
      moving.ended = true;
      setBusy(true);
      void solveDrag(moving);
    } else {
      drag.current = null;
      requestSketchCheck();
      restoreCanvasKeyboard();
    }
  };
  const prepareDocument = (): CadDocument | null => {
    const blocked = (reason: string) => {
      setFinishError(reason);
      setMessage(reason);
      callbacks.current.onFinishBlocked?.(reason);
      return null;
    };
    if (busy || solving || finishing.current || preparingDimension.current) return blocked('Wait for the current sketch check to finish.');
    const reason = !thicknessValid
      ? 'Enter a valid part thickness before finishing the sketch.'
      : tool === 'slot' && selected.length
        ? 'Create the slot or press Escape before finishing the sketch.'
        : (tool === 'linearPattern' || tool === 'circularPattern') && selected.length
          ? 'Apply the pattern or press Escape before finishing the sketch.'
          : tool === 'transform' && selected.length
            ? 'Apply the transform or press Escape before finishing the sketch.'
            : splitFirst
              ? 'Choose the second split point or press Escape before finishing the sketch.'
              : (tool === 'fillet' || tool === 'chamfer') && selected.length
                ? 'Apply the corner preview or press Escape before finishing the sketch.'
                : modification.phase === 'mirror' && modification.entityIds.length
                  ? 'Choose the mirror line or press Escape before finishing the sketch.'
                  : modification.phase === 'extend' && modification.entityId
                    ? 'Place the extended endpoint or press Escape before finishing the sketch.'
                    : pending.length && !lineContinuation
                      ? 'Complete the current shape or press Escape before finishing the sketch.'
                      : null;
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
  useImperativeHandle(controller, () => ({ finish, prepareDocument }));
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
  const openFeature = (kind: 'extrude' | 'pattern', partId: string) => {
    setPartCutting(null);
    setVariableDialog(null);
    setTransformDialog(null);
    setChoosingFace(false);
    setPartId(partId);
    setSelected([]);
    chooseTool('select');
    setShowWorkspace(true);
    setFeatureDialog({ kind, partId, before: documentRef.current });
  };
  const closeFeature = (keep: boolean) => {
    if (!keep && featureDialog) commit(featureDialog.before);
    // A removed sketch is a cut in the board it was drawn on now, so that board is the one selected.
    const on = featureDialog?.remove && featureDialog.remove.solid.parts.find(p => p.id === featureDialog.partId)?.drawnOn?.on;
    if (keep && on && !('plane' in on)) setPartId(on.partId);
    setFeatureDialog(null);
  };
  /** Opens a part's sketch from the studio, remembering the design to go back to if it's cancelled. */
  const openSketch = (partId: string, before = documentRef.current) => {
    sketchBefore.current = before;
    setFeatureDialog(null);
    setVariableDialog(null);
    setTransformDialog(null);
    setPartCutting(null);
    setChoosingFace(false);
    setPartId(partId);
    setSelected([]);
    setShowWorkspace(false);
    setShow3D(false);
    requestAnimationFrame(() => svg.current?.focus());
  };
  /** Back to the studio from a sketch: keeping it, or leaving the design as it was before it opened. */
  const closeSketch = (keep: boolean) => {
    if (keep && part && studioSession && part.drawnOn && !part.thin && isSingleLine(part)) {
      // Drawn as one line: it's a thin board, set up in its Extrude dialog next.
      commit(replacePart(documentRef.current, part.id, p => ({ ...p, thin: { depth: 100, midPlane: true } })));
      extrudeAfterSketch.current = part.id;
    }
    if (keep) {
      // A value still being typed, such as a dimension, is part of the sketch being kept.
      const error =
        acceptOffset() ||
        applyDimensionValue() ||
        applyConicRho() ||
        (creationValues?.editing ? applyCreationValue({ advance: false }) : null);
      if (error) return setMessage(error);
    }
    if (!keep && sketchBefore.current) commit(sketchBefore.current);
    sketchBefore.current = null;
    setMessage('');
    chooseTool('select');
    setSelected([]);
    setShow3D(false);
    setShowWorkspace(true);
    const fresh = extrudeAfterSketch.current;
    extrudeAfterSketch.current = null;
    if (keep && fresh && hasOutline(documentRef.current, fresh)) openFeature('extrude', fresh);
  };
  /** Opens what a step of the design made: its sketch, its dialog, or its part in 3D. */
  const openStep = (step: DesignStep) => {
    // In the studio a step opens its dialog, and a sketch opens to be drawn on, as the reference does.
    if (studioSession && step.kind === 'sketch') return openSketch(step.partId);
    if (studioSession && step.kind === 'extrude') return openFeature('extrude', step.partId);
    if (studioSession && step.kind === 'copy') {
      const copy = documentRef.current.parts.find(candidate => candidate.id === step.partId)?.copies?.find(c => c.id === step.copyId);
      if (copy?.offset) return openTransform(step.partId, copy.id);
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
      const prepared = prepareDocument();
      if (prepared && hasOutline(prepared, step.partId)) onEditFaceSketch(prepared, step.partId, step.sketchId);
    }
  };
  /** A row of the studio's feature list: edited, deleted, suppressed, or its sketch opened. */
  const featureAction = (entry: FeatureEntry, action: FeatureAction) => {
    const current = documentRef.current;
    setStudioRefusal(null);
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
    if (action !== 'delete') return;
    setFeatureDialog(null);
    if (step.kind === 'sketch' || step.kind === 'extrude') {
      // A part is its sketch pushed out, so deleting either deletes the part.
      const parts = current.parts.filter(candidate => candidate.id !== step.partId);
      commit(withFeatureVersion({ ...current, parts }));
      setPartId(parts[0]?.id ?? '');
    } else if (step.kind === 'pattern') commit(setPartPattern(current, step.partId, null));
    else if (step.kind === 'partCut' && step.partCutId) commit(removePartCut(current, step.partCutId));
    else if (step.kind === 'cut' && step.cutId) commit(removeCadFeature(current, step.partId, step.cutId));
  };
  const openTransform = (partId: string, copyId?: string) => {
    setFeatureDialog(null);
    setPartCutting(null);
    setVariableDialog(null);
    setChoosingFace(false);
    setPartId(partId);
    setShowWorkspace(true);
    setTransformDialog({ partId, ...(copyId && { copyId }) });
  };
  /** Starts a new part drawn on a base plane or a part's face, and opens its sketch. */
  const newPartOn = (on: CadDrawnOn['on']) => {
    const before = documentRef.current;
    // A design's board thickness, when it names one, is what a new part is made from.
    const board = ['material', 'board', 'thickness'].find(name => Object.hasOwn(variableScope, name));
    const added = createCadPart(
      `Part ${documentRef.current.parts.length + 1}`,
      board ? variableScope[board]!.value : (part?.thickness ?? 18)
    );
    // A design's blank first part is the one sketched, rather than a second beside it.
    const blank = documentRef.current.parts.length === 1 && isBlank(documentRef.current.parts[0]!);
    const base = blank ? documentRef.current.parts[0]! : added;
    const placed = { ...base, ...(board && { thicknessExpression: board }), drawnOn: { on, offset: 0 } };
    // The face's edges are in the sketch from the start, to draw onto so the part follows the face.
    const drawn = { ...placed, sketch: withFaceEdges(documentRef.current, placed) };
    commit({
      ...documentRef.current,
      revision: documentRef.current.revision + 1,
      parts: blank ? [drawn] : [...documentRef.current.parts, drawn],
    });
    setMessage(`Draw the new part's outline on ${drawnOnName(documentRef.current, on)}, then finish to see it in place.`);
    if (studioSession) {
      extrudeAfterSketch.current = drawn.id;
      return openSketch(drawn.id, before);
    }
    setPartId(drawn.id);
    setSelected([]);
    setShowWorkspace(false);
    setShow3D(false);
    requestAnimationFrame(() => svg.current?.focus());
  };
  /** A base plane clicked in the view or the feature list: drawn on while choosing, otherwise picked for the next sketch. */
  const pickPlane = (plane: BasePlane) => {
    if (choosingFace) {
      setChoosingFace(false);
      setSelectedPlane(null);
      return newPartOn({ plane });
    }
    setSelectedFace(null);
    setSelectedPlane(picked => (picked === plane ? null : plane));
  };
  const studioCommand = (command: StudioCommand) => {
    setStudioRefusal(null);
    // Starting one step closes any other step's dialog.
    setVariableDialog(null);
    setTransformDialog(null);
    if (command === 'sketch') {
      setFeatureDialog(null);
      setPartCutting(null);
      // A plane or face picked first is drawn on straight away, as the reference sketches on what's selected.
      // A face picked on a part that has since gone, as when it was deleted, is no longer there to draw on.
      const face = selectedFace && cadFaceFrame(documentRef.current, selectedFace);
      const picked = !choosingFace && (selectedPlane ? { plane: selectedPlane } : face && !('error' in face) ? selectedFace : null);
      if (picked) {
        setSelectedPlane(null);
        setSelectedFace(null);
        return newPartOn(picked);
      }
      setChoosingFace(!choosingFace);
    } else if (command === 'transform') {
      if (part) openTransform(part.id);
    } else if (command === 'variable') {
      setFeatureDialog(null);
      setPartCutting(null);
      setChoosingFace(false);
      setVariableDialog({});
    } else if (command === 'cutParts') {
      setFeatureDialog(null);
      setChoosingFace(false);
      setPartCutting({});
    } else if (part) openFeature(command, part.id);
  };
  const sketchOnFace = (face: CadFaceRef) => {
    if (!part || !onEditFaceSketch) return;
    // Checked first: a blocked sketch command mustn't leave an empty face sketch behind.
    const prepared = prepareDocument();
    if (!prepared || !hasOutline(prepared, part.id)) return;
    const added = addFaceSketch(prepared, part.id, face);
    commit(added.document);
    onEditFaceSketch(documentRef.current, part.id, added.sketchId);
  };
  const valuePosition = (anchor: Point | null, desiredWidth = 216, topOffset = 12) => {
    const matrix = svg.current?.getScreenCTM();
    const drawing = svg.current?.closest('.cad-drawing')?.getBoundingClientRect();
    if (!anchor || !matrix || !drawing) return undefined;
    const screen = new DOMPoint(anchor.x, -anchor.y).matrixTransform(matrix);
    const width = Math.min(desiredWidth, Math.max(0, drawing.width - 16));
    return {
      left: Math.max(8, Math.min(screen.x - drawing.left - width / 2, drawing.width - width - 8)),
      top: Math.max(8, Math.min(screen.y - drawing.top + topOffset, drawing.height - 44 - 8)),
      width,
    };
  };
  const dimensionEditorPosition =
    currentDimension && numeric(currentDimension) && sketch
      ? valuePosition(dimensionAnchor(currentDimension, sketch, markerScale))
      : undefined;
  const creationPositions =
    creationValues && sketch
      ? creationValues.steps.map((_, index) =>
          valuePosition(
            creationValueAnchor(creationValues, sketch, index, markerScale),
            creationValues.editing && index === creationValues.index ? 170 : 72,
            -12
          )
        )
      : [];
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
  const canEditCanvasDimensions = !constraintMode && dimensionFlow.phase === 'idle' && (tool === 'select' || tool === 'dimension');
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
  const stroke =
    activeSketchStatus?.status === 'conflict'
      ? '#c73535'
      : currentSolverResult && activeSketchStatus?.status === 'solved' && activeSketchStatus.dof === 0
        ? SKETCH_APPEARANCE.constrainedColor
        : SKETCH_APPEARANCE.freeColor;
  const grid = Math.max(1, 10 ** Math.floor(Math.log10(view.w / 20)));
  const chainPreview = sketch && chainGeometry(sketch, chain);
  const numberOfShapes = sketch?.entities.filter(e => e.type !== 'point' && !e.construction).length ?? 0;
  const acceptanceNotice = notice ?? finishError;
  // The parts already built, behind an open sketch in the studio, seen straight at its plane as the drawing is.
  const sketchBackdrop = useMemo(() => {
    if (!studioSession || showWorkspace || show3D || !part || !canvasBox?.width || !canvasBox.height) return null;
    const on = part.drawnOn?.on ?? { plane: 'top' as const };
    const frame = cadFaceFrame(doc, on);
    if ('error' in frame) return null;
    const offset = part.drawnOn?.offset ?? 0;
    const origin = frame.origin.map((value, axis) => value + frame.normal[axis]! * offset) as [number, number, number];
    // The drawing keeps its view box whole, so its shorter side shows more than the box.
    const scale = Math.min(canvasBox.width / view.w, canvasBox.height / view.h);
    const steps = designSteps(doc);
    const at = steps.findIndex(step => step.id === `${part.id}:sketch`);
    const before = at > 0 ? rolledBackTo(doc, steps[at - 1]!.id) : { ...doc, parts: [] };
    // A part something is drawn on stays where the drawing is, even when what's drawn on it is only this sketch's part.
    const supports = cadDrawnOnSupports(doc);
    return {
      document: {
        ...before,
        parts: before.parts
          .filter(candidate => candidate.id !== part.id)
          .map(candidate =>
            !candidate.placement && supports.has(candidate.id) ? { ...candidate, placement: CAD_IDENTITY_PLACEMENT } : candidate
          ),
      },
      view: {
        origin,
        x: frame.x,
        y: frame.y,
        normal: frame.normal,
        center: [view.x + view.w / 2, -(view.y + view.h / 2)] as [number, number],
        width: canvasBox.width / scale,
        height: canvasBox.height / scale,
        turned: sketchTurn === straightOn ? undefined : turnAxes(sketchTurn),
      },
    };
  }, [studioSession, showWorkspace, show3D, part, canvasBox, doc, view, sketchTurn]);
  // Each sketch opens looking straight at its plane, with nothing of the parts behind it picked.
  useEffect(() => {
    setSketchTurn(straightOn);
    setPickedEdges([]);
  }, [part?.id, showWorkspace]);
  // The parts' edges the drawing shows: all of them looking straight at the plane, and once turned, those in it, the
  // only ones that still line up with what's seen.
  const shownEdges = sketchBackdrop ? partEdges.filter(edge => edge.onPlane || sketchTurn === straightOn) : [];
  /** `u`: the picked edges become the sketch's own, fixed where they are, to draw and constrain against. */
  const takeEdges = () => {
    if (!sketch) return;
    let next = sketch;
    for (const edge of partEdges.filter(candidate => pickedEdges.includes(candidate.key)))
      next = addLine(next, { x1: edge.x1, y1: edge.y1, x2: edge.x2, y2: edge.y2 });
    const before = new Set(sketch.entities.map(entity => entity.id));
    const added = next.entities.filter(entity => !before.has(entity.id) && entity.type === 'line');
    const ends = new Set(added.flatMap(line => (line.type === 'line' ? [line.startId, line.endId] : [])));
    changeSketch({
      ...next,
      entities: next.entities.map(entity => (entity.type === 'point' && ends.has(entity.id) ? { ...entity, fixed: true } : entity)),
    });
    setPickedEdges([]);
    setSelected(added.map(line => line.id));
  };
  // One line drawn on a plane or face is a board drawn edge-on, as the reference's thin extrude: its sketch can close.
  const edgeOnBoard = !!(studioSession && part?.drawnOn && !part.thin && isSingleLine(part));
  // Whether the open sketch can be finished: closed back to the studio, or the whole design accepted outside one.
  const sketchCanFinish = edgeOnBoard
    ? !solving
    : faceSketch
      ? !solving &&
        !problems.length &&
        !splitFirst &&
        !((tool === 'slot' || tool === 'transform' || tool === 'linearPattern' || tool === 'circularPattern') && selected.length)
      : thicknessValid &&
        !solving &&
        !problems.length &&
        numberOfShapes > 0 &&
        !splitFirst &&
        !((tool === 'slot' || tool === 'transform' || tool === 'linearPattern' || tool === 'circularPattern') && selected.length) &&
        !((tool === 'fillet' || tool === 'chamfer') && selected.length);
  // The parts, each with an eye to show or hide it in the view. In the studio they sit at the bottom left, below the
  // features, as in the reference.
  const partsPanel = (
    <>
      <div className="cad-panel-heading" hidden={!!faceSketch}>
        <h2>Parts ({studioSession ? doc.parts.reduce((count, p) => count + 1 + (p.copies?.length ?? 0), 0) : doc.parts.length})</h2>
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
      <ul className="cad-part-list" aria-label="Parts" hidden={!!faceSketch}>
        {doc.parts
          .flatMap(p => [
            { key: p.id, part: p, name: p.name },
            // In the studio every copy is a part of its own in the list, as the reference lists them, with its own eye.
            ...(studioSession
              ? (p.copies ?? []).map((copy, index) => ({ key: `${p.id}/${copy.id}`, part: p, name: cadCopyName(p, index) }))
              : []),
          ])
          .map(({ key, part: p, name }) => (
            <li key={key}>
              <button
                type="button"
                aria-pressed={key === part?.id}
                onClick={() => {
                  if (partCutting && showWorkspace) return pickForCut(p.id);
                  setPartId(p.id);
                  setSelected([]);
                  chooseTool('select');
                }}>
                <span aria-hidden="true">▱</span>
                <span>{name}</span>
                {key === p.id && partTrouble(p.id) && (
                  <span className="cad-part-trouble" role="img" aria-label={partTrouble(p.id)!} title={partTrouble(p.id)!}>
                    ⚠
                  </span>
                )}
                <small>{p.thickness} mm</small>
              </button>
              {studioSession && (
                <button
                  type="button"
                  className="cad-part-eye"
                  aria-label={`${hiddenParts.has(key) ? 'Show' : 'Hide'} ${name}`}
                  title={hiddenParts.has(key) ? 'Show in the view' : 'Hide in the view'}
                  aria-pressed={!hiddenParts.has(key)}
                  onClick={() =>
                    setHiddenParts(previous => {
                      const next = new Set(previous);
                      if (next.has(key)) next.delete(key);
                      else next.add(key);
                      return next;
                    })
                  }>
                  <svg viewBox="0 0 24 24" aria-hidden="true">
                    <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z" />
                    {hiddenParts.has(key) ? <path d="M4 4l16 16" /> : <circle cx="12" cy="12" r="3" />}
                  </svg>
                </button>
              )}
            </li>
          ))}
      </ul>
    </>
  );
  return (
    <div
      ref={root}
      className="cad-editor"
      aria-busy={busy}
      data-demo-mode={isDemoMode() || undefined}
      onKeyDown={keyDown}
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
                  : transformDialog
                    ? 'transform'
                    : (featureDialog?.kind ?? null)
          }
          disabled={{
            ...(!partHasOutline && { extrude: 'Select a part first', pattern: 'Select a part first', transform: 'Select a part first' }),
            ...(doc.parts.length < 2 && { cutParts: 'Cutting parts needs two parts' }),
          }}
          canUndo={session.past.length > 0}
          canRedo={session.future.length > 0}
          canFinish={
            thicknessValid && !solving && !problems.length && !featureDialog && !partCutting && !variableDialog && !transformDialog
          }
          onCommand={studioCommand}
          onUndo={() => navigateHistory()}
          onRedo={() => navigateHistory(true)}
          onCancel={() => void cancel()}
          onFinish={() => void finish()}
        />
      ) : (
        <SketchToolbar
          tools={tools}
          searchHighlight={searchHighlight}
          onSearch={() => {
            setSearchMode(true);
            setPalette(value => !value);
          }}
          tool={tool}
          construction={construction}
          constraintMode={constraintMode}
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
            <FeatureList
              document={doc}
              selectedPartId={part?.id ?? null}
              onSelect={entry => {
                if (entry.kind === 'step') {
                  setPartId(entry.step.partId);
                  setSelected([]);
                }
              }}
              onAction={featureAction}
              rollback={rollbackStep}
              onRename={(partId, name) => commit(replacePart(documentRef.current, partId, p => ({ ...p, name })))}
              {...(showWorkspace && { selectedPlane, onPickPlane: pickPlane })}
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
                  onEdit={
                    onEditFaceSketch &&
                    (sketchId => {
                      const prepared = prepareDocument();
                      if (prepared && hasOutline(prepared, part.id)) onEditFaceSketch(prepared, part.id, sketchId);
                    })
                  }
                  variables={variableScope}
                  onCutDepth={(cut, depth, expression) =>
                    commit(setCutDepth(documentRef.current, part.id, cut.sketchId, cut.regionId, depth, expression))
                  }
                  onMoveToTop={sketchId => commit(moveFaceSketch(documentRef.current, part.id, sketchId, 'top'))}
                  onNew={onEditFaceSketch && (face => sketchOnFace(face))}
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
          {studioSession && studioRefusal && (
            <p className="cad-notice cad-studio-refusal" role="alert">
              {studioRefusal}
            </p>
          )}
          {showWorkspace &&
            transformDialog &&
            (() => {
              const target = doc.parts.find(candidate => candidate.id === transformDialog.partId);
              return target ? (
                <TransformDialog
                  key={`${target.id}:${transformDialog.copyId ?? 'new'}`}
                  document={doc}
                  part={target}
                  copyId={transformDialog.copyId}
                  variables={variableScope}
                  onSave={next => {
                    commit(next);
                    setTransformDialog(null);
                  }}
                  onCancel={() => setTransformDialog(null)}
                />
              ) : null;
            })()}
          {showWorkspace && variableDialog && (
            <VariableDialog
              key={variableDialog.id ?? 'new'}
              document={doc}
              variableId={variableDialog.id}
              onSave={next => {
                commit(next);
                setVariableDialog(null);
              }}
              onCancel={() => setVariableDialog(null)}
            />
          )}
          {showWorkspace &&
            featureDialog &&
            (() => {
              // While it's a Remove, the part is gone from the design: the dialog shows it as it was.
              const source = featureDialog.remove?.solid ?? doc;
              const target = source.parts.find(candidate => candidate.id === featureDialog.partId);
              if (!target) return null;
              const on = target.drawnOn?.on;
              const canRemove = !!on && !('plane' in on) && (on.face === 'top' || on.face === 'underside') && !target.thin;
              const props = {
                document: doc,
                part: target,
                variables: variableScope,
                onChange: (change: (document: CadDocument) => CadDocument) => commit(change(documentRef.current)),
                onOk: () => closeFeature(true),
                onCancel: () => closeFeature(false),
              };
              return featureDialog.kind === 'extrude' ? (
                <ExtrudeDialog
                  key={target.id}
                  {...props}
                  document={source}
                  onEditSketch={() => {
                    // The sketch is edited as the part's, so a Remove goes back to New first.
                    if (featureDialog.remove) commit(featureDialog.remove.solid);
                    openSketch(target.id);
                  }}
                  removal={featureDialog.remove}
                  onRemoval={
                    canRemove
                      ? removal => {
                          const solid = featureDialog.remove?.solid ?? documentRef.current;
                          if (!removal) {
                            commit(solid);
                            setFeatureDialog({ ...featureDialog, remove: undefined });
                            return null;
                          }
                          const result = extrudeRemove(solid, target.id, removal.depth, removal.depthExpression);
                          if ('error' in result) return result.error;
                          commit(result.document);
                          setFeatureDialog({ ...featureDialog, remove: { ...removal, solid } });
                          return null;
                        }
                      : undefined
                  }
                />
              ) : (
                <PartPatternDialog key={target.id} {...props} />
              );
            })()}
          {studioSession && !showWorkspace && part && (
            // The open sketch, closed from here as the reference's sketch dialog is: away from the studio's Done.
            <FeatureDialog
              title={`Sketch · ${part.name}`}
              okLabel="✓ Finish sketch"
              okDisabled={!sketchCanFinish}
              onOk={() => closeSketch(true)}
              onCancel={() => closeSketch(false)}
              autoFocus={false}
              className="cad-sketch-dialog">
              <div className="cad-feature-selection">
                <small>Sketch plane</small>
                <span>{part.drawnOn ? drawnOnName(doc, part.drawnOn.on) : 'Top plane'}</span>
              </div>
              <label>
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
            </FeatureDialog>
          )}
          <div className="cad-canvas-bar">
            {showWorkspace ? (
              <span>
                <strong>PART STUDIO</strong> · {doc.parts.length === 1 ? 'one part' : `${doc.parts.length} parts`}
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
                      requestAnimationFrame(() => svg.current?.focus());
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
          {showWorkspace && (
            <Suspense fallback={<div className="cad-part-view" />}>
              <WorkspaceView
                document={shownDocument}
                selectedId={part?.id ?? null}
                onSelect={id => {
                  if (partCutting) return pickForCut(id);
                  setPartId(id);
                  setSelected([]);
                }}
                highlightIds={partCutting ? cutPicked : undefined}
                hiddenIds={hiddenParts}
                onOpen={id => {
                  if (partCutting) return pickForCut(id);
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
                onSelectPlane={pickPlane}
                picked={selectedPlane ? drawnOnName(doc, { plane: selectedPlane }) : selectedFace ? drawnOnName(doc, selectedFace) : null}
                onSelectFace={on => {
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
                    step={doc.partCuts?.find(step => step.id === partCutting.id)}
                    tool={part?.id}
                    variables={variableScope}
                    pick={cutPick}
                    onPicked={showCutPicked}
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
                      const { clearance, clearanceExpression, split, ...parts } = change;
                      commit(
                        partCutting.id
                          ? updatePartCut(documentRef.current, partCutting.id, change)
                          : addPartCut(
                              documentRef.current,
                              parts.tools,
                              parts.targets,
                              { value: clearance, expression: clearanceExpression },
                              split
                            ).document
                      );
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
                onSketchFace={onEditFaceSketch && sketchOnFace}
              />
            </Suspense>
          )}
          {sketchBackdrop && canvasBox && (
            <Suspense fallback={null}>
              <div className="cad-sketch-backdrop-frame" style={canvasBox}>
                <SketchBackdrop
                  document={sketchBackdrop.document}
                  view={sketchBackdrop.view}
                  hiddenIds={hiddenParts}
                  onEdges={setPartEdges}
                />
              </div>
            </Suspense>
          )}
          <svg
            ref={svg}
            className={`cad-canvas cad-tool-${tool}${sketchBackdrop ? ' cad-canvas-over-parts' : ''}`}
            style={
              showWorkspace || (show3D && partHasOutline)
                ? { display: 'none' }
                : sketchBackdrop && sketchTurn !== straightOn
                  ? { transform: `matrix(${drawingMatrix(sketchTurn).join(', ')}, 0, 0)`, transformOrigin: 'center' }
                  : undefined
            }
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
            <defs>
              <pattern id={`cad-grid-${doc.id}`} width={grid} height={grid} patternUnits="userSpaceOnUse">
                <circle cx="0" cy="0" r={grid * 0.025} fill="#ccd5df" />
              </pattern>
            </defs>
            <rect x={view.x - view.w} y={view.y - view.h} width={view.w * 3} height={view.h * 3} fill={`url(#cad-grid-${doc.id})`} />
            {shownEdges.length > 0 && (
              <g className="cad-part-edges" aria-label="Edges of the parts behind the sketch">
                {shownEdges.map(edge => (
                  <line
                    key={edge.key}
                    data-part-edge={edge.key}
                    className={pickedEdges.includes(edge.key) ? 'cad-part-edge is-picked' : 'cad-part-edge'}
                    x1={edge.x1}
                    y1={-edge.y1}
                    x2={edge.x2}
                    y2={-edge.y2}
                    vectorEffect="non-scaling-stroke"
                  />
                ))}
              </g>
            )}
            <SketchRegion
              document={doc}
              partId={part?.id}
              verified={
                !solving &&
                !splitFirst &&
                !((tool === 'slot' || tool === 'transform' || tool === 'linearPattern' || tool === 'circularPattern') && selected.length) &&
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
              stroke="#db9d9d"
              strokeWidth="1"
              vectorEffect="non-scaling-stroke"
            />
            <line
              x1="0"
              x2="0"
              y1={view.y - view.h}
              y2={view.y + view.h * 2}
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
                interactive={tool === 'select' && !constraintMode && !placingDimension}
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
                  const matrix = svg.current?.getScreenCTM();
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
                  const matrix = svg.current?.getScreenCTM();
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
                interactive={tool === 'select' && !constraintMode && !placingDimension}
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
                position={dimensionDraft.labelPosition ?? cursor}
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
                  setCreationValues({ ...creationValues, index, editing: true, text: String(value.constraint.value), selectAll: true });
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
          {palette && searchMode && (
            <CommandSearch
              commands={[
                ...tools.map(t => ({
                  ...t,
                  description:
                    t.id === 'circumscribedPolygon'
                      ? 'Sketch a regular polygon with its vertices on a circumscribing construction circle.'
                      : t.id === 'inscribedPolygon'
                        ? 'Sketch a regular polygon around an inscribed construction circle.'
                        : t.id === 'centerPointArc'
                          ? 'Sketch an arc by defining its center, start, and end points.'
                          : t.id === 'ellipse'
                            ? 'Sketch an ellipse by defining its center point and two perpendicular axis radii.'
                            : t.id === 'threePointCircle'
                              ? 'Sketch a circle by defining three points along its circumference.'
                              : t.id === 'alignedRectangle'
                                ? 'Sketch a rectangle from an oriented first edge and its perpendicular extent.'
                                : undefined,
                })),
                ...(
                  [
                    'horizontal',
                    'vertical',
                    'coincident',
                    'concentric',
                    'symmetric',
                    'midpoint',
                    'parallel',
                    'perpendicular',
                    'equal',
                    'tangent',
                  ] as const
                ).map(id => ({ id, label: id[0]!.toUpperCase() + id.slice(1), description: constraintPrompt(id) })),
                { id: 'construction', label: 'Construction geometry', key: 'Q' },
                { id: 'fix', label: 'Fix / unfix', key: 'Shift+J' },
                { id: 'fit', label: 'Zoom to fit', key: 'F' },
              ]}
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
            <form
              className="cad-create-size"
              onSubmit={event => {
                event.preventDefault();
                if (pending[1]) addShape(pending[1]);
              }}>
              <label>
                Polygon sides{' '}
                <input
                  ref={polygonInput}
                  aria-label="Polygon sides"
                  type="number"
                  min={3}
                  max={50}
                  step={1}
                  value={polygonSides}
                  onChange={event => {
                    setPolygonSides(event.target.value);
                    if (pending[0])
                      polygonCountGesture.current = {
                        sides: Number(event.target.value),
                        radius: Math.hypot(cursor.x - pending[0].x, cursor.y - pending[0].y),
                      };
                  }}
                  onKeyDown={event => {
                    if (event.key === 'Escape') {
                      event.preventDefault();
                      chooseTool('select');
                    }
                  }}
                />
              </label>
              <button type="submit" disabled={!pending[1]}>
                Create polygon
              </button>
            </form>
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
                  const parsed = parseTransformParameters(next);
                  setTransformParameters(parsed.ok ? repositionTransformPivot(transformParameters, parsed.pivot) : next);
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
            <form
              className="cad-create-size cad-chamfer-editor"
              onSubmit={event => {
                event.preventDefault();
                acceptChamfer();
              }}>
              {chamferDistances.map((value, index) => (
                <label key={index}>
                  Distance {index + 1}{' '}
                  <CadValueInput
                    aria-label={`Chamfer distance ${index + 1}`}
                    inputMode="decimal"
                    value={value}
                    onChange={event =>
                      setChamferDistances(previous => previous.map((text, i) => (i === index ? event.target.value : text)))
                    }
                    onKeyDown={event => {
                      if (event.key === 'Escape') {
                        event.preventDefault();
                        chooseTool('select');
                        setSelected([]);
                      }
                    }}
                  />
                </label>
              ))}
              <button type="submit" disabled={!chamferPreview?.ok}>
                Apply chamfers
              </button>
              <button
                type="button"
                onClick={() => {
                  chooseTool('select');
                  setSelected([]);
                }}>
                Cancel chamfers
              </button>
              {((chamferPreview && !chamferPreview.ok) || (chamferSelection && !chamferSelection.ok)) && (
                <span role="alert" className="cad-error">
                  {(chamferPreview && !chamferPreview.ok ? chamferPreview.message : undefined) ??
                    (chamferSelection && !chamferSelection.ok ? chamferSelection.message : '')}
                </span>
              )}
            </form>
          )}
          {tool === 'fillet' && selected.length > 0 && (
            <form
              className="cad-create-size cad-fillet-editor"
              onSubmit={event => {
                event.preventDefault();
                acceptFillet();
              }}>
              <label>
                Fillet radius{' '}
                <CadValueInput
                  inputRef={filletInput}
                  aria-label="Fillet radius"
                  inputMode="decimal"
                  value={filletRadius}
                  onFocus={() => setFilletEditing(true)}
                  onChange={event => setFilletRadius(event.target.value)}
                  onKeyDown={event => {
                    if (event.key === 'Escape') {
                      event.preventDefault();
                      chooseTool('select');
                      setSelected([]);
                    }
                  }}
                />
              </label>
              <button type="submit" disabled={!filletPreview?.ok}>
                Apply fillets
              </button>
              <button
                type="button"
                onClick={() => {
                  chooseTool('select');
                  setSelected([]);
                }}>
                Cancel fillets
              </button>
              {filletPreview && !filletPreview.ok && (
                <span role="alert" className="cad-error">
                  {filletPreview.message}
                </span>
              )}
            </form>
          )}
          {conicEditing && (
            <form
              className="cad-create-size cad-conic-editor"
              onSubmit={event => {
                event.preventDefault();
                applyConicRho();
              }}>
              <label>
                Rho{' '}
                <input
                  ref={rhoInput}
                  aria-label="Conic rho"
                  inputMode="decimal"
                  value={rho}
                  onChange={event => setRho(event.target.value)}
                  onKeyDown={event => {
                    if (event.key === 'Escape') {
                      event.preventDefault();
                      chooseTool('select');
                    }
                  }}
                />
              </label>
              <span>0 &lt; ρ &lt; 1</span>
              <button type="submit">Apply rho</button>
              <button type="button" onClick={() => chooseTool('select')}>
                Close rho
              </button>
            </form>
          )}
          {currentDimension && numeric(currentDimension) && (
            <form
              className="cad-dimension-editor"
              style={dimensionEditorPosition}
              onSubmit={event => {
                event.preventDefault();
                applyDimensionValue();
              }}>
              <label htmlFor="cad-edit-dimension" className="sr-only">
                {currentDimension.label ?? currentDimension.type} <span>{currentDimension.type === 'angle' ? 'degrees' : 'mm'}</span>
              </label>
              <div>
                <CadValueInput
                  id="cad-edit-dimension"
                  inputRef={dimensionInput}
                  key={currentDimension.id}
                  defaultValue={currentDimension.expression ?? String(currentDimension.value)}
                  inputMode="decimal"
                  unit={currentDimension.type === 'angle' ? 'deg' : 'mm'}
                  unitClassName="cad-dimension-unit"
                  onKeyDown={event => {
                    if (event.key === 'Escape') {
                      event.preventDefault();
                      cancelDimensionEdit();
                    } else if (event.key === 'Enter' && (event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229))
                      event.preventDefault();
                  }}
                />
                <button type="submit" aria-label="Apply dimension">
                  ✓
                </button>
                <button type="button" aria-label="Cancel dimension edit" onClick={cancelDimensionEdit}>
                  ×
                </button>
              </div>
            </form>
          )}
          {pending[0] && (tool === 'rectangle' || tool === 'centerRectangle' || tool === 'circle') && (
            <form
              className="cad-create-size"
              onSubmit={event => {
                event.preventDefault();
                addShape();
              }}>
              <span>
                From {rounded(pending[0].x)}, {rounded(pending[0].y)}
              </span>
              {tool === 'rectangle' || tool === 'centerRectangle' ? (
                <>
                  <label>
                    Width{' '}
                    <CadValueInput
                      aria-label="Rectangle width"
                      value={width}
                      onChange={event => setWidth(event.target.value)}
                      inputMode="decimal"
                    />
                  </label>
                  <label>
                    Height{' '}
                    <CadValueInput
                      aria-label="Rectangle height"
                      value={height}
                      onChange={event => setHeight(event.target.value)}
                      inputMode="decimal"
                    />
                  </label>
                </>
              ) : (
                <label>
                  Radius{' '}
                  <CadValueInput
                    aria-label="Circle radius"
                    value={radius}
                    onChange={event => setRadius(event.target.value)}
                    inputMode="decimal"
                  />
                </label>
              )}
              <button type="submit">Create</button>
            </form>
          )}
          <div className="cad-canvas-footer">
            <span>
              {rounded(cursor.x)}, {rounded(cursor.y)} mm
            </span>
            <span>
              {sketchBackdrop
                ? 'Scroll to zoom · middle-drag to pan · right-drag to turn · N to look straight at it · U uses a picked edge'
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
        <span className="cad-instruction" role="status">
          {acceptanceNotice || (studioSession && showWorkspace) ? '' : message}
        </span>
        <span>{saveStatus ?? 'Draft'}</span>
      </footer>
      {problems.length > 0 && !acceptanceNotice && (
        <div className={`cad-problems${inProgress ? ' cad-sketch-progress' : ''}`} role={inProgress ? undefined : 'alert'}>
          <strong>{inProgress ? 'Sketch in progress' : 'Finish is blocked'}</strong>
          {inProgress ? (
            <p>Keep drawing to close the outline. Your sketch is saved as a draft.</p>
          ) : (
            <ul>
              {problems.map((problem, i) => (
                <li key={i}>{problem}</li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
