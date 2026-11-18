import type { CSSProperties, PointerEvent, RefObject } from 'react';
import { drawnOnOutline, type CadDimension, type CadSketchSolveStatus } from '@wbcnc/cad';
import { associatedEntityIds } from '@wbcnc/cad-editor/inlineConstraintLayout';
import type { CadDrawingInference } from '@wbcnc/cad-editor/drawingInference';
import { numeric, type NumericConstraint, type Point } from './cadEditorShared';
import type { CircularPatternParameters } from './circularPatternParameters';
import type { LinearPatternParameters } from './linearPatternParameters';
import type { TransformParameters } from './transformParameters';
import type { CadSelectionBox } from './boxSelection';
import { chainGeometry, type HandleDrag } from './editorGestures';
import { CutOverlay } from './CutOverlay';
import { DimensionGraphics } from './DimensionGraphics';
import { DrawingInferencePreview } from './DrawingInferencePreview';
import { InlineConstraints } from './inlineConstraints';
import { ModificationPreview } from './ModificationPreview';
import { PartReferenceGeometry } from './PartReferenceGeometry';
import {
  SketchChamferHandles,
  SketchCornerErrors,
  SketchExtendEndpoint,
  SketchRemoveCurveLabel,
  SketchSelectionBox,
  SketchSnapCue,
  SketchSplitMark,
} from './SketchCanvasMarks';
import { SketchCircularPatternManipulator } from './SketchCircularPatternControls';
import { SketchGeometry } from './SketchGeometry';
import { SketchLinearPatternGuides, SketchLinearPatternManipulator } from './SketchLinearPatternControls';
import { SketchRegion } from './SketchRegion';
import { SketchSlotWidthHandle } from './SketchSlotControls';
import { SketchToolPreview } from './SketchToolPreview';
import { SketchTransformManipulator } from './SketchTransformControls';
import { draftLabelAt } from './draftLabelAt';
import { openPatternField } from './openPatternField';
import { sketchPointAtClient } from './sketchViewport';
import { startCircularPatternDrag } from './circularPatternDrag';
import type { SketchEditorInput } from './sketchEditorInput';
import type { useSketchCommandPreviews } from './useSketchCommandPreviews';
import { drawingMatrix, straightOn } from './sketchOrbit';

type Previews = ReturnType<typeof useSketchCommandPreviews>;

export type SketchDrawingProps = Pick<
  SketchEditorInput,
  | 'centerArcSweep'
  | 'chain'
  | 'chamferDistances'
  | 'chamferPreview'
  | 'constraintMode'
  | 'construction'
  | 'cursor'
  | 'dimensionFlow'
  | 'dimensionSelection'
  | 'doc'
  | 'drawingGroup'
  | 'editDimension'
  | 'editPattern'
  | 'faceSketch'
  | 'fixMode'
  | 'inference'
  | 'markerScale'
  | 'modification'
  | 'offsetPreview'
  | 'parsedCircular'
  | 'parsedLinear'
  | 'part'
  | 'partEdges'
  | 'pending'
  | 'pickedEdges'
  | 'placingDimension'
  | 'polygonSides'
  | 'selectDimension'
  | 'selected'
  | 'setConicEditing'
  | 'setDimension'
  | 'setHoveredConstraintEntities'
  | 'setMessage'
  | 'setRho'
  | 'setSelected'
  | 'setSelectedConstraints'
  | 'shownSketch'
  | 'sketch'
  | 'sketchBackdrop'
  | 'sketchTurn'
  | 'solving'
  | 'splitFirst'
  | 'svg'
  | 'tangentAxis'
  | 'tool'
  | 'view'
