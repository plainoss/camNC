import {
  cadFaceFrame,
  designSteps,
  handOverEmptyExtrude,
  removeCadFeature,
  removeCadVariable,
  removeDatumPlane,
  removeEdgeFillet,
  removePartCut,
  setCutSuppressed,
  setPartPattern,
  splitApartRegions,
  withFeatureVersion,
  type CadDocument,
  type CadDrawnOn,
  type CadPart,
  type DesignStep,
} from '@wbcnc/cad';
import { markCadSession, restoreCadSession, type CadHistoryMark, type CadSession } from '@wbcnc/cad-editor/session';
import type { Dispatch, RefObject, SetStateAction } from 'react';
import type { ApartPartIds } from './apartExtrudePreview';
import type { Tool, View } from './cadEditorShared';
import type { CadEditorProps } from './CadEditor.types';
import { drawnOnName } from './drawnOnName';
import { featureLeadId, hasOutline, ownsItsSketch, replacePart, withoutExtrude, withoutPartsMadeWith } from './editorHelpers';
import type { faceSketchHost } from './faceSketchHost';
import type { FeatureAction, FeatureEntry } from './FeatureList';
import { startHole } from './holeSource';
import { newSketchPart } from './newSketchPart';
import type { PatternOpening } from './partPatternKind';
import { pickedPlane, planeOffsetFrom } from './basePlanes';
import { straightOn, type SketchTurn } from './sketchOrbit';
import { focusSketchCanvas } from './sketchViewport';
import { captureSketchCamera, carriedSketchCamera, type StudioCameraRef } from './studioCamera';
import type { StudioFeatureDialog, StudioDialog } from './studioDialog';
import { startExtrude } from './studioExtrude';
import type { StudioCommand } from './StudioToolbar';
import { toggleSuppressed } from './toggleSuppressed';
import type { usePartCutSelection } from './usePartCutSelection';
import type { useProfileSelection } from './useProfileSelection';
import type { useEditorVariableFields } from './useEditorVariableFields';

type FaceOn = Extract<CadDrawnOn['on'], { partId: string }>;

/** The CadEditor state and callbacks that the Part Studio's navigation reads. CadEditor builds it fresh on every call. */
export type StudioNavigationInput = {
  apartIds: ApartPartIds;
  applyPendingValues: () => string | null;
  busy: boolean;
  canvasBox: { left: number; top: number; width: number; height: number } | null;
  chooseTool: (next: Tool) => void;
  choosingFace: boolean;
  closeDialog: () => void;
  commit: (next: CadDocument) => void;
  cutSelection: ReturnType<typeof usePartCutSelection>;
  directionPicker: ((on: CadDrawnOn['on'], datum?: string) => void) | null;
  documentRef: RefObject<CadDocument>;
  faceEditor: ReturnType<typeof faceSketchHost>;
  feature: StudioFeatureDialog | null;
  onEditFaceSketch: CadEditorProps['onEditFaceSketch'];
  openDialog: (next: StudioDialog) => void;
  part: CadPart | undefined;
  profiles: ReturnType<typeof useProfileSelection>;
  publish: (next: CadDocument) => void;
  rolledTo: string | null;
  root: RefObject<HTMLDivElement | null>;
  selectedFace: FaceOn | null;
  selectedPlane: string | null;
  session: CadSession;
  setCancelledSketch: Dispatch<SetStateAction<{ document: CadDocument; partId: string; before: CadHistoryMark } | null>>;
  setChoosingFace: Dispatch<SetStateAction<boolean>>;
  setDirectionPicker: Dispatch<SetStateAction<((on: CadDrawnOn['on'], datum?: string) => void) | null>>;
  setMessage: Dispatch<SetStateAction<string>>;
  setPartId: Dispatch<SetStateAction<string>>;
  setRolledTo: Dispatch<SetStateAction<string | null>>;
  setSelected: Dispatch<SetStateAction<string[]>>;
  setSelectedFace: Dispatch<SetStateAction<FaceOn | null>>;
  setSelectedPlane: Dispatch<SetStateAction<string | null>>;
  setShow3D: Dispatch<SetStateAction<boolean>>;
  setShowWorkspace: Dispatch<SetStateAction<boolean>>;
  setSketchCameraShift: Dispatch<SetStateAction<[number, number]>>;
  setSketchRowPicked: Dispatch<SetStateAction<string | null>>;
  setSketchTurn: Dispatch<SetStateAction<SketchTurn>>;
  setStudioRefusal: Dispatch<SetStateAction<string | null>>;
  setView: Dispatch<SetStateAction<View>>;
  showWorkspace: boolean;
  sketchBefore: RefObject<CadHistoryMark | null>;
  sketchCameraShift: [number, number];
  sketchRowPicked: string | null;
  sketchTurn: SketchTurn;
  studioCamera: StudioCameraRef;
  studioSession: boolean;
  svg: RefObject<SVGSVGElement | null>;
  userRollback: string | null;
  variableScope: ReturnType<typeof useEditorVariableFields>;
  view: View;
  viewWantsKeyboard: RefObject<boolean>;
};

