import type { Point, Tool, View } from './cadEditorShared';
import type { CircularPatternParameters } from './circularPatternParameters';
import type {
  CadDimension,
  CadDocument,
  CadSketch,
  CadPoint,
  CadLengthUnit,
  CadPart,
  CadValueResult,
  CadVariableKind,
  parseCadValue,
  CadConstraint,
  CadDimensionMode,
  CadFilletResult,
  CadFilletSelection,
  CadLinearPatternExpressions,
} from '@wbcnc/cad';
import type { CadCommandCheckpoint, CadSession } from '@wbcnc/cad-editor/session';
import type { DimensionWorkflow, DimensionWorkflowEvent } from '@wbcnc/cad-editor/dimensionWorkflow';
import type { DrawingGesture } from '@wbcnc/cad-editor/drawingGesture';
import type { CreationValues } from './creationValues';
import type { LinearPatternParameters } from './linearPatternParameters';
import type { TransformParameters, TransformDragKind } from './transformParameters';
import type { SketchContext, SketchContextPress, SketchContextTarget } from '@wbcnc/cad-editor/sketchContext';
import type { CadSnapResult } from '@wbcnc/cad-editor/picking';
import type { CadDrawingInference } from '@wbcnc/cad-editor/drawingInference';
import type { InferredLineAxis } from './lineInference';
import type { CadSelectionBox } from './boxSelection';
import type { AnnotationGesture, BoxGesture, ChainAnchor, DragGesture } from './editorGestures';
import type { CutRegion } from './cutRegions';
import type { SketchTool } from './sketchTools';
import type { ModificationWorkflow } from '@wbcnc/cad-editor/modificationWorkflow';
import type { PartEdge } from './partEdges';
import type { SketchTurn } from './sketchOrbit';
import type { sketchBackdropView } from './sketchBackdropView';
import type { useFaceSketchCamera } from './useFaceSketchCamera';
import type { Dispatch, RefObject, SetStateAction } from 'react';
import type { CadViewport } from '@wbcnc/cad-editor/viewState';
import type { FaceSketchScene } from './faceSketchScene';
import type { ConstraintCommandTool } from '@wbcnc/cad-editor/constraintCommands';

