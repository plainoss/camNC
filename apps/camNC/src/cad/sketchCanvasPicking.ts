import { numeric, type Point } from './cadEditorShared';
import { addConstraint, type CadSolveOptions } from '@wbcnc/cad';
import { type PointerEvent } from 'react';
import { solveCadDocument } from './solveCad';
import { pickSketchContextTarget } from '@wbcnc/cad-editor/sketchContext';
import { dimensionAnchor } from '@wbcnc/cad-editor/dimensionGeometry';
import { pickSketchSnap } from '@wbcnc/cad-editor/picking';
import { drawingClickPoint } from '@wbcnc/cad-editor/drawingInference';
import { tangentLineAxis } from './lineInference';
import { dragTargets, hasDragMovement } from '@wbcnc/cad-editor/drag';
import { dragSnapConstraints } from '@wbcnc/cad-editor/dragSnap';
import { chainGeometry, type DragGesture } from './editorGestures';
import { replacePart } from './editorHelpers';
import { partCornerInference } from './partCornerInference';
import type { SketchEditorInput } from './sketchEditorInput';

// Turning canvas positions into sketch points and targets, and solving drags, split out of CadEditor. They read the editor through SketchEditorInput.
export function sketchPointAt(editor: SketchEditorInput, event: { clientX: number; clientY: number; shiftKey?: boolean }): Point {
  const {
    chain,
    cursor,
    dimensionSelection,
    drag,
    drawingGroup,
    hoveredReferences,
    inference,
    lastDrawingHint,
    lastSnap,
    lineContinuation,
    part,
    partEdges,
    pending,
    projectPoint,
    sketch,
    sketchBackdrop,
    snap,
    svg,
    tangentAxis,
    tool,
  } = editor;
  const matrix = (drawingGroup.current ?? svg.current)?.getScreenCTM();
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
    lastDrawingHint.current = drawingClickPoint(sketch, raw, {
      project: projectPoint,
      directSnap: hit,
      lockedAxes,
      preferredPointIds: hoveredReferences.current,
      excludePointIds: [...(drag.current?.points ?? []), ...(tool === 'line' && startId && inference.current ? [startId] : [])],
    });
    lastDrawingHint.current = partCornerInference(
      sketchBackdrop?.document,
      part,
      partEdges,
      raw,
      lastDrawingHint.current,
      projectPoint,
      lockedAxes
    );
    point = { ...lastDrawingHint.current.point };
  } else if (!hit) point = { x: Math.round(raw.x), y: Math.round(raw.y) };
  return point;
}

export function sketchContextTarget(editor: SketchEditorInput, target: Element, position: Point) {
  const { dimensionSelection, projectPoint, sketch } = editor;
  return sketch
    ? target.closest('[data-constraint-id]')
      ? sketch.constraints.some(c => c.id === target.closest('[data-constraint-id]')?.getAttribute('data-constraint-id'))
        ? { kind: 'constraint' as const, id: target.closest('[data-constraint-id]')!.getAttribute('data-constraint-id')! }
        : ({ kind: 'blank' } as const)
      : pickSketchContextTarget(sketch, position, {
          project: projectPoint,
          selectedEntityIds: dimensionSelection,
          targetDimensionId: target.closest('[data-dimension]')?.getAttribute('data-dimension') ?? undefined,
          targetEntityId: target.closest('[data-entity-id]')?.getAttribute('data-entity-id') ?? undefined,
        })
    : ({ kind: 'blank' } as const);
}

export async function solveSketchDrag(editor: SketchEditorInput, moving: DragGesture) {
  const {
    commit,
    documentRef,
    drag,
    projectPoint,
    requestSketchCheck,
    restoreCanvasKeyboard,
    setBusy,
    setDocument,
    setDrawingCue,
    setMessage,
    setSnapCue,
  } = editor;
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
}

export function startSketchAnnotationDrag(editor: SketchEditorInput, id: string, event: PointerEvent<SVGGElement>) {
  const { annotationDrag, busy, documentRef, drawingGroup, markerScale, selectDimension, sketch, solving, svg } = editor;
  if (event.button !== 0 || event.shiftKey || event.ctrlKey || event.metaKey || busy || solving || !sketch) return;
  const constraint = sketch.constraints.find(c => c.id === id);
  const matrix = (drawingGroup.current ?? svg.current)?.getScreenCTM();
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
}
