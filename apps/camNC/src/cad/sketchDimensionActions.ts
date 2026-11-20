import { numeric } from './cadEditorShared';
import {
  addBezier,
  addSpline,
  constraintEntityIds,
  dimensionValueError,
  newCadId,
  updateDimension,
  applyNewDimension,
  addConstraint,
  withDimensionPlacement,
  type CadDimension,
} from '@wbcnc/cad';
import { prepareDimensionCreation } from './solveCad';
import { amendCadSession, cadCommandCheckpoint } from '@wbcnc/cad-editor/session';
import { idleDimensionWorkflow, transitionDimensionWorkflow, type DimensionWorkflowEvent } from '@wbcnc/cad-editor/dimensionWorkflow';
import { replacePart } from './editorHelpers';
import { cadFieldText } from './designUnits';
import { advanceCreationValue, creationValueAnchor, creationValueAt } from './creationValues';
import type { SketchEditorInput } from './sketchEditorInput';

// Placing and editing dimensions and typed creation values, split out of CadEditor. They read the editor through SketchEditorInput.
export async function placeSketchDimension(editor: SketchEditorInput, placed: CadDimension) {
  const {
    busy,
    commit,
    documentRef,
    mounted,
    newDimensionCommand,
    part,
    preparingDimension,
    session,
    setBusy,
    setDimension,
    setMessage,
    setSelectedConstraints,
  } = editor;
  if (!part || busy || preparingDimension.current) return;
  const source = documentRef.current;
  const snapshot = JSON.stringify(source);
  preparingDimension.current = true;
  setBusy(true);
  try {
    const result = await prepareDimensionCreation(part, placed);
    if (!mounted.current) return;
    if (JSON.stringify(documentRef.current) !== snapshot) {
      setMessage('The sketch changed while the dimension was checked. Select geometry again.');
      return;
    }
    if (!result.ok) {
      setMessage(result.message);
      return;
    }
    commit(replacePart(source, part.id, () => result.part));
    setSelectedConstraints([placed.id]);
    // A reference dimension opens with the length it measures, and Enter takes it as it is.
    if (result.driven) {
      setDimension(placed.id);
      setMessage('Reference dimension created. Existing constraints already determine this measurement.');
    } else {
      newDimensionCommand.current = { id: placed.id, checkpoint: cadCommandCheckpoint(session) };
      setDimension(placed.id);
      setMessage('Enter a dimension. Enter applies it; Escape cancels.');
    }
  } catch (error) {
    if (mounted.current) setMessage(error instanceof Error ? error.message : String(error));
  } finally {
    preparingDimension.current = false;
    if (mounted.current) setBusy(false);
  }
}

export function applySketchDimensionValue(editor: SketchEditorInput): string | null {
  const {
    commit,
    currentDimension,
    dimensionInput,
    documentRef,
    newDimensionCommand,
    parseCadValue,
    publish,
    rejectValue,
    session,
    setDimension,
    setMessage,
    svg,
    variableScope,
  } = editor;
  if (!currentDimension || !numeric(currentDimension)) return null;
  if (currentDimension.driven) {
    setDimension(null);
    setMessage('Reference dimension kept. It follows the geometry.');
    svg.current?.focus();
    return null;
  }
  const input = dimensionInput.current;
  if (!input?.value.trim()) return rejectValue('Enter a dimension value.', input);
  const parsed = parseCadValue(input.value, { unit: currentDimension.type === 'angle' ? 'deg' : 'mm', variables: variableScope });
  if ('error' in parsed) return rejectValue(parsed.error, input);
  const valueError = dimensionValueError(currentDimension, parsed.value);
  if (valueError) return rejectValue(valueError, input);
  const command = newDimensionCommand.current;
  // A newly placed first dimension sizes the whole sketch, keeping what was drawn in proportion.
  const next = (command?.id === currentDimension.id ? applyNewDimension : updateDimension)(
    documentRef.current,
    currentDimension.id,
    parsed.value,
    parsed.expression
  );
  const amended = command?.id === currentDimension.id ? amendCadSession(session, next, command.checkpoint) : null;
  if (amended) publish(amended);
  else commit(next);
  newDimensionCommand.current = null;
  setDimension(null);
  setMessage('Dimension applied. Select geometry or choose a tool.');
  svg.current?.focus();
  return null;
}

export function applySketchDimensionEvent(editor: SketchEditorInput, event: DimensionWorkflowEvent) {
  const { cancelDimensionEdit, dimensionFlow, editDimension, placeDimension, setDimensionFlow, setMessage, sketch } = editor;
  if (!sketch) return;
  const transition = transitionDimensionWorkflow(sketch, dimensionFlow, event);
  setDimensionFlow(transition.state);
  if (transition.message) setMessage(transition.message);
  if (transition.effect?.type === 'edit-existing') {
    editDimension(transition.effect.constraintId);
    return;
  }
  if (transition.effect?.type === 'create') {
    const placed = transition.effect.constraint;
    if (!constraintEntityIds(placed).every(id => sketch.entities.some(entity => entity.id === id))) {
      cancelDimensionEdit();
      setMessage('The dimension geometry changed. Select geometry again to create a dimension.');
      return;
    }
    void placeDimension(placed);
  }
}

