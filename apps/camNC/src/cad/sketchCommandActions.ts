import type { Point } from './cadEditorShared';
import { cadSketchFrame, entityPointIds as curvePointIds } from '@wbcnc/cad';
import type { MouseEvent } from 'react';
import { addUsedPartEdges } from './partEdgeUse';
import { finishSketchSpline } from './sketchDimensionActions';
import { circularPatternParameters } from './circularPatternParameters';
import { linearPatternParameters, editablePatternSources } from './linearPatternParameters';
import {
  createSketchContext,
  selectedSketchContextTarget,
  toggleContextConstruction,
  type SketchContextTarget,
} from '@wbcnc/cad-editor/sketchContext';
import { toggleFixed } from './sketchFix';
import type { SketchEditorInput } from './sketchEditorInput';

// Sketch commands run from the toolbar, the canvas and its context menu, split out of CadEditor. They read the editor through SketchEditorInput.

/** The middle of the bounds of the points of `ids`, which a transform turns and scales about. */
export function sketchTransformSelectionCenter(editor: SketchEditorInput, ids: readonly string[]) {
  const { sketch } = editor;
  const wanted = new Set(
    ids.flatMap(id => {
      const e = sketch?.entities.find(e => e.id === id);
      return !e ? [] : e.type === 'point' ? [e.id] : curvePointIds(e);
    })
  );
  const points = sketch?.entities.filter(e => e.type === 'point' && wanted.has(e.id)) ?? [];
  const xs = points.flatMap(e => (e.type === 'point' ? [e.x] : [])),
    ys = points.flatMap(e => (e.type === 'point' ? [e.y] : []));
  return xs.length ? { x: (Math.min(...xs) + Math.max(...xs)) / 2, y: (Math.min(...ys) + Math.max(...ys)) / 2 } : { x: 0, y: 0 };
}

export function editSketchPattern(editor: SketchEditorInput, id: string) {
  const {
    sketch,
    chooseTool,
    setPatternEditId,
    patternCommandId,
    setLinearParameters,
    setCircularParameters,
    lengthUnit,
    setSelected,
    setMessage,
  } = editor;
  const pattern = sketch?.constraints.find(c => c.id === id);
  if (pattern?.type !== 'linearPattern' && pattern?.type !== 'circularPattern') return;
  chooseTool(pattern.type);
  setPatternEditId(id);
  patternCommandId.current = id;
  if (pattern.type === 'linearPattern') setLinearParameters(linearPatternParameters(pattern, lengthUnit));
  else setCircularParameters(circularPatternParameters(pattern, sketch!, lengthUnit));
  setSelected(editablePatternSources(pattern));
  setMessage('Edit the pattern counts, spacing or direction. Deleted instances remain excluded.');
}

export function acceptSketchSlot(editor: SketchEditorInput) {
  const { slotPreview, setMessage, changeSketch, setSharedSlotWidth, setSelected, svg } = editor;
  if (!slotPreview?.ok) return setMessage(slotPreview?.message ?? 'Select source curves for a slot.');
  const group = slotPreview.sketch.constraints.find(c => c.id === slotPreview.slotId);
  changeSketch(slotPreview.sketch);
  if (group?.type === 'slot') setSharedSlotWidth(group.widthEntityId);
  setSelected([]);
  setMessage('Slot created. Select more source curves to share its width, or press Escape.');
  svg.current?.focus();
}

export function acceptSketchTransform(editor: SketchEditorInput) {
  const { transformPreview, setMessage, changeSketch, chooseTool, setSelected, setTransformNotice } = editor;
  if (!transformPreview?.ok) return setMessage(transformPreview?.message ?? 'Select geometry to transform.');
  if (transformPreview.changed) changeSketch(transformPreview.sketch);
  const ids = transformPreview.entityIds,
    released = transformPreview.releasedConstraintIds.length;
  chooseTool('select');
  setSelected(ids);
  if (released) setTransformNotice(`${released} external or directed relations were released by the transform.`);
  setMessage(transformPreview.changed ? 'Transform applied.' : 'Transform closed without changes.');
}

