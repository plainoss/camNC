import { numeric } from './cadEditorShared';
import { parseCircularPatternParameters } from './circularPatternParameters';
import { CAD_GEOMETRY_TOLERANCE, visibleSketchPointIds, withDimensionPlacement } from '@wbcnc/cad';
import { type PointerEvent } from 'react';
import { transitionDimensionWorkflow } from '@wbcnc/cad-editor/dimensionWorkflow';
import { transitionDrawingGesture } from '@wbcnc/cad-editor/drawingGesture';
import { parseTransformParameters } from './transformParameters';
import { transitionSketchContextPress } from '@wbcnc/cad-editor/sketchContext';
import { pickSketchPoint, pickSketchSnap } from '@wbcnc/cad-editor/picking';
import { type CadDrawingInference } from '@wbcnc/cad-editor/drawingInference';
import { inferDragPoint } from '@wbcnc/cad-editor/dragSnap';
import { boxSelectSketch } from './boxSelection';
import { cutRegionAt, cutRegions, topRegions } from './cutRegions';
import { snapLabels } from './editorHelpers';
import { drawingMatrix, edgeOn, straightOn, turnedBy } from './sketchOrbit';
import type { SketchEditorInput } from './sketchEditorInput';

// The sketch canvas pointer-move and pointer-up handlers, split out of CadEditor. They read the editor through SketchEditorInput.
export function sketchPointerMove(editor: SketchEditorInput, event: PointerEvent<SVGSVGElement>) {
  const {
    annotationDrag,
    boxGesture,
    centerArcSweep,
    chamferDrag,
    circularDrag,
    contextPress,
    dimensionFlow,
    dimensionSelection,
    documentRef,
    drag,
    drawingGesture,
    drawingGroup,
    inference,
    lastDrawingHint,
    lastSnap,
    lengthText,
    lengthUnit,
    markerScale,
    modification,
    pan,
    patternDrag,
    pending,
    placingDimension,
    pointAt,
    polygonCountGesture,
    polygonTool,
    projectPoint,
    setChamferDistances,
    setCircularParameters,
    setCursor,
    setDimensionFlow,
    setDocument,
    setDrawingCue,
    setHoveredModifyCurve,
    setHoveredPoint,
    setLinearParameters,
    setModifyTarget,
    setPolygonSides,
    setSelectionBox,
    setSketchTurn,
    setSlotWidth,
    setSnapCue,
    setTransformParameters,
    setView,
    shownSketch,
    sketch,
    sketchBackdrop,
    sketchTurn,
    slotDrag,
    snap,
    solveDrag,
    svg,
    tool,
    transformDrag,
  } = editor;
  if (slotDrag.current) {
    const matrix = (drawingGroup.current ?? svg.current)?.getScreenCTM();
    if (!matrix) return;
    const raw = new DOMPoint(event.clientX, event.clientY).matrixTransform(matrix.inverse()),
      center = slotDrag.current.center;
    setSlotWidth(lengthText(Math.round(2 * Math.hypot(raw.x - center.x, -raw.y - center.y) * 1e6) / 1e6));
    return;
  }
  if (circularDrag.current) {
    const matrix = (drawingGroup.current ?? svg.current)?.getScreenCTM();
    if (!matrix) return;
    const raw = new DOMPoint(event.clientX, event.clientY).matrixTransform(matrix.inverse()),
      point = { x: raw.x, y: -raw.y },
      gesture = circularDrag.current,
      parsed = parseCircularPatternParameters(gesture.parameters, lengthUnit);
    if (!parsed.ok) return;
    const text = (n: number) => String(Math.round(n * 1e6) / 1e6);
    if (gesture.kind === 'center')
      setCircularParameters({
        ...gesture.parameters,
        centerX: lengthText(parsed.center.x + point.x - gesture.start.x),
        centerY: lengthText(parsed.center.y + point.y - gesture.start.y),
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
    const matrix = (drawingGroup.current ?? svg.current)?.getScreenCTM();
    if (!matrix) return;
    const raw = new DOMPoint(event.clientX, event.clientY).matrixTransform(matrix.inverse()),
      { index, anchor, parameters } = patternDrag.current;
    const x = raw.x - anchor.x,
      y = -raw.y - anchor.y,
      spacing = lengthText(Math.round(Math.hypot(x, y) * 1e6) / 1e6),
      angle = String(Math.round(((Math.atan2(y, x) * 180) / Math.PI) * 1e6) / 1e6);
    setLinearParameters({
      ...parameters,
      ...(index === 0 ? { spacingX: spacing, angleX: angle } : { spacingY: spacing, angleY: angle }),
    });
    return;
  }

  if (transformDrag.current) {
    const matrix = (drawingGroup.current ?? svg.current)?.getScreenCTM();
    if (!matrix) return;
    const raw = new DOMPoint(event.clientX, event.clientY).matrixTransform(matrix.inverse());
    let point = { x: raw.x, y: -raw.y };
    const { kind, start, parameters } = transformDrag.current,
      parsed = parseTransformParameters(parameters, lengthUnit);
    if (!parsed.ok) return;
    const text = (n: number) => String(Math.round(n * 1e6) / 1e6);
    const center = { x: parsed.pivot.x + parsed.translation.x, y: parsed.pivot.y + parsed.translation.y };
    if (kind === 'translate')
      setTransformParameters({
        ...parameters,
        dx: lengthText(parsed.translation.x + point.x - start.x),
        dy: lengthText(parsed.translation.y + point.y - start.y),
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
        pivotX: lengthText(x),
        pivotY: lengthText(y),
        dx: lengthText(parsed.translation.x + (1 - c) * dx + s * dy),
        dy: lengthText(parsed.translation.y - s * dx + (1 - c) * dy),
      });
    }
    return;
  }

  if (chamferDrag.current) {
    const matrix = (drawingGroup.current ?? svg.current)?.getScreenCTM();
    if (!matrix) return;
    const point = new DOMPoint(event.clientX, event.clientY).matrixTransform(matrix.inverse());
    const { side, origin, direction } = chamferDrag.current;
    const distance = Math.max(0.001, (point.x - origin.x) * direction.x + (-point.y - origin.y) * direction.y);
    setChamferDistances(previous =>
      previous.map((value, index) => (index === side ? lengthText(Math.round(distance * 1000) / 1000) : value))
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
    chamferDrag,
    circularDrag,
    commit,
    contextPress,
    documentRef,
    drag,
    drawingGesture,
    faceSketch,
    markerScale,
    openContext,
    pan,
    part,
    patternDrag,
    pendingSnaps,
    pointAt,
    requestSketchCheck,
    restoreCanvasKeyboard,
    selected,
    setBusy,
    setChamferDistances,
    setCircularParameters,
    setCursor,
    setDocument,
    setDrawingCue,
    setLineContinuation,
    setLinearParameters,
    setPending,
    setRegionField,
    setSelected,
    setSelectedConstraints,
    setSelectionBox,
    setSlotWidth,
    setSnapCue,
    setTransformParameters,
    sketch,
    slotDrag,
    solveDrag,
    svg,
    tool,
    transformDrag,
  } = editor;
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
}