> &
  Pick<
    Previews,
    | 'annotationSketch'
    | 'cornerPreview'
    | 'curvePreview'
    | 'extendPreview'
    | 'linearPreview'
    | 'mirrorPreview'
    | 'modificationPreview'
    | 'parsedTransform'
    | 'patternAnchor'
    | 'slotPreview'
    | 'slotWidthCenter'
    | 'slotWidthCircle'
    | 'transformPreview'
  > & {
    activeSketchStatus: CadSketchSolveStatus | undefined;
    circularFields: RefObject<Partial<Record<'count' | 'angle', HTMLInputElement>>>;
    circularParameters: CircularPatternParameters;
    dimensionDraft: CadDimension | null;
    drawingCue: CadDrawingInference | null;
    entityStatus: CadSketchSolveStatus['entityStatus'] | undefined;
    grid: number;
    hoveredConstraintEntities: string[];
    hoveredPoint: string | null;
    lastCheckedRevision: RefObject<string>;
    linearParameters: LinearPatternParameters;
    offsetDimension: NumericConstraint | undefined;
    patternFields: RefObject<Partial<Record<Exclude<keyof LinearPatternParameters, 'secondDirection'>, HTMLInputElement>>>;
    selectedConstraints: string[];
    selectionBox: CadSelectionBox | null;
    showConstraints: boolean;
    shownConflicts: string[];
    sketchCameraShift: [number, number];
    slotWidth: string;
    snapCue: { point: Point; label: string } | null;
    startAnnotationDrag: (id: string, event: PointerEvent<SVGGElement>) => void;
    startHandleDrag: (event: { pointerId: number }, gesture: HandleDrag) => void;
    stroke: string;
    transformParameters: TransformParameters;
    turned: boolean;
  };

