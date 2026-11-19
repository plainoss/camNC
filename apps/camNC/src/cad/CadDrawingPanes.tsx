import { Suspense, lazy, type Dispatch, type ReactNode, type SetStateAction } from 'react';
import type { CadDocument, CadDrawnOn } from '@wbcnc/cad';
import type { ViewRequest } from '@/cam/model/ModelViewport';
import type { SketchEditorInput } from './sketchEditorInput';
import type { StudioNavigationInput } from './studioNavigation';
import type { StudioDialog } from './studioDialog';
import type { CadConnectorPick } from './PartFeatureDialogs';
import type { PartEdge } from './partEdges';
import type { usePointPicker } from './pointPicker';
import type { useExtrudeDepth } from './useExtrudeDepth';
import type { useEditorCameras } from './studioCamera';
import { drawnOnName, nextSketchLabel } from './drawnOnName';
import { focusSketchCanvas } from './sketchViewport';
import { hasOutline } from './editorHelpers';
import { SketchPlaneDialog } from './StudioSketchDialog';
import { basePlaneViews, pickedPlane } from './basePlanes';
import { withRegionDepth } from './cutRegions';
import { assemblyCameraFromPart } from './faceSketchScene';

// The views of CadEditor's drawing pane, split out of it: the canvas bar over the drawing, the studio's view of every
// part, one part in 3D, and the parts shown behind an open sketch. Each reads the editor's values by their names there.

const FaceSketchBackdrop = lazy(() => import('./FaceSketchBackdrop'));
const PartView3D = lazy(() => import('./PartView3D'));
const WorkspaceView = lazy(() => import('./WorkspaceView'));
const SketchBackdrop = lazy(() => import('./SketchBackdrop'));

type CanvasBarProps = Pick<
  StudioNavigationInput,
  'showWorkspace' | 'studioSession' | 'part' | 'svg' | 'setShow3D' | 'setShowWorkspace' | 'chooseTool'
> &
  Pick<SketchEditorInput, 'doc' | 'faceSketch' | 'fit' | 'snap' | 'setDrawingCue' | 'setSnapCue' | 'hoveredReferences'> & {
    physicalPartCount: number;
    show3D: boolean;
    partHasOutline: boolean;
    setSnap: Dispatch<SetStateAction<boolean>>;
  };

/** The bar over the drawing: what's open, and the switches between the drawing and its 3D views, Fit and Snap. */
export function CadCanvasBar({
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
}: CanvasBarProps) {
  return (
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
  );
}

type WorkspacePaneProps = Pick<
  StudioNavigationInput,
  | 'studioCamera'
  | 'busy'
  | 'choosingFace'
  | 'directionPicker'
  | 'studioSession'
  | 'cutSelection'
  | 'part'
  | 'setSketchRowPicked'
  | 'setSelected'
  | 'setPartId'
  | 'setShowWorkspace'
  | 'setShow3D'
  | 'documentRef'
  | 'setChoosingFace'
  | 'openDialog'
  | 'selectedPlane'
  | 'selectedFace'
  | 'userRollback'
  | 'profiles'
  | 'setDirectionPicker'
  | 'setSelectedFace'
  | 'setSelectedPlane'
> & {
  extrusionDepth: ReturnType<typeof useExtrudeDepth>;
  shownDocument: CadDocument;
  stepDialogOpen: boolean;
  pointPicker: ReturnType<typeof usePointPicker>;
  focusViewIfIdle: () => void;
  doc: CadDocument;
  viewRequest: ViewRequest | undefined;
  setViewRequest: Dispatch<SetStateAction<ViewRequest | undefined>>;
  transparentParts: ReadonlySet<string>;
  partPicking: boolean;
  dialog: StudioDialog | null;
  hiddenParts: ReadonlySet<string>;
  featureShown: (id: string) => boolean;
  onHoverPart: (id: string | null) => void;
  openSketch: (stepPartId: string) => void;
  newPartOn: (on: CadDrawnOn['on'], datum?: string) => void;
  pickPlane: (plane: string) => void;
  hoveredStepParts: string[] | null;
  mateConnectors: { from?: CadConnectorPick; to?: CadConnectorPick };
  stepDialog: ReactNode;
};