// The Part Studio's navigation between its features, sketches and dialogs, split out of CadEditor. It reads the
// editor through StudioNavigationInput.

export function openStudioFeature(
  editor: StudioNavigationInput,
  kind: 'extrude' | 'pattern' | 'hole',
  partId: string,
  before = markCadSession(editor.session),
  initialPatternKind?: PatternOpening
) {
  const { chooseTool, cutSelection, documentRef, openDialog, setSelected, setSelectedFace, setShowWorkspace } = editor;
  partId = featureLeadId(documentRef.current, kind, partId);
  setSelectedFace(null);
  cutSelection.selectPart(partId);
  setSelected([]);
  chooseTool('select');
  setShowWorkspace(true);
  openDialog({ kind, partId, before, initialPatternKind });
}

/** OK or Cancel of an Extrude, Hole or Pattern dialog. */
export function closeStudioFeature(editor: StudioNavigationInput, keep: boolean) {
  const { apartIds, closeDialog, commit, documentRef, feature, publish, session, setPartId } = editor;
  // Pattern candidates use the viewport preview transaction, so cancel has no source or history edit to undo.
  // Cancel puts history back too: a new entry would leave the cancelled edit for Undo to bring back.
  if (!keep && feature && feature.kind !== 'pattern') publish(restoreCadSession(session, feature.before));
  // Regions picked apart are a part each.
  if (keep && feature?.kind === 'extrude') {
    const split = handOverEmptyExtrude(splitApartRegions(documentRef.current, feature.partId, apartIds), feature.partId);
    if (split !== documentRef.current) commit(split);
  }
  // A Remove is a cut in the board its sketch is drawn on, so that board is the one selected.
  const step = keep && feature && documentRef.current.parts.find(p => p.id === feature.partId);
  const on = step && step.remove && step.drawnOn?.on;
  if (on && !('plane' in on)) setPartId(on.partId);
  // An Add is part of the part it adds to.
  else if (step && step.addTo) setPartId(step.addTo);
  closeDialog();
}

/** Opens a part's sketch from the studio, remembering the design to go back to if it's cancelled. */
export function openStudioSketch(editor: StudioNavigationInput, stepPartId: string, before = markCadSession(editor.session)) {
  const {
    closeDialog,
    cutSelection,
    documentRef,
    root,
    setCancelledSketch,
    setChoosingFace,
    setSelected,
    setSelectedFace,
    setShow3D,
    setShowWorkspace,
    setSketchCameraShift,
    setSketchTurn,
    setView,
    sketchBefore,
    studioCamera,
    svg,
  } = editor;
  setSelectedFace(null);
  setCancelledSketch(null);
  // A shared sketch is edited where it's drawn, and every extrude of it follows.
  const partId = documentRef.current.parts.find(candidate => candidate.id === stepPartId)?.sketchOf ?? stepPartId;
  const opening = documentRef.current.parts.find(candidate => candidate.id === partId);
  if (opening?.faceProfile) return openStudioFeature(editor, 'extrude', partId);
  const carried = carriedSketchCamera(documentRef.current, opening, studioCamera.current, root.current);
  setSketchTurn(carried?.turn ?? straightOn);
  setSketchCameraShift(carried?.shift ?? [0, 0]);
  if (carried) setView(carried.view);
  sketchBefore.current = before;
  // An Extrude dialog the sketch was opened from is dropped, not cancelled: its extrude stays.
  closeDialog();
  setChoosingFace(false);
  cutSelection.selectPart(partId);
  setSelected([]);
  setShowWorkspace(false);
  setShow3D(false);
  requestAnimationFrame(() => focusSketchCanvas(svg.current));
}

