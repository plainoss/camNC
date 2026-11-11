import {
  addConstraint,
  addPoint,
  splitSketchCurve,
  sketchPatternOwner,
  isClosedSketchCurve,
  evaluateCurvePoint,
  extendSketchCurve,
  mirrorSketchEntities,
  insertCurveControlPoint,
  isOwnedSplineHandle,
  newCadId,
  pointEquivalence,
} from '@wbcnc/cad';
import { type PointerEvent } from 'react';
import { transitionDrawingGesture } from '@wbcnc/cad-editor/drawingGesture';
import { initialTransformParameters } from './transformParameters';
import { transitionSketchContextPress } from '@wbcnc/cad-editor/sketchContext';
import { trimSketchCurveAt } from '@wbcnc/cad-editor/trimCurves';
import { pickBezierControlPolygon, pickSketchPoint, pickSketchSnap } from '@wbcnc/cad-editor/picking';
import { buildConstraintForSelection, constraintPrompt } from '@wbcnc/cad-editor/constraintCommands';
import { dragTargets } from '@wbcnc/cad-editor/drag';
import { modificationSourceIds, transitionModification } from '@wbcnc/cad-editor/modificationWorkflow';
import { edgeOn } from './sketchOrbit';
import { pointsOf } from './fitSketchView';
import type { SketchEditorInput } from './sketchEditorInput';

// The sketch canvas pointer-down handler, split out of CadEditor. It reads the editor through SketchEditorInput.
export function sketchPointerDown(input: SketchEditorInput, event: PointerEvent<SVGSVGElement>) {
  const {
    acceptLinearPattern,
    acceptOffset,
    acceptSlot,
    acceptTransform,
    addShape,
    addSnapRelations,
    applyDimensionEvent,
    boxGesture,
    busy,
    centerArcSweep,
    changeSketch,
    chooseTool,
    conicEditing,
    constraintMode,
    construction,
    contextPress,
    contextTarget,
    dimensionSelection,
    doc,
    drag,
    drawingGesture,
    drawingGroup,
    fixGeometry,
    fixMode,
    lastDrawingHint,
    lengthUnit,
    modification,
    newCurveCommand,
    pan,
    part,
    patternEditId,
    pending,
    pendingSnaps,
    pickedEdges,
    pointAt,
    polygonCountGesture,
    polygonSides,
    polygonTool,
    projectPoint,
    selected,
    selectionHints,
    setChain,
    setConicEditing,
    setCreationValues,
    setCursor,
    setDimension,
    setFilletEditing,
    setHoveredModifyCurve,
    setLineContinuation,
    setMessage,
    setModification,
    setModifyTarget,
    setPending,
    setPickedEdges,
    setRegionField,
    setSelected,
    setSelectedConstraints,
    setSplitFirst,
    setSplitNotice,
    setTransformParameters,
    sketch,
    sketchBackdrop,
    sketchTurn,
    splitFirst,
    svg,
    takeEdges,
    tool,
    transformSelectionCenter,
    usingEdges,
    view,
  } = input;
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
  // Use is on: an edge clicked goes straight in, and a click anywhere else draws nothing.
  if (usingEdges) {
    if (edgeKey) takeEdges([edgeKey]);
    return;
  }
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
        (entity.type === 'line' || entity.type === 'arc') && [entity.startId, entity.endId].some(id => equivalent.equivalent(id, point.id))
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
  if (fixMode) {
    if (id) fixGeometry([id]);
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
    if (sourceId) setSelected(previous => (previous.includes(sourceId) ? previous.filter(id => id !== sourceId) : [...previous, sourceId]));
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
      if (!selected.length) setTransformParameters(initialTransformParameters(transformSelectionCenter(next), lengthUnit));
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
      const matrix = (drawingGroup.current ?? svg.current)?.getScreenCTM();
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
        const matrix = (drawingGroup.current ?? svg.current)?.getScreenCTM();
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
}