/** The CadEditor state and callbacks that the sketch pointer and tool handlers read. CadEditor builds it fresh on every call. */
export type SketchEditorInput = {
  acceptCircularPattern: () => void;
  acceptLinearPattern: () => void;
  acceptOffset: () => string | null;
  acceptSlot: () => void;
  acceptTransform: () => void;
  addShape: (end?: Point) => void;
  addSnapRelations: (source: CadSketch, hints: (CadDrawingInference | null)[], curvePointIndex?: number | readonly number[]) => CadSketch;
  annotationDrag: RefObject<AnnotationGesture | null>;
  applyDimensionEvent: (event: DimensionWorkflowEvent) => void;
  boxGesture: RefObject<BoxGesture | null>;
  busy: boolean;
  cancelDimensionEdit: () => void;
  centerArcSweep: RefObject<{ last: number; sweep: number } | null>;
  chain: ChainAnchor | null;
  chamferDistances: string[];
  chamferDrag: RefObject<{ side: number; origin: CadPoint; direction: CadPoint; previous: string[] } | null>;
  chamferPreview:
    | { ok: true; sketch: CadSketch; cornerPointIds: string[]; lineIds: string[]; dimensionIds: [string, string] }
    | { ok: false; message: string; cornerPointIds: string[] }
    | null;
  chamferSelection: { ok: true; cornerPointIds: string[] } | { message: string; ok: false; cornerPointIds: string[] } | null;
  changeSketch: (next: CadSketch) => void;
  chooseTool: (next: Tool) => void;
  circularDrag: RefObject<{
    kind: 'center' | 'sweep';
    start: CadPoint;
    parameters: CircularPatternParameters;
    last: number;
    sweep: number;
  } | null>;
  commit: (next: CadDocument) => void;
  conicEditing: string | null;
  constraintMode: ConstraintCommandTool | null;
  construction: boolean;
  contextPress: RefObject<SketchContextPress>;
  contextTarget: (
    target: Element,
    position: Point
  ) => { kind: 'entity' | 'dimension' | 'constraint'; id: string } | { readonly kind: 'blank' };
  contextualArc: boolean;
  currentDimension: CadDimension | CadConstraint | undefined;
  cursor: Point;
  dimensionFlow: DimensionWorkflow;
  dimensionInput: RefObject<HTMLInputElement | null>;
  dimensionMode: CadDimensionMode;
  dimensionSelection: readonly string[];
  doc: CadDocument;
  documentRef: RefObject<CadDocument>;
  drag: RefObject<DragGesture | null>;
  drawingGesture: RefObject<DrawingGesture>;
  drawingGroup: RefObject<SVGGElement | null>;
  editDimension: (id: string) => void;
  editPattern: (id: string) => void;
  faceSketch: { outline: CadPoint[]; floor?: CadPoint[]; label: string; below?: boolean; scene?: FaceSketchScene } | undefined;
  filletPreview: CadFilletResult | null;
  filletRadius: string;
  filletSelection: CadFilletSelection | null;
  fit: (entityIds?: readonly string[]) => void;
  fixGeometry: (targets: string[]) => void;
  fixMode: boolean;
  height: string;
  hoveredReferences: RefObject<string[]>;
  inference: RefObject<'horizontal' | 'vertical' | 'tangent' | null>;
  lastDrawingHint: RefObject<CadDrawingInference | null>;
  lastSnap: RefObject<CadSnapResult | null>;
  lengthText: (value: number) => string;
  lengthUnit: CadLengthUnit;
  lineContinuation: boolean;
  markerScale: number;
  modification: ModificationWorkflow;
  mounted: RefObject<boolean>;
  newCurveCommand: RefObject<{ id: string; checkpoint: CadCommandCheckpoint } | null>;
  newDimensionCommand: RefObject<{ id: string; checkpoint: CadCommandCheckpoint } | null>;
  offsetInput: RefObject<HTMLInputElement | null>;
  offsetPreview:
    | { ok: true; sketch: CadSketch; sourceIds: string[]; entityIds: string[]; dimensionId: string }
    | { ok: false; message: string }
    | null;
  openContext: (target: SketchContextTarget, position: Point) => void;
  pan: RefObject<{ x: number; y: number; view: View; turn?: SketchTurn } | null>;
  parseCadValue: (text: string, options?: Parameters<typeof parseCadValue>[1]) => CadValueResult;
  parsedCircular:
    | { ok: true; count: number; angle: number; closed: boolean; center: { x: number; y: number }; message?: undefined }
    | { ok: false; message: string; count?: undefined; angle?: undefined; closed?: undefined; center?: undefined };
  parsedLinear:
    | {
        expressions?: CadLinearPatternExpressions | undefined;
        ok: true;
        countX: number;
        countY: number;
        stepX: { x: number; y: number };
        stepY: { x: number; y: number };
        message?: undefined;
      }
    | { ok: false; message: string };
  part: CadPart;
  partEdges: PartEdge[];
  patternCommandId: RefObject<string>;
  patternDrag: RefObject<{ index: number; anchor: CadPoint; parameters: LinearPatternParameters } | null>;
  patternEditId: string | null;
  pending: Point[];
  pendingSnaps: RefObject<(CadDrawingInference | null)[]>;
  pickedEdges: string[];
  placeDimension: (placed: CadDimension) => Promise<void>;
  placingDimension: boolean;
  pointAt: (event: { clientX: number; clientY: number; shiftKey?: boolean }) => Point;
  polygonCountGesture: RefObject<{ sides: number; radius: number } | null>;
  polygonSides: string;
  polygonTool: boolean;
  preparingDimension: RefObject<boolean>;
  projectPoint: (point: Point) => { x: number; y: number };
  publish: (next: CadDocument) => void;
  radius: string;
  rejectValue: (reason: string, input?: HTMLInputElement | null) => string;
  removeSelected: (entityIds?: readonly string[], constraintIds?: readonly string[]) => void;
  requestSketchCheck: () => void;
  restoreCanvasKeyboard: () => void;
  rho: string;
  rhoInput: RefObject<HTMLInputElement | null>;
  selectDimension: (id: string, additive?: boolean) => void;
  selected: string[];
  selectionHints: RefObject<Record<string, Point>>;
  session: CadSession;
  setBusy: Dispatch<SetStateAction<boolean>>;
  setChain: Dispatch<SetStateAction<ChainAnchor | null>>;
  setChamferDistances: Dispatch<SetStateAction<string[]>>;
  setCircularParameters: Dispatch<SetStateAction<CircularPatternParameters>>;
  setConicEditing: Dispatch<SetStateAction<string | null>>;
  setConstraintMode: Dispatch<SetStateAction<ConstraintCommandTool | null>>;
  setContextMenu: Dispatch<SetStateAction<SketchContext | null>>;
  setContextualArc: Dispatch<SetStateAction<boolean>>;
  setCreationValues: Dispatch<SetStateAction<CreationValues | null>>;
  setCursor: Dispatch<SetStateAction<Point>>;
  setDimension: Dispatch<SetStateAction<string | null>>;
  setDimensionFlow: Dispatch<SetStateAction<DimensionWorkflow>>;
  setDocument: Dispatch<SetStateAction<CadDocument>>;
  setDrawingCue: Dispatch<SetStateAction<CadDrawingInference | null>>;
  setFilletEditing: Dispatch<SetStateAction<boolean>>;
  setFixMode: Dispatch<SetStateAction<boolean>>;
  setHoveredConstraintEntities: Dispatch<SetStateAction<string[]>>;
  setHoveredModifyCurve: Dispatch<SetStateAction<string | null>>;
  setHoveredPoint: Dispatch<SetStateAction<string | null>>;
  setLineContinuation: Dispatch<SetStateAction<boolean>>;
  setLinearParameters: Dispatch<SetStateAction<LinearPatternParameters>>;
  setMessage: Dispatch<SetStateAction<string>>;
  setModification: Dispatch<SetStateAction<ModificationWorkflow>>;
  setModifyTarget: Dispatch<SetStateAction<Point | null>>;
  setPalette: Dispatch<SetStateAction<boolean>>;
  setPatternEditId: Dispatch<SetStateAction<string | null>>;
  setPatternNotice: Dispatch<SetStateAction<string>>;
  setPending: Dispatch<SetStateAction<Point[]>>;
  setPickedEdges: Dispatch<SetStateAction<string[]>>;
  setPolygonSides: Dispatch<SetStateAction<string>>;
  setRegionField: Dispatch<SetStateAction<{ entry: CutRegion; anchor: Point } | null>>;
  setRho: Dispatch<SetStateAction<string>>;
  setSelected: Dispatch<SetStateAction<string[]>>;
  setSelectedConstraints: Dispatch<SetStateAction<string[]>>;
  setSelectionBox: Dispatch<SetStateAction<CadSelectionBox | null>>;
  setSharedSlotWidth: Dispatch<SetStateAction<string | undefined>>;
  setSketchTurn: Dispatch<SetStateAction<SketchTurn>>;
  setSlotChain: Dispatch<SetStateAction<boolean>>;
  setSlotWidth: Dispatch<SetStateAction<string>>;
  setSnapCue: Dispatch<SetStateAction<{ point: Point; label: string } | null>>;
  setSplitFirst: Dispatch<SetStateAction<{ entityId: string; parameter: number; point: CadPoint } | null>>;
  setSplitNotice: Dispatch<SetStateAction<string>>;
  setTool: Dispatch<SetStateAction<SketchTool>>;
  setTransformNotice: Dispatch<SetStateAction<string>>;
  setTransformParameters: Dispatch<SetStateAction<TransformParameters>>;
  setUsingEdges: Dispatch<SetStateAction<boolean>>;
  setView: Dispatch<SetStateAction<CadViewport>>;
  shownSketch: CadSketch;
  sketch: CadSketch;
  sketchBackdrop: ReturnType<typeof useFaceSketchCamera> | ReturnType<typeof sketchBackdropView>;
  sketchTurn: SketchTurn;
  slotDrag: RefObject<{ center: CadPoint; width: string } | null>;
  snap: boolean;
  solveDrag: (moving: DragGesture) => Promise<void>;
  solving: boolean;
  splitFirst: { entityId: string; parameter: number; point: CadPoint } | null;
  svg: RefObject<SVGSVGElement | null>;
  takeEdges: (keys?: string[]) => void;
  tangentAxis: RefObject<InferredLineAxis | null>;
  tool: SketchTool;
  transformDrag: RefObject<{ kind: TransformDragKind; start: CadPoint; parameters: TransformParameters } | null>;
  transformSelectionCenter: (ids: readonly string[]) => { x: number; y: number };
  usingEdges: boolean;
  variableScope: Readonly<Record<string, { value: number; kind: CadVariableKind }>>;
  view: CadViewport;
  width: string;
};