/** The open sketch's drawing inside the canvas: grid, axes, geometry, dimensions, command handles and previews. */
export function SketchDrawing({
  activeSketchStatus,
  annotationSketch,
  centerArcSweep,
  chain,
  chamferDistances,
  chamferPreview,
  circularFields,
  circularParameters,
  constraintMode,
  construction,
  cornerPreview,
  cursor,
  curvePreview,
  dimensionDraft,
  dimensionFlow,
  dimensionSelection,
  doc,
  drawingCue,
  drawingGroup,
  editDimension,
  editPattern,
  entityStatus,
  extendPreview,
  faceSketch,
  fixMode,
  grid,
  hoveredConstraintEntities,
  hoveredPoint,
  inference,
  lastCheckedRevision,
  linearParameters,
  linearPreview,
  markerScale,
  mirrorPreview,
  modification,
  modificationPreview,
  offsetDimension,
  offsetPreview,
  parsedCircular,
  parsedLinear,
  parsedTransform,
  part,
  partEdges,
  patternAnchor,
  patternFields,
  pending,
  pickedEdges,
  placingDimension,
  polygonSides,
  selectDimension,
  selected,
  selectedConstraints,
  selectionBox,
  setConicEditing,
  setDimension,
  setHoveredConstraintEntities,
  setMessage,
  setRho,
  setSelected,
  setSelectedConstraints,
  showConstraints,
  shownConflicts,
  shownSketch,
  sketch,
  sketchBackdrop,
  sketchCameraShift,
  sketchTurn,
  slotPreview,
  slotWidth,
  slotWidthCenter,
  slotWidthCircle,
  snapCue,
  solving,
  splitFirst,
  startAnnotationDrag,
  startHandleDrag,
  stroke,
  svg,
  tangentAxis,
  tool,
  transformParameters,
  transformPreview,
  turned,
  view,
}: SketchDrawingProps) {
  const canEditCanvasDimensions =
    !constraintMode && !fixMode && dimensionFlow.phase === 'idle' && (tool === 'select' || tool === 'dimension');
  // The face a part is drawn on, outlined on its drawing so it can be traced and lined up with.
  const drawnOnFace = part ? drawnOnOutline(doc, part) : null;
  const chainPreview = sketch && chainGeometry(sketch, chain);
  // The parts' edges the drawing shows: all of them looking straight at the plane, and once turned, those in it, the
  // only ones that still line up with what's seen.
  const shownEdges = sketchBackdrop ? partEdges.filter(edge => edge.onPlane || sketchTurn === straightOn) : [];
  // A turned sketch turns about the middle of the view.
  const [ta, tb, tc, td] = drawingMatrix(sketchTurn);
  const middle = { x: view.x + view.w / 2, y: view.y + view.h / 2 };
  const turnTransform = `translate(${middle.x + sketchCameraShift[0]} ${middle.y + sketchCameraShift[1]}) matrix(${ta} ${tb} ${tc} ${td} 0 0) translate(${-middle.x} ${-middle.y})`;
  const turnDet = ta * td - tb * tc || 1;
  // Labels and points are turned back where they stand, to read and look the same from any side.
  const unturn = `matrix(${td / turnDet}, ${-tb / turnDet}, ${-tc / turnDet}, ${ta / turnDet}, 0, 0)`;
  return (
    // A turned sketch is turned inside the drawing, not as a whole, so its lines keep their width and its labels
    // and points their shape, however far it's turned.
    <g
      ref={drawingGroup}
      data-testid="cad-drawing"
      className={turned ? 'cad-drawing-turned' : undefined}
      transform={turned ? turnTransform : undefined}
      style={turned ? ({ '--unturn': unturn } as CSSProperties) : undefined}>
      <defs>
        <pattern id={`cad-grid-${doc.id}`} width={grid} height={grid} patternUnits="userSpaceOnUse">
          <circle cx="0" cy="0" r={grid * 0.025} fill="#ccd5df" />
        </pattern>
      </defs>
      <rect x={view.x - view.w} y={view.y - view.h} width={view.w * 3} height={view.h * 3} fill={`url(#cad-grid-${doc.id})`} />
      {shownEdges.length > 0 && <PartReferenceGeometry edges={shownEdges} picked={pickedEdges} pixelScale={markerScale} />}
      <SketchRegion
        document={doc}
        partId={part?.id}
        verified={
          !solving &&
          !splitFirst &&
          !((tool === 'slot' || tool === 'transform' || tool === 'linearPattern' || tool === 'circularPattern') && selected.length) &&
          !((tool === 'slot' || tool === 'fillet' || tool === 'chamfer' || tool === 'transform') && selected.length) &&
          activeSketchStatus?.status === 'solved' &&
          lastCheckedRevision.current === `${doc.id}:${doc.revision}`
        }
      />
      {faceSketch && (
        <path
          data-face-outline
          className="cad-face-outline"
          d={faceSketch.outline.map((p, i) => `${i ? 'L' : 'M'}${p.x} ${-p.y}`).join(' ') + ' Z'}
          pointerEvents="none"
        />
      )}
      {!faceSketch && drawnOnFace && (
        <path
          data-drawn-on-face
          className="cad-face-outline"
          d={drawnOnFace.map((p, i) => `${i ? 'L' : 'M'}${p.x} ${-p.y}`).join(' ') + ' Z'}
          pointerEvents="none"
        />
      )}
      {faceSketch?.floor && (
        <path
          data-face-floor
          d={faceSketch.floor.map((p, i) => `${i ? 'L' : 'M'}${p.x} ${-p.y}`).join(' ') + ' Z'}
          fill="#c99a5b"
          fillOpacity={0.25}
          stroke="#7a5526"
          strokeWidth={1 / markerScale}
          pointerEvents="none"
        />
      )}
      {!faceSketch && <CutOverlay part={part} millimetresPerPixel={1 / markerScale} />}
      <line
        x1={view.x - view.w}
        x2={view.x + view.w * 2}
        y1="0"
        y2="0"
        pointerEvents="none"
        stroke="#db9d9d"
        strokeWidth="1"
        vectorEffect="non-scaling-stroke"
      />
      <line
        x1="0"
        x2="0"
        y1={view.y - view.h}
        y2={view.y + view.h * 2}
        pointerEvents="none"
        stroke="#92bfa2"
        strokeWidth="1"
        vectorEffect="non-scaling-stroke"
      />
      {shownSketch && (
        <SketchGeometry
          entities={shownSketch.entities}
          selectedIds={[
            ...dimensionSelection,
            ...hoveredConstraintEntities,
            ...selectedConstraints.flatMap(id => associatedEntityIds(sketch, id)),
          ]}
          stroke={cornerPreview?.ok || transformPreview?.ok || linearPreview?.ok || slotPreview?.ok ? '#858d96' : stroke}
          entityStatus={entityStatus}
          pixelScale={markerScale}
          hoveredPointId={hoveredPoint}
          interactive={tool === 'select' && !constraintMode && !fixMode && !placingDimension}
          onEditConic={id => {
            const curve = sketch?.entities.find(entity => entity.id === id);
            if (curve?.type === 'conic') {
              setRho(String(curve.rho));
              setConicEditing(id);
            }
          }}
        />
      )}
      {tool === 'slot' && slotWidthCircle?.type === 'circle' && slotWidthCenter?.type === 'point' && (
        <SketchSlotWidthHandle
          center={slotWidthCenter}
          radius={slotWidthCircle.radius}
          pixelScale={markerScale}
          onStart={event => {
            startHandleDrag(event, { tool: 'slot', center: slotWidthCenter, width: slotWidth });
            svg.current?.focus();
          }}
        />
      )}
      {tool === 'circularPattern' && selected.length > 0 && parsedCircular.ok && linearPreview?.ok && (
        <SketchCircularPatternManipulator
          center={parsedCircular.center}
          anchor={patternAnchor}
          count={parsedCircular.count}
          angle={parsedCircular.angle}
          closed={parsedCircular.closed}
          pixelScale={markerScale}
          onEdit={field => {
            circularFields.current[field]?.focus();
            circularFields.current[field]?.select();
          }}
          onStart={(kind, event) =>
            startCircularPatternDrag(kind, event, drawingGroup.current ?? svg.current, parsedCircular, circularParameters, startHandleDrag)
          }
        />
      )}
      {sketch && tool !== 'linearPattern' && <SketchLinearPatternGuides sketch={sketch} pixelScale={markerScale} onEdit={editPattern} />}
      {tool === 'linearPattern' && selected.length > 0 && parsedLinear.ok && (
        <SketchLinearPatternManipulator
          anchor={patternAnchor}
          steps={[parsedLinear.stepX, parsedLinear.stepY]}
          counts={[parsedLinear.countX, linearParameters.secondDirection ? parsedLinear.countY : 1]}
          bound={[!!parsedLinear.expressions?.countX, !!parsedLinear.expressions?.countY]}
          pixelScale={markerScale}
          onStart={(index, event) =>
            startHandleDrag(event, { tool: 'linearPattern', index, anchor: patternAnchor, parameters: linearParameters })
          }
          onEdit={(field, chip) => openPatternField(patternFields.current[field], chip)}
        />
      )}
      {tool === 'transform' && selected.length > 0 && parsedTransform.ok && (
        <SketchTransformManipulator
          pivot={{
            x: parsedTransform.pivot.x + parsedTransform.translation.x,
            y: parsedTransform.pivot.y + parsedTransform.translation.y,
          }}
          pixelScale={markerScale}
          onStart={(kind, event) => {
            const start = sketchPointAtClient(event, drawingGroup.current ?? svg.current);
            if (start) startHandleDrag(event, { tool: 'transform', kind, start, parameters: transformParameters });
          }}
        />
      )}
      {tool === 'split' && splitFirst && <SketchSplitMark point={splitFirst.point} pixelScale={markerScale} />}
      {tool === 'chamfer' && chamferPreview?.ok && (
        <SketchChamferHandles preview={chamferPreview} distances={chamferDistances} pixelScale={markerScale} onStart={startHandleDrag} />
      )}
      {(tool === 'fillet' || tool === 'chamfer') && cornerPreview && !cornerPreview.ok && (
        <SketchCornerErrors sketch={sketch} cornerPointIds={cornerPreview.cornerPointIds} pixelScale={markerScale} />
      )}
      {annotationSketch && showConstraints && (
        <InlineConstraints
          sketch={annotationSketch}
          scale={markerScale}
          selectedConstraintIds={selectedConstraints}
          conflictedConstraintIds={shownConflicts}
          interactive={tool === 'select' && !constraintMode && !fixMode && !placingDimension}
          onSelect={(id, additive) => {
            setSelectedConstraints(previous =>
              additive ? (previous.includes(id) ? previous.filter(existing => existing !== id) : [...previous, id]) : [id]
            );
            if (!additive) setSelected([]);
            setDimension(null);
            setMessage('Constraint selected. Press Delete to remove it; Undo restores it.');
            svg.current?.focus();
          }}
          onHover={(_id, ids) => setHoveredConstraintEntities(ids)}
          onEdit={editPattern}
        />
      )}
      {annotationSketch &&
        annotationSketch.constraints
          .filter(numeric)
          .map(c => (
            <DimensionGraphics
              key={c.id}
              constraint={c}
              sketch={annotationSketch}
              pixelScale={markerScale}
              selected={
                selectedConstraints.includes(c.id) || (dimensionFlow.phase === 'placing' && dimensionFlow.existingConstraintId === c.id)
              }
              conflicted={shownConflicts.includes(c.id)}
              interactive={canEditCanvasDimensions}
              onSelect={additive => selectDimension(c.id, additive)}
              onEdit={() => editDimension(c.id)}
              onLabelPointerDown={event => startAnnotationDrag(c.id, event)}
            />
          ))}
      {sketch && dimensionDraft && (
        <DimensionGraphics
          constraint={dimensionDraft}
          sketch={sketch}
          pixelScale={markerScale}
          position={draftLabelAt(dimensionDraft, cursor, markerScale)}
          selected
          interactive={false}
        />
      )}
      {snapCue && <SketchSnapCue cue={snapCue} pixelScale={markerScale} />}
      {modificationPreview && (
        <ModificationPreview
          sketch={modificationPreview.sketch}
          curveIds={
            offsetPreview?.ok
              ? offsetPreview.entityIds
              : extendPreview?.ok
                ? [extendPreview.entityId]
                : mirrorPreview?.ok
                  ? mirrorPreview.createdEntityIds
                  : []
          }
          pixelScale={markerScale}
        />
      )}
      {offsetDimension && offsetPreview?.ok && (
        <DimensionGraphics
          constraint={offsetDimension}
          sketch={offsetPreview.sketch}
          pixelScale={markerScale}
          interactive={false}
          showLabel={false}
        />
      )}
      {modification.phase === 'extend' && modification.entityId && sketch && (
        <SketchExtendEndpoint sketch={sketch} entityId={modification.entityId} end={modification.end} pixelScale={markerScale} />
      )}
      {extendPreview?.ok && extendPreview.kind === 'delete' && <SketchRemoveCurveLabel cursor={cursor} pixelScale={markerScale} />}
      <SketchToolPreview
        tool={tool}
        pending={pending}
        cursor={cursor}
        curvePreview={curvePreview}
        tangent={chainPreview?.tangent}
        polygonSides={Number(polygonSides)}
        sweepIntent={centerArcSweep.current?.sweep}
        pixelScale={markerScale}
        construction={construction}
      />
      {sketch && drawingCue && (
        <DrawingInferencePreview
          inference={drawingCue}
          orientation={inference.current}
          axis={tangentAxis.current}
          start={chainPreview?.point ?? pending[0]}
          sketch={sketch}
          pixelScale={markerScale}
        />
      )}
      {selectionBox && <SketchSelectionBox box={selectionBox} />}
    </g>
  );
}
