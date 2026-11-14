import { type Point, type SketchPoint, type Tool } from './cadEditorShared';
import { initialCircularPatternParameters } from './circularPatternParameters';
import {
  CAD_GEOMETRY_TOLERANCE,
  addArc,
  addInscribedPolygon,
  addCircumscribedPolygon,
  addCenterPointArc,
  centerPointArcFromPoints,
  addCircle,
  addThreePointCircle,
  addEllipse,
  addConic,
  addConstraint,
  addLine,
  addAlignedRectangle,
  newCadId,
  pointEquivalence,
} from '@wbcnc/cad';
import { cadCommandCheckpoint } from '@wbcnc/cad-editor/session';
import { idleDimensionWorkflow } from '@wbcnc/cad-editor/dimensionWorkflow';
import { idleDrawingGesture } from '@wbcnc/cad-editor/drawingGesture';
import { beginCreationValues } from './creationValues';
import { initialLinearPatternParameters } from './linearPatternParameters';
import { initialTransformParameters } from './transformParameters';
import { tangentArcFrom, threePointArc } from '@wbcnc/cad-editor/geometry';
import { drawnSelection, withSizeExpressions } from '@wbcnc/cad-editor/drawingCommit';
import { createRectangle, isRectangleTool, rectanglePrompt } from '@wbcnc/cad-editor/rectangleTool';
import { chainGeometry, type ChainAnchor } from './editorGestures';
import { beginModification, idleModificationWorkflow, modificationSourceIds } from '@wbcnc/cad-editor/modificationWorkflow';
import type { SketchEditorInput } from './sketchEditorInput';

// Choosing a sketch tool and adding the drawn shape, split out of CadEditor. They read the editor through SketchEditorInput.
export function chooseSketchTool(editor: SketchEditorInput, next: Tool) {
  const {
    boxGesture,
    chain,
    contextPress,
    contextualArc,
    drawingGesture,
    handleDrag,
    hoveredReferences,
    lastDrawingHint,
    lengthText,
    lengthUnit,
    lineContinuation,
    newCurveCommand,
    newDimensionCommand,
    patternCommandId,
    pending,
    pendingSnaps,
    selected,
    setChain,
    setCircularParameters,
    setConicEditing,
    setConstraintMode,
    setContextMenu,
    setContextualArc,
    setCreationValues,
    setDimension,
    setDimensionFlow,
    setDrawingCue,
    setFilletEditing,
    setFixMode,
    setHoveredConstraintEntities,
    setHoveredModifyCurve,
    setLineContinuation,
    setLinearParameters,
    setMessage,
    setModification,
    setModifyTarget,
    setPalette,
    setPatternEditId,
    setPatternNotice,
    setPending,
    setSelected,
    setSelectedConstraints,
    setSelectionBox,
    setSharedSlotWidth,
    setSlotChain,
    setSlotWidth,
    setSnapCue,
    setSplitFirst,
    setSplitNotice,
    setTool,
    setTransformNotice,
    setTransformParameters,
    setUsingEdges,
    sketch,
    svg,
    tangentAxis,
    tool,
    transformSelectionCenter,
  } = editor;
  handleDrag.current = null;
  // Choosing any tool, Select included, ends Use.
  setUsingEdges(false);
  if (next === 'slot') {
    setSlotWidth(lengthText(10));
    setSlotChain(false);
    setSharedSlotWidth(undefined);
  }
  setPatternEditId(null);
  setPatternNotice('');
  if (next === 'circularPattern') {
    setCircularParameters(initialCircularPatternParameters());
    patternCommandId.current = newCadId();
  }
  if (next === 'linearPattern') {
    setLinearParameters(initialLinearPatternParameters(lengthUnit));
    patternCommandId.current = newCadId();
  }

  setContextMenu(null);
  setTransformNotice('');
  if (next === 'transform') setTransformParameters(initialTransformParameters(transformSelectionCenter(selected), lengthUnit));
  contextPress.current = { phase: 'idle' };
  setCreationValues(null);
  drawingGesture.current = idleDrawingGesture();
  setConstraintMode(null);
  setFixMode(false);
  setDimension(null);
  setPalette(false);
  setFilletEditing(false);
  setSplitFirst(null);
  setSplitNotice('');
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
    const started = beginModification(sketch, next, selected);
    setModification(started.phase === 'offset' ? { ...started, text: lengthText(Number(started.text)) } : started);
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
            : isRectangleTool(next)
              ? rectanglePrompt(next)
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
}

export function addSketchShape(editor: SketchEditorInput, end?: Point) {
  const {
    addSnapRelations,
    centerArcSweep,
    chain,
    changeSketch,
    construction,
    contextualArc,
    drawingGesture,
    height,
    inference,
    lastDrawingHint,
    lengthUnit,
    lineContinuation,
    newCurveCommand,
    parseCadValue,
    part,
    pending,
    pendingSnaps,
    polygonSides,
    polygonTool,
    radius,
    rho,
    session,
    setChain,
    setConicEditing,
    setCreationValues,
    setDimension,
    setDrawingCue,
    setLineContinuation,
    setMessage,
    setPending,
    setRho,
    setSelected,
    setSnapCue,
    setTool,
    sketch,
    svg,
    tangentAxis,
    tool,
    variableScope,
    width,
  } = editor;
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
  } else if (isRectangleTool(tool)) {
    const rectangle = createRectangle(sketch, { tool, start, end, width, height, variables: variableScope, lengthUnit, construction });
    if (rectangle.error !== undefined) return setMessage(rectangle.error);
    next = rectangle.sketch;
    Object.assign(sizeExpressions, rectangle.sizeExpressions);
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
  next = withSizeExpressions(sketch, next, sizeExpressions);
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
  setSelected(drawnSelection(sketch, next, tool));
  // Passive measured values leave shortcuts live; numeric typing turns them into drivers.
  setDimension(null);
  svg.current?.focus();
}