/** Back to the studio from a sketch: keeping it, or leaving the design as it was before it opened. */
export function closeStudioSketch(editor: StudioNavigationInput, keep: boolean) {
  const {
    applyPendingValues,
    canvasBox,
    chooseTool,
    documentRef,
    part,
    publish,
    root,
    session,
    setCancelledSketch,
    setMessage,
    setSelected,
    setShow3D,
    setShowWorkspace,
    setSketchRowPicked,
    sketchBefore,
    sketchCameraShift,
    sketchTurn,
    studioCamera,
    studioSession,
    svg,
    view,
    viewWantsKeyboard,
  } = editor;
  if (keep) {
    const error = applyPendingValues();
    if (error) return setMessage(error);
  }
  captureSketchCamera(documentRef.current, part, studioCamera, view, sketchTurn, sketchCameraShift, canvasBox);
  if (!keep && sketchBefore.current) {
    const cancelled = { document: structuredClone(documentRef.current), partId: part!.id, before: sketchBefore.current };
    publish(restoreCadSession(session, sketchBefore.current));
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
}

/** Opens what a step of the design made: its sketch, its dialog, or its part in 3D. */
export function openDesignStep(editor: StudioNavigationInput, step: DesignStep) {
  const {
    chooseTool,
    documentRef,
    faceEditor,
    onEditFaceSketch,
    openDialog,
    session,
    setPartId,
    setSelected,
    setShow3D,
    setShowWorkspace,
    sketchBefore,
    studioSession,
  } = editor;
  // In the studio a step opens its dialog, and a sketch opens to be drawn on, as the reference does.
  if (studioSession && step.kind === 'sketch') return openStudioSketch(editor, step.partId);
  if (studioSession && step.kind === 'extrude')
    return openStudioFeature(editor, documentRef.current.parts.find(p => p.id === step.partId)?.hole ? 'hole' : 'extrude', step.partId);
  if (studioSession && step.kind === 'move') return openStudioTransform(editor, step.partId, undefined, true);
  if (studioSession && step.kind === 'fillet') return openDialog({ kind: 'fillet', partId: step.partId, filletId: step.id });
  if (studioSession && step.kind === 'copy') {
    const copy = documentRef.current.parts.find(candidate => candidate.id === step.partId)?.copies?.find(c => c.id === step.copyId);
    if (copy?.offset) return openStudioTransform(editor, step.partId, copy.id);
    if (copy?.mirror) return openDialog({ kind: 'mirror', partId: step.partId, copyId: copy.id });
  }
  if (studioSession && (step.kind === 'pattern' || step.kind === 'copy')) return openStudioFeature(editor, 'pattern', step.partId);
  // A cut opens its part's sketch view from the studio: cancelling there goes back to the design as it is now.
  if (studioSession && step.kind === 'cut') sketchBefore.current = markCadSession(session);
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
    openDialog({ kind: 'partCut', id: step.partCutId });
  } else if (step.kind === 'cut' || step.kind === 'extrude') {
    setShowWorkspace(false);
    setShow3D(hasOutline(documentRef.current, step.partId));
  } else if (step.kind === 'faceSketch' && onEditFaceSketch && step.sketchId) {
    faceEditor.edit(step.partId, step.sketchId, true);
  }
}