export function openSketchContext(editor: SketchEditorInput, target: SketchContextTarget, position: Point) {
  const {
    sketch,
    busy,
    drag,
    annotationDrag,
    dimensionSelection,
    selectedConstraints,
    chooseTool,
    setSelected,
    setSelectedConstraints,
    setContextMenu,
  } = editor;
  if (!sketch || busy || drag.current || annotationDrag.current) return;
  const context = createSketchContext(sketch, target, position, { entityIds: dimensionSelection, constraintIds: selectedConstraints });
  chooseTool('select');
  setSelected([...context.entityIds]);
  setSelectedConstraints([...context.constraintIds]);
  setContextMenu(context);
}

/** The context menu opened from the keyboard, at the middle of what's selected, or of the canvas when nothing is. */
export function keyboardSketchContext(editor: SketchEditorInput) {
  const { sketch, svg, dimensionSelection, selectedConstraints } = editor;
  if (!sketch || !svg.current) return;
  const target = selectedSketchContextTarget(sketch, { entityIds: dimensionSelection, constraintIds: selectedConstraints });
  const element =
    target.kind === 'blank'
      ? svg.current
      : (svg.current.querySelector(
          `[${target.kind === 'dimension' ? 'data-dimension' : target.kind === 'constraint' ? 'data-constraint-id' : 'data-entity-id'}="${CSS.escape(target.id)}"]`
        ) ?? svg.current);
  const bounds = element.getBoundingClientRect();
  openSketchContext(editor, target, { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 });
}

export function toggleSketchFix(editor: SketchEditorInput) {
  const { sketch, selected, chooseTool, setFixMode, setMessage, svg } = editor;
  if (!sketch) return;
  if (!selected.length) {
    chooseTool('select');
    setFixMode(true);
    setMessage('Click geometry to fix or unfix it. Escape ends Fix.');
    svg.current?.focus();
    return;
  }
  fixSketchGeometry(editor, selected);
}

/** Fixes the points of `targets`, or unfixes them when they are all fixed already. */
export function fixSketchGeometry(editor: SketchEditorInput, targets: string[]) {
  const { sketch, fixMode, changeSketch, setMessage } = editor;
  if (!sketch) return;
  const result = toggleFixed(sketch, targets, fixMode);
  if (result.sketch) changeSketch(result.sketch);
  setMessage(result.message);
}

export function toggleSketchConstruction(editor: SketchEditorInput) {
  const { sketch, selected, setMessage, changeSketch, setConstruction } = editor;
  if (sketch && selected.length) {
    const next = toggleContextConstruction(sketch, selected);
    if (next === sketch)
      setMessage('Spline tangent handles remain construction geometry. Select the curve to change its construction state.');
    else changeSketch(next);
  } else setConstruction(value => !value);
}

/** `u`: the picked edges become the sketch's own, fixed where they are, to draw and constrain against. */
export function takeSketchEdges(editor: SketchEditorInput, keys: string[]) {
  const { sketch, sketchBackdrop, documentRef, part, partEdges, setUseNotice, changeSketch, setPickedEdges, setSelected } = editor;
  if (!sketch) return;
  const source = sketchBackdrop?.document ?? documentRef.current,
    frame = part && cadSketchFrame(documentRef.current, part);
  const used = addUsedPartEdges(sketch, partEdges, keys, source, frame, part?.id);
  if (used.problem) return setUseNotice(used.problem);
  setUseNotice(null);
  changeSketch(used.sketch);
  setPickedEdges([]);
  setSelected(used.selected);
}

/** A double click on the canvas ends a spline, or opens a conic's rho to edit. */
export function sketchDoubleClick(editor: SketchEditorInput, event: MouseEvent<SVGSVGElement>) {
  const { tool, sketch, setRho, setConicEditing } = editor;
  if (tool === 'spline' || tool === 'bezier') {
    event.preventDefault();
    finishSketchSpline(editor, false);
    return;
  }
  if (tool !== 'select' || !sketch) return;
  const id = (event.target as Element).closest('[data-entity-id]')?.getAttribute('data-entity-id');
  const curve = sketch.entities.find(entity => entity.id === id);
  if (curve?.type === 'conic') {
    event.preventDefault();
    setRho(String(curve.rho));
    setConicEditing(curve.id);
  }
}
