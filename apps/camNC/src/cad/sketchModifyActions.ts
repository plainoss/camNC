import { numeric, type ConstraintTool } from './cadEditorShared';
import {
  CAD_GEOMETRY_TOLERANCE,
  addConstraint,
  replaceFilletedSketch,
  sketchPatternOwner,
  linearPatternSketchEntities,
  circularPatternSketchEntities,
  patternDeletionNotice,
  slotDeletionNotice,
  isSplineTangentHandle,
  removeEntity,
  setConicRho,
  setDimensionDriven,
} from '@wbcnc/cad';
import { amendCadSession } from '@wbcnc/cad-editor/session';
import { toggleContextConstruction, type SketchContext, type SketchContextAction } from '@wbcnc/cad-editor/sketchContext';
import { buildConstraintForSelection } from '@wbcnc/cad-editor/constraintCommands';
import { transitionModification } from '@wbcnc/cad-editor/modificationWorkflow';
import { removeInlineConstraint } from '@wbcnc/cad-editor/inlineConstraintLayout';
import { replacePart } from './editorHelpers';
import type { SketchEditorInput } from './sketchEditorInput';

// Accepting sketch patterns, fillets, chamfers and offsets, constraining, and deleting, split out of CadEditor. They read the editor through SketchEditorInput.
export function acceptSketchLinearPattern(editor: SketchEditorInput) {
  const {
    acceptCircularPattern,
    changeSketch,
    chooseTool,
    parsedLinear,
    patternCommandId,
    patternEditId,
    selected,
    setMessage,
    setPatternNotice,
    setSelected,
    setSelectedConstraints,
    sketch,
    tool,
  } = editor;
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
}

export function acceptSketchCircularPattern(editor: SketchEditorInput) {
  const {
    changeSketch,
    chooseTool,
    parsedCircular,
    patternCommandId,
    patternEditId,
    selected,
    setMessage,
    setPatternNotice,
    setSelected,
    setSelectedConstraints,
    sketch,
  } = editor;
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
}

export function acceptSketchFillet(editor: SketchEditorInput) {
  const {
    chooseTool,
    commit,
    documentRef,
    filletPreview,
    filletRadius,
    filletSelection,
    parseCadValue,
    setMessage,
    setSelected,
    setSelectedConstraints,
    variableScope,
  } = editor;
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
  commit(replaceFilletedSketch(documentRef.current, next, filletPreview.arcIds));
  chooseTool('select');
  setSelected([]);
  setSelectedConstraints([radiusId]);
  setMessage('Fillets created. Double-click the shared radius to edit the group.');
}

export function acceptSketchChamfer(editor: SketchEditorInput) {
  const {
    chamferDistances,
    chamferPreview,
    chamferSelection,
    changeSketch,
    chooseTool,
    parseCadValue,
    setMessage,
    setSelected,
    setSelectedConstraints,
    variableScope,
  } = editor;
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
}

export function acceptSketchOffset(editor: SketchEditorInput): string | null {
  const {
    changeSketch,
    modification,
    offsetInput,
    offsetPreview,
    parseCadValue,
    rejectValue,
    setMessage,
    setModification,
    setSelected,
    svg,
    variableScope,
  } = editor;
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
}

export function applySketchConicRho(editor: SketchEditorInput): string | null {
  const {
    chooseTool,
    commit,
    conicEditing,
    documentRef,
    newCurveCommand,
    parseCadValue,
    part,
    publish,
    rejectValue,
    rho,
    rhoInput,
    session,
    setMessage,
    setSelected,
    sketch,
  } = editor;
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
}

export function removeSketchSelection(editor: SketchEditorInput, entityIds: readonly string[], constraintIds: readonly string[]) {
  const {
    cancelDimensionEdit,
    chain,
    changeSketch,
    chooseTool,
    dimensionFlow,
    hoveredReferences,
    inference,
    lastDrawingHint,
    lastSnap,
    pendingSnaps,
    selected,
    setDimension,
    setDrawingCue,
    setHoveredConstraintEntities,
    setHoveredPoint,
    setMessage,
    setPatternNotice,
    setSelected,
    setSelectedConstraints,
    setSnapCue,
    sketch,
    svg,
    tangentAxis,
    tool,
  } = editor;
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
    // Selecting a glyph said it was selected; once it's gone, so is that message.
    setMessage('');
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
}

export function constrainSketch(editor: SketchEditorInput, type: ConstraintTool) {
  const {
    changeSketch,
    chooseTool,
    constraintMode,
    dimensionSelection,
    setConstraintMode,
    setFixMode,
    setMessage,
    setSelected,
    sketch,
    svg,
  } = editor;
  if (!sketch) return;
  const references = [...dimensionSelection];
  // Constraint commands replace drawing/dimension placement just like the other sketch tools.
  chooseTool('select');
  setFixMode(false);
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
}

export function sketchContextAction(editor: SketchEditorInput, action: SketchContextAction, context: SketchContext) {
  const {
    changeSketch,
    commit,
    documentRef,
    editDimension,
    editPattern,
    fit,
    removeSelected,
    setDimension,
    setHoveredConstraintEntities,
    setMessage,
    setSelected,
    setSelectedConstraints,
    sketch,
  } = editor;
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
}