/** A row of the studio's feature list: edited, deleted, suppressed, or its sketch opened. */
export function studioFeatureAction(editor: StudioNavigationInput, entry: FeatureEntry, action: FeatureAction) {
  const {
    closeDialog,
    commit,
    documentRef,
    feature,
    openDialog,
    selectedPlane,
    setPartId,
    setRolledTo,
    setSelectedPlane,
    setStudioRefusal,
    showWorkspace,
    sketchBefore,
    studioSession,
  } = editor;
  const current = documentRef.current;
  setStudioRefusal(null);
  if (entry.kind === 'plane') {
    if (action === 'newSketch') return newStudioSketchOn(editor, entry.id);
    if (action === 'edit') {
      if (!showWorkspace) {
        closeStudioSketch(editor, true);
        if (sketchBefore.current) return;
      }
      return openDialog({ kind: 'plane', id: entry.id });
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
        closeStudioSketch(editor, true);
        if (sketchBefore.current) return;
      }
      return openDialog({ kind: 'variable', id: entry.id });
    }
    if (action === 'delete') {
      const result = removeCadVariable(current, entry.id);
      if ('error' in result) return setStudioRefusal(result.error);
      return commit(result.document);
    }
    return;
  }
  const { step } = entry;
  if (action === 'edit') return openDesignStep(editor, step);
  if (action === 'editSketch') return openStudioSketch(editor, step.partId);
  if (action === 'suppress' && step.kind === 'cut' && step.cutId) {
    const cut = current.parts.find(candidate => candidate.id === step.partId)?.features?.find(feature => feature.id === step.cutId);
    return commit(setCutSuppressed(current, step.partId, step.cutId, !(cut?.type === 'cut' && cut.suppressed)));
  }
  if (action === 'suppress') return commit(toggleSuppressed(current, step));
  if (action === 'rollTo') return setRolledTo(designSteps(current).at(-1)?.id === step.id ? null : step.id);
  if (action === 'rollToEnd') return setRolledTo(null);
  if (action !== 'delete') return;
  if (feature) closeDialog();
  if (step.kind === 'fillet') return commit(removeEdgeFillet(current, step.partId, step.id));
  if (step.kind === 'move') return commit(replacePart(current, step.partId, ({ moved: _moved, ...p }) => p));
  // In the studio a sketch stands on its own, as in the reference: deleting its Extrude leaves the sketch.
  if (step.kind === 'extrude' && studioSession && ownsItsSketch(current, step.partId))
    commit(replacePart(withoutPartsMadeWith(current, step.partId), step.partId, withoutExtrude));
  else if (step.kind === 'sketch' || step.kind === 'extrude') {
    // A part is its sketch pushed out, so deleting either deletes the part, and the parts its extrude made with it.
    const parts = withoutPartsMadeWith(current, step.partId).parts.filter(candidate => candidate.id !== step.partId);
    commit(withFeatureVersion({ ...current, parts }));
    setPartId(parts[0]?.id ?? '');
  } else if (step.kind === 'pattern') commit(setPartPattern(current, step.partId, null));
  else if (step.kind === 'partCut' && step.partCutId) commit(removePartCut(current, step.partCutId));
  else if (step.kind === 'cut' && step.cutId) commit(removeCadFeature(current, step.partId, step.cutId));
}

export function openStudioTransform(editor: StudioNavigationInput, partId: string, copyId?: string, move?: boolean) {
  const { openDialog, setPartId, setShowWorkspace } = editor;
  setPartId(partId);
  setShowWorkspace(true);
  openDialog({ kind: 'transform', partId, ...(copyId && { copyId }), ...(move && { move }) });
}

