import { numeric, type ConstraintTool } from './cadEditorShared';
import { isCadPart, type CadDrawnOn } from '@wbcnc/cad';
import type { Dispatch, KeyboardEvent, PointerEvent, RefObject, SetStateAction } from 'react';
import { idleDimensionWorkflow } from '@wbcnc/cad-editor/dimensionWorkflow';
import { idleDrawingGesture } from '@wbcnc/cad-editor/drawingGesture';
import { transitionModification } from '@wbcnc/cad-editor/modificationWorkflow';
import { creationValueAt, type CreationValues } from './creationValues';
import { initialTransformParameters } from './transformParameters';
import { sketchTools as tools } from './sketchTools';
import { editable } from './editorHelpers';
import type { ViewRequest } from '@/cam/model/ModelViewport';
import { normalTurn } from './sketchOrbit';
import { studioNormalView } from './studioNormalView';
import { studioViewShortcut } from './studioViewShortcut';
import type { StudioCommand } from './StudioToolbar';
import type { SketchEditorInput } from './sketchEditorInput';

/** The CadEditor state and callbacks that its keyboard handler reads, beyond the sketch editor's. CadEditor builds it fresh on every key. */
export type CadEditorKeyDownInput = SketchEditorInput & {
  applyCreationValue: (options?: { advance?: boolean }) => string | null;
  beginDimension: () => void;
  constrain: (type: ConstraintTool) => void;
  creationValues: CreationValues | null;
  dimension: string | null;
  finishSpline: (keepTool?: boolean) => void;
  hoveredPart: RefObject<string | null>;
  isolatePart: () => void;
  keyboardContext: () => void;
  navigateHistory: (redo?: boolean) => void;
  partHasOutline: boolean;
  pointerEnd: (cancel?: boolean, event?: PointerEvent<SVGSVGElement>) => void;
  polygonInput: RefObject<HTMLInputElement | null>;
  selectedConstraints: string[];
  selectedFace: Extract<CadDrawnOn['on'], { partId: string }> | null;
  selectedPlane: string | null;
  setHiddenParts: Dispatch<SetStateAction<ReadonlySet<string>>>;
  setSearchMode: Dispatch<SetStateAction<boolean>>;
  setShortcutsOpen: Dispatch<SetStateAction<boolean>>;
  setSketchCameraShift: Dispatch<SetStateAction<[number, number]>>;
  setTransparentParts: Dispatch<SetStateAction<ReadonlySet<string>>>;
  setViewRequest: Dispatch<SetStateAction<ViewRequest | undefined>>;
  shortcutsOpen: boolean;
  showWorkspace: boolean;
  studioCommand: (command: StudioCommand) => void;
  /** P: hides every plane, or shows them all again. */
  togglePlanes: () => void;
  studioSession: boolean;
  toggleCommandSearch: () => void;
  toggleConstruction: () => void;
  toggleFix: () => void;
};

// The CAD editor's keyboard shortcuts, split out of CadEditor. They read the editor through CadEditorKeyDownInput.
export function cadEditorKeyDown(editor: CadEditorKeyDownInput, event: KeyboardEvent<HTMLDivElement>) {
  const {
    acceptLinearPattern,
    acceptSlot,
    acceptTransform,
    addShape,
    annotationDrag,
    applyCreationValue,
    beginDimension,
    boxGesture,
    busy,
    cancelDimensionEdit,
    chooseTool,
    constrain,
    creationValues,
    dimension,
    dimensionFlow,
    documentRef,
    drag,
    drawingGesture,
    editDimension,
    editPattern,
    filletPreview,
    finishSpline,
    fit,
    hoveredPart,
    hoveredReferences,
    isolatePart,
    keyboardContext,
    lengthUnit,
    modification,
    navigateHistory,
    part,
    partHasOutline,
    pending,
    pickedEdges,
    pointerEnd,
    polygonInput,
    polygonTool,
    removeSelected,
    selected,
    selectedConstraints,
    selectedFace,
    selectedPlane,
    setChain,
    setCreationValues,
    setDimensionFlow,
    setDrawingCue,
    setFilletEditing,
    setHiddenParts,
    setHoveredConstraintEntities,
    setLineContinuation,
    setMessage,
    setModification,
    setPalette,
    setPending,
    setPolygonSides,
    setSearchMode,
    setSelected,
    setSelectedConstraints,
    setSelectionBox,
    setShortcutsOpen,
    setSketchCameraShift,
    setSketchTurn,
    setSnapCue,
    setTransformParameters,
    setTransparentParts,
    setUsingEdges,
    setViewRequest,
    shortcutsOpen,
    showWorkspace,
    sketch,
    sketchBackdrop,
    studioCommand,
    studioSession,
    takeEdges,
    toggleCommandSearch,
    toggleConstruction,
    toggleFix,
    togglePlanes,
    tool,
    transformSelectionCenter,
    usingEdges,
  } = editor;
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
      if (!event.repeat) togglePlanes();
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
}