export function beginSketchDimension(editor: SketchEditorInput) {
  const { chooseTool, dimensionMode, selected, selectionHints, setDimensionFlow, setMessage, setSelected, sketch, svg, tool } = editor;
  chooseTool('dimension');
  if (tool === 'dimension' || !sketch) return;
  const transition = transitionDimensionWorkflow(sketch, idleDimensionWorkflow(dimensionMode), {
    type: 'begin',
    entityIds: selected,
    previewId: newCadId(),
    pickHints: selectionHints.current,
  });
  setDimensionFlow(transition.state);
  setSelected([]);
  if (transition.message) setMessage(transition.message);
  svg.current?.focus();
}

export function editSketchDimension(editor: SketchEditorInput, id: string) {
  const { newDimensionCommand, setDimension, setDimensionFlow, setMessage, setSelected, setSelectedConstraints, sketch, svg } = editor;
  newDimensionCommand.current = null;
  setDimensionFlow(previous => idleDimensionWorkflow(previous.mode));
  setSelectedConstraints([id]);
  setSelected([]);
  const constraint = sketch?.constraints.find(c => c.id === id);
  if (constraint && numeric(constraint) && constraint.driven) {
    setDimension(null);
    setMessage('Reference dimensions follow the geometry. Change it to driving from its context menu to edit the value.');
    svg.current?.focus();
    return;
  }
  setDimension(id);
  setMessage('Enter a dimension. Enter applies it; Escape cancels.');
}

export function finishSketchSpline(editor: SketchEditorInput, keepTool: boolean) {
  const {
    addSnapRelations,
    changeSketch,
    chooseTool,
    construction,
    pending,
    pendingSnaps,
    setMessage,
    setSelected,
    setTool,
    sketch,
    tool,
  } = editor;
  if (!sketch || (tool !== 'spline' && tool !== 'bezier') || pending.length < 2) return;
  try {
    let next = (tool === 'spline' ? addSpline : addBezier)(sketch, { points: pending, construction });
    next = addSnapRelations(next, pendingSnaps.current);
    const curve = next.entities.find(entity => entity.type === tool && !sketch.entities.some(before => before.id === entity.id));
    changeSketch(next);
    chooseTool('select');
    if (keepTool) setTool(tool);
    setSelected(curve ? [curve.id] : []);
    setMessage(`${tool === 'spline' ? 'Spline' : 'Bezier'} created. Drag its visible points to edit the curve.`);
  } catch (error) {
    setMessage(error instanceof Error ? error.message : String(error));
  }
}

export function cancelSketchDimensionEdit(editor: SketchEditorInput) {
  const { dimension, dimensionDraft, newDimensionCommand, setDimensionFlow, setDimension, setSelectedConstraints, setMessage, svg } =
    editor;
  const placed = dimension && !dimensionDraft;
  newDimensionCommand.current = null;
  setDimensionFlow(previous => idleDimensionWorkflow(previous.mode));
  setDimension(null);
  if (dimensionDraft) setSelectedConstraints(ids => ids.filter(id => id !== dimensionDraft.id));
  setMessage(
    placed
      ? 'Dimension value unchanged. Select geometry or choose a tool.'
      : 'Dimension creation cancelled. Select geometry or choose a tool.'
  );
  svg.current?.focus();
}

export function selectSketchDimension(editor: SketchEditorInput, id: string, additive: boolean) {
  const { newDimensionCommand, setDimensionFlow, setDimension, setSelectedConstraints, setSelected, setMessage } = editor;
  newDimensionCommand.current = null;
  setDimensionFlow(previous => idleDimensionWorkflow(previous.mode));
  setDimension(null);
  setSelectedConstraints(ids => (additive ? (ids.includes(id) ? ids.filter(existing => existing !== id) : [...ids, id]) : [id]));
  setSelected([]);
  setMessage('Dimension selected. Double-click or press Enter to edit; Delete removes it.');
}

export function applySketchCreationValue(editor: SketchEditorInput, { advance = true } = {}): string | null {
  const {
    creationValues,
    part,
    sketch,
    rejectValue,
    creationInput,
    parseCadValue,
    lengthText,
    variableScope,
    commit,
    documentRef,
    markerScale,
    changeSketch,
    setCreationValues,
    setMessage,
    svg,
  } = editor;
  if (!creationValues || !part || !sketch || creationValues.partId !== part.id) return null;
  const current = creationValueAt(creationValues, sketch);
  if (!current) return rejectValue('This drawing value no longer applies. Select its geometry again.', creationInput.current);
  const parsed = parseCadValue(
    creationValues.editing ? cadFieldText(creationInput.current, creationValues.text) : lengthText(current.constraint.value),
    { unit: 'mm', variables: variableScope }
  );
  if ('error' in parsed) return rejectValue(parsed.error, creationInput.current);
  const valueError = dimensionValueError(current.constraint, parsed.value);
  if (valueError) return rejectValue(valueError, creationInput.current);
  if (current.existingConstraintId)
    commit(updateDimension(documentRef.current, current.existingConstraintId, parsed.value, parsed.expression));
  else {
    const constraint = { ...current.constraint, value: parsed.value, expression: parsed.expression };
    const position = creationValueAnchor(creationValues, sketch, creationValues.index, markerScale);
    changeSketch(addConstraint(sketch, position ? withDimensionPlacement(sketch, constraint, position) : constraint));
  }
  setCreationValues(advance ? advanceCreationValue(creationValues) : null);
  setMessage('Drawing dimension applied. Type the next value or keep drawing.');
  svg.current?.focus();
  return null;
}