/** Starts a new part drawn on a base plane or a part's face, or on one of the design's planes, and opens its sketch. */
export function newStudioPartOn(editor: StudioNavigationInput, on: CadDrawnOn['on'], datum?: string) {
  const {
    commit,
    documentRef,
    part,
    rolledTo,
    session,
    setMessage,
    setPartId,
    setRolledTo,
    setSelected,
    setShow3D,
    setShowWorkspace,
    studioSession,
    svg,
    variableScope,
  } = editor;
  const before = markCadSession(session);
  const made = newSketchPart(before.document, on, {
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
  if (studioSession) return openStudioSketch(editor, drawn.id, before);
  setPartId(drawn.id);
  setSelected([]);
  setShowWorkspace(false);
  setShow3D(false);
  requestAnimationFrame(() => focusSketchCanvas(svg.current));
}

/**
 * A plane clicked in the view or the feature list: drawn on while choosing, otherwise picked for the next sketch. One
 * of the design's planes gives what it's offset from as a direction, as its normal is the same.
 */
/** New sketch from a plane's menu: a new sketch on that plane, straight away. */
export function newStudioSketchOn(editor: StudioNavigationInput, plane: string) {
  const { busy, documentRef, setChoosingFace, setSelectedPlane } = editor;
  const picked = pickedPlane(documentRef.current, plane);
  if (!picked || busy) return;
  setChoosingFace(false);
  setSelectedPlane(null);
  newStudioPartOn(editor, picked.on, picked.datum);
}

export function pickStudioPlane(editor: StudioNavigationInput, plane: string) {
  const { choosingFace, directionPicker, documentRef, setChoosingFace, setDirectionPicker, setSelectedFace, setSelectedPlane } = editor;
  const picked = pickedPlane(documentRef.current, plane);
  if (!picked) return;
  if (directionPicker) {
    directionPicker(picked.on, picked.datum);
    return setDirectionPicker(null);
  }
  if (choosingFace) {
    setChoosingFace(false);
    setSelectedPlane(null);
    return newStudioPartOn(editor, picked.on, picked.datum);
  }
  setSelectedFace(null);
  setSelectedPlane(picked => (picked === plane ? null : plane));
}

export function runStudioCommand(editor: StudioNavigationInput, command: StudioCommand, initialPatternKind?: PatternOpening) {
  const {
    choosingFace,
    closeDialog,
    commit,
    cutSelection,
    documentRef,
    feature,
    openDialog,
    part,
    profiles,
    selectedFace,
    selectedPlane,
    session,
    setChoosingFace,
    setSelectedFace,
    setSelectedPlane,
    setStudioRefusal,
    sketchRowPicked,
    userRollback,
  } = editor;
  const openFeature = (kind: 'extrude' | 'pattern' | 'hole', partId: string, before?: CadHistoryMark, patternKind?: PatternOpening) =>
    openStudioFeature(editor, kind, partId, before, patternKind);
  // The Linear pattern command opens its own dialog, with nothing picked yet, whatever is selected.
  if (command === 'linearPattern') {
    const on = part ?? documentRef.current.parts.find(candidate => candidate.extrude !== false) ?? documentRef.current.parts[0];
    return on && openFeature('pattern', on.id, undefined, 'linearPattern');
  }
  setStudioRefusal(null);
  if (command === 'sketch') {
    closeDialog();
    // A plane or face picked first is drawn on straight away, as the reference sketches on what's selected.
    // A face picked on a part that has since gone, as when it was deleted, is no longer there to draw on.
    const face = selectedFace && cadFaceFrame(documentRef.current, selectedFace);
    const plane = selectedPlane && pickedPlane(documentRef.current, selectedPlane);
    const picked = !choosingFace && (plane ? plane.on : face && !('error' in face) ? selectedFace : null);
    if (picked) {
      setSelectedPlane(null);
      setSelectedFace(null);
      return newStudioPartOn(editor, picked, plane ? plane.datum : undefined);
    }
    setChoosingFace(!choosingFace);
  } else if (command === 'transform') {
    if (part)
      cutSelection.transformPart(
        (partId: string, copyId?: string, move?: boolean) => openStudioTransform(editor, partId, copyId, move),
        setStudioRefusal
      );
  } else if (command === 'variable') openDialog({ kind: 'variable' });
  else if (command === 'hole') {
    const at = { partId: part?.id, copyId: cutSelection.pickedCopyId, cancel: () => feature && closeStudioFeature(editor, false) };
    const read = () => documentRef.current,
      mark = () => markCadSession(session);
    startHole({ ...at, rolledTo: userRollback, read, mark, commit, open: openFeature, refuse: setStudioRefusal });
  } else if (command === 'fillet') openDialog({ kind: 'fillet' });
  else if (command === 'mirror') {
    if (part) openDialog({ kind: 'mirror', partId: part.id });
  } else if (command === 'plane') {
    const preselected = planeOffsetFrom(documentRef.current, selectedPlane, selectedFace);
    openDialog({ kind: 'plane', ...(preselected && { preselected }) });
  } else if (command === 'cutParts' || command === 'boolean')
    openDialog({ kind: 'partCut', ...(command === 'boolean' && { boolean: true as const }) });
  else if (command === 'extrude' && (selectedFace || part)) {
    const mark = markCadSession(session);
    const from = selectedFace ? { face: selectedFace } : { part: part! };
    // From its row, a sketch starts with all of it; otherwise with nothing picked.
    const started = startExtrude(mark.document, from, sketchRowPicked === part?.id, profiles.pickedProfile);
    if ('refusal' in started) return setStudioRefusal(started.refusal);
    commit(started.document);
    openFeature('extrude', started.partId, mark);
  } else if (part)
    cutSelection.featurePart(command, (kind, partId) => openFeature(kind, partId, undefined, initialPatternKind), setStudioRefusal);
}
