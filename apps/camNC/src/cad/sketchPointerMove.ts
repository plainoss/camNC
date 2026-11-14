import { numeric } from './cadEditorShared';
import { visibleSketchPointIds, withDimensionPlacement } from '@wbcnc/cad';
import { type PointerEvent } from 'react';
import { transitionDimensionWorkflow } from '@wbcnc/cad-editor/dimensionWorkflow';
import { transitionDrawingGesture } from '@wbcnc/cad-editor/drawingGesture';
import { transitionSketchContextPress } from '@wbcnc/cad-editor/sketchContext';
import { pickSketchPoint, pickSketchSnap } from '@wbcnc/cad-editor/picking';
import { type CadDrawingInference } from '@wbcnc/cad-editor/drawingInference';
import { inferDragPoint } from '@wbcnc/cad-editor/dragSnap';
import { boxSelectSketch } from './boxSelection';
import { cutRegionAt, cutRegions, topRegions } from './cutRegions';
import { snapLabels } from './editorHelpers';
import { drawingMatrix, edgeOn, straightOn, turnedBy } from './sketchOrbit';
import type { SketchEditorInput } from './sketchEditorInput';
import { cancelHandleDrag, moveHandleDrag } from './sketchHandleDrags';
import { sketchPointAtClient } from './sketchViewport';

// The sketch canvas pointer-move and pointer-up handlers, split out of CadEditor. They read the editor through SketchEditorInput.
export function sketchPointerMove(editor: SketchEditorInput, event: PointerEvent<SVGSVGElement>) {
  const {
    annotationDrag,
    boxGesture,
    centerArcSweep,
    contextPress,
    dimensionFlow,
    dimensionSelection,
    documentRef,
    drag,
    drawingGesture,
    drawingGroup,
    handleDrag,
    inference,
    lastDrawingHint,
    lastSnap,
    markerScale,
    modification,
    pan,
    pending,
    placingDimension,
    pointAt,
    polygonCountGesture,
    polygonTool,
    projectPoint,
    setCursor,
    setDimensionFlow,
    setDocument,
    setDrawingCue,
    setHoveredModifyCurve,
    setHoveredPoint,
    setModifyTarget,
    setPolygonSides,
    setSelectionBox,
    setSketchTurn,
    setSnapCue,
    setView,
    sketch,
    sketchBackdrop,
    sketchTurn,
    snap,
    solveDrag,
    svg,
    tool,
  } = editor;
  const handle = handleDrag.current;
  if (handle) {
    const point = sketchPointAtClient(event, drawingGroup.current ?? svg.current);
    if (point) moveHandleDrag(editor, handle, point, event);
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
    const matrix = (drawingGroup.current ?? svg.current)?.getScreenCTM();
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
    const matrix = (drawingGroup.current ?? svg.current)?.getScreenCTM();
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
    const matrix = (drawingGroup.current ?? svg.current)?.getScreenCTM();
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
    const matrix = (drawingGroup.current ?? svg.current)?.getScreenCTM();
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
}

export function sketchPointerEnd(editor: SketchEditorInput, cancel = false, event?: PointerEvent<SVGSVGElement>) {
  const {
    addShape,
    annotationDrag,
    boxGesture,
    commit,
    contextPress,
    documentRef,
    drag,
    drawingGesture,
    faceSketch,
    handleDrag,
    markerScale,
    openContext,
    pan,
    part,
    pendingSnaps,
    pointAt,
    requestSketchCheck,
    restoreCanvasKeyboard,
    selected,
    setBusy,
    setCursor,
    setDocument,
    setDrawingCue,
    setLineContinuation,
    setPending,
    setRegionField,
    setSelected,
    setSelectedConstraints,
    setSelectionBox,
    setSnapCue,
    sketch,
    solveDrag,
    svg,
    tool,
  } = editor;
  if (handleDrag.current) {
    if (cancel) cancelHandleDrag(editor, handleDrag.current);
    handleDrag.current = null;
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
}