/** The studio's view of every part where it sits, with what's picked in it going back to the editor. */
export function CadWorkspacePane({
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
}: WorkspacePaneProps) {
  return (
    <Suspense fallback={<div className="cad-part-view" />}>
      <WorkspaceView
        cameraState={studioCamera}
        extrusionDepth={extrusionDepth.control(shownDocument)}
        measurementEnabled={!busy && !stepDialogOpen && !choosingFace && !directionPicker && !pointPicker.onPick}
        onReady={focusViewIfIdle}
        document={shownDocument}
        profileDocument={doc}
        viewRequest={viewRequest}
        onViewRequest={studioSession ? request => setViewRequest(previous => ({ ...request, seq: (previous?.seq ?? 0) + 1 })) : undefined}
        transparentIds={transparentParts}
        selectedId={cutSelection.selectedTool ? part!.id : null}
        selectedCopyId={cutSelection.selectedCopyId}
        onSelect={(id, copyId) => {
          setSketchRowPicked(null);
          if (partPicking) return cutSelection.pickForCut(id, copyId);
          cutSelection.selectPart(id, copyId);
          setSelected([]);
        }}
        highlightIds={dialog?.kind === 'partCut' ? cutSelection.cutPicked : cutSelection.selectedReferences}
        hiddenIds={hiddenParts}
        featureShown={featureShown}
        onHover={onHoverPart}
        onOpen={(id, copyId) => {
          if (partPicking) return cutSelection.pickForCut(id, copyId);
          if (studioSession) return openSketch(id);
          setPartId(id);
          setSelected([]);
          setShowWorkspace(false);
          setShow3D(hasOutline(documentRef.current, id));
        }}
        {...(studioSession
          ? { choosing: choosingFace, onChoosingChange: setChoosingFace }
          : { onCutParts: () => openDialog({ kind: 'partCut' }) })}
        onNewPart={newPartOn}
        selectedPlane={selectedPlane}
        {...{ selectedFace, pickingMirrorPlane: dialog?.kind === 'mirror' && !!directionPicker }}
        onSelectPlane={pickPlane}
        hoverIds={hoveredStepParts ?? undefined}
        picked={selectedPlane ? (pickedPlane(doc, selectedPlane)?.name ?? null) : selectedFace ? drawnOnName(doc, selectedFace) : null}
        regions={directionPicker ? [] : profiles.regions}
        onPickRegion={profiles.pickRegion}
        onPickSketch={
          studioSession && !directionPicker && !choosingFace && !pointPicker.onPick && dialog?.kind !== 'partCut'
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
        connectors={dialog?.kind === 'transform' ? mateConnectors : undefined}
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
          <SketchPlaneDialog title={nextSketchLabel(doc, userRollback)} onCancel={() => setChoosingFace(false)} />
        )}
        {/* Cut parts sits in the view's own box, below the canvas bar. */}
        {dialog?.kind === 'partCut' && stepDialog}
      </WorkspaceView>
    </Suspense>
  );
}

type PartPaneProps = Pick<
  StudioNavigationInput,
  'variableScope' | 'commit' | 'documentRef' | 'onEditFaceSketch' | 'faceEditor' | 'studioSession' | 'studioCamera'
> & {
  part: NonNullable<StudioNavigationInput['part']>;
  doc: CadDocument;
  partCameraState: ReturnType<typeof useEditorCameras>['partCameraState'];
  newPartOn: (on: CadDrawnOn['on'], datum?: string) => void;
};

/** One part in 3D, to set the depths of its cuts and start sketches on its faces. */
export function CadPartPane({
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
}: PartPaneProps) {
  return (
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
  );
}

type SketchBackdropPaneProps = Pick<SketchEditorInput, 'faceSketch'> & {
  sketchBackdrop: NonNullable<SketchEditorInput['sketchBackdrop']>;
  canvasBox: NonNullable<StudioNavigationInput['canvasBox']>;
  doc: CadDocument;
  featureShown: (id: string) => boolean;
  hiddenParts: ReadonlySet<string>;
  setPartEdges: Dispatch<SetStateAction<PartEdge[]>>;
};

/** The parts, planes or face scene shown behind an open sketch, lined up with its drawing. */
export function CadSketchBackdropPane({
  sketchBackdrop,
  canvasBox,
  faceSketch,
  doc,
  featureShown,
  hiddenParts,
  setPartEdges,
}: SketchBackdropPaneProps) {
  return (
    <Suspense fallback={null}>
      <div className="cad-sketch-backdrop-frame" style={canvasBox}>
        {faceSketch?.scene ? (
          <FaceSketchBackdrop scene={faceSketch.scene} view={sketchBackdrop.view} />
        ) : (
          <SketchBackdrop
            document={sketchBackdrop.document}
            view={sketchBackdrop.view}
            planes={basePlaneViews(doc).filter(plane => featureShown(plane.id))}
            hiddenIds={hiddenParts}
            onEdges={setPartEdges}
          />
        )}
      </div>
    </Suspense>
  );
}
