import type { RefObject } from 'react';
import { useMemo } from 'react';
import {
  addBezier,
  addConic,
  addSpline,
  chamferLineCorners,
  circularPatternSketchEntities,
  extendSketchCurve,
  filletLineCorners,
  linearPatternSketchEntities,
  mirrorSketchEntities,
  offsetSketch,
  resolveChamferCorners,
  resolveFilletCorners,
  tessellateCurve,
  transformSketchEntities,
  type CadLengthUnit,
  type CadSketch,
} from '@wbcnc/cad';
import type { ModificationWorkflow } from '@wbcnc/cad-editor/modificationWorkflow';
import type { Point, Tool } from './cadEditorShared';
import { parseCircularPatternParameters, type CircularPatternParameters } from './circularPatternParameters';
import type { useDesignUnits } from './designUnits';
import { pointsOf } from './fitSketchView';
import { linearPatternAnchor, parseLinearPatternParameters, type LinearPatternParameters } from './linearPatternParameters';
import { previewSlot } from './slotPreview';
import { parseTransformParameters, type TransformParameters } from './transformParameters';
import type { useEditorVariableFields } from './useEditorVariableFields';

/** What the open sketch's command previews read from the editor. */
export interface SketchCommandPreviewInput {
  sketch: CadSketch;
  tool: Tool;
  selected: string[];
  construction: boolean;
  lengthUnit: CadLengthUnit;
  variableScope: ReturnType<typeof useEditorVariableFields>;
  parseCadValue: ReturnType<typeof useDesignUnits>['parseCadValue'];
  markerScale: number;
  filletRadius: string;
  chamferDistances: string[];
  transformParameters: TransformParameters;
  circularParameters: CircularPatternParameters;
  linearParameters: LinearPatternParameters;
  patternEditId: string | null;
  patternCommandId: RefObject<string>;
  slotWidth: string;
  slotChain: boolean;
  sharedSlotWidth: string | undefined;
  modification: ModificationWorkflow;
  modifyTarget: Point | null;
  hoveredModifyCurve: string | null;
  pending: Point[];
  cursor: Point;
  rho: string;
}

/**
 * The previews of the open sketch's commands: fillet and chamfer corners, transform, patterns, slots, the
 * modification tools and curves being drawn, with the sketch each shows in place of the drawn one.
 */
export function useSketchCommandPreviews({
  sketch,
  tool,
  selected,
  construction,
  lengthUnit,
  variableScope,
  parseCadValue,
  markerScale,
  filletRadius,
  chamferDistances,
  transformParameters,
  circularParameters,
  linearParameters,
  patternEditId,
  patternCommandId,
  slotWidth,
  slotChain,
  sharedSlotWidth,
  modification,
  modifyTarget,
  hoveredModifyCurve,
  pending,
  cursor,
  rho,
}: SketchCommandPreviewInput) {
  const filletSelection = useMemo(
    () => (sketch && tool === 'fillet' ? resolveFilletCorners(sketch, selected) : null),
    [sketch, tool, selected]
  );
  const filletPreview = useMemo(() => {
    if (!sketch || !filletSelection?.ok) return null;
    const radius = parseCadValue(filletRadius, { unit: 'mm', variables: variableScope });
    return 'error' in radius
      ? { ok: false as const, message: radius.error, cornerPointIds: filletSelection.cornerPointIds }
      : filletLineCorners(sketch, { cornerPointIds: filletSelection.cornerPointIds, radius: radius.value });
  }, [sketch, filletSelection, filletRadius, variableScope, parseCadValue]);
  const chamferSelection = useMemo(
    () => (sketch && tool === 'chamfer' ? resolveChamferCorners(sketch, selected) : null),
    [sketch, tool, selected]
  );
  const chamferPreview = useMemo(() => {
    if (!sketch || !chamferSelection?.ok) return null;
    const values = chamferDistances.map(value => parseCadValue(value, { unit: 'mm', variables: variableScope }));
    const error = values.find(value => 'error' in value);
    return error && 'error' in error
      ? { ok: false as const, message: error.error, cornerPointIds: chamferSelection.cornerPointIds }
      : chamferLineCorners(sketch, {
          cornerPointIds: chamferSelection.cornerPointIds,
          distanceA: (values[0] as { value: number }).value,
          distanceB: (values[1] as { value: number }).value,
          selectedLineIds: selected,
        });
  }, [sketch, chamferSelection, chamferDistances, selected, variableScope, parseCadValue]);
  const cornerPreview = tool === 'chamfer' ? chamferPreview : filletPreview;
  const parsedTransform = useMemo(() => parseTransformParameters(transformParameters, lengthUnit), [transformParameters, lengthUnit]);
  const transformPreview = useMemo(() => {
    if (!sketch || tool !== 'transform' || !selected.length) return null;
    return parsedTransform.ok ? transformSketchEntities(sketch, { ...parsedTransform, entityIds: selected }) : parsedTransform;
  }, [sketch, tool, selected, parsedTransform]);
  const parsedCircular = useMemo(() => parseCircularPatternParameters(circularParameters, lengthUnit), [circularParameters, lengthUnit]);
  const parsedLinear = useMemo(
    () => parseLinearPatternParameters(linearParameters, variableScope, lengthUnit),
    [linearParameters, variableScope, lengthUnit]
  );
  const linearPreview = useMemo(() => {
    if (!sketch || !selected.length) return null;
    if (tool === 'circularPattern')
      return parsedCircular.ok
        ? circularPatternSketchEntities(sketch, {
            ...parsedCircular,
            entityIds: selected,
            patternId: patternEditId ?? patternCommandId.current,
            previewLimit: 9,
          })
        : parsedCircular;
    if (tool !== 'linearPattern') return null;
    return parsedLinear.ok
      ? linearPatternSketchEntities(sketch, {
          ...parsedLinear,
          entityIds: selected,
          patternId: patternEditId ?? patternCommandId.current,
          previewLimit: 9,
        })
      : parsedLinear;
  }, [sketch, tool, selected, patternEditId, patternCommandId, parsedLinear, parsedCircular]);
  const patternAnchor = useMemo(() => (sketch ? linearPatternAnchor(sketch, selected) : { x: 0, y: 0 }), [sketch, selected]);
  const slotPreview = useMemo(
    () =>
      sketch && tool === 'slot' && selected.length
        ? previewSlot(sketch, selected, slotWidth, slotChain, sharedSlotWidth, lengthUnit)
        : null,
    [sketch, tool, selected, slotWidth, slotChain, sharedSlotWidth, lengthUnit]
  );
  const slotWidthCircle = slotPreview?.ok
    ? slotPreview.sketch.entities.find(
        e =>
          e.type === 'circle' &&
          slotPreview.sketch.constraints.some(c => c.type === 'slot' && c.id === slotPreview.slotId && c.widthEntityId === e.id)
      )
    : undefined;
  const slotWidthCenter =
    slotWidthCircle?.type === 'circle' && slotPreview?.ok
      ? slotPreview.sketch.entities.find(e => e.id === slotWidthCircle.centerId)
      : undefined;
  const shownSketch = slotPreview?.ok
    ? slotPreview.sketch
    : linearPreview?.ok
      ? linearPreview.sketch
      : transformPreview?.ok
        ? transformPreview.sketch
        : cornerPreview?.ok
          ? cornerPreview.sketch
          : sketch;
  const annotationSketch = slotPreview?.ok
    ? slotPreview.sketch
    : linearPreview?.ok
      ? linearPreview.sketch
      : transformPreview?.ok
        ? transformPreview.sketch
        : sketch;
  const offsetPreview = useMemo(() => {
    if (!sketch || modification.phase !== 'offset' || !modification.entityIds.length) return null;
    const parsed = parseCadValue(modification.text, { unit: 'mm', variables: variableScope });
    return 'error' in parsed
      ? { ok: false as const, message: parsed.error }
      : offsetSketch(sketch, { entityIds: modification.entityIds, value: parsed.value });
  }, [sketch, modification, variableScope, parseCadValue]);
  const extendPreview = useMemo(
    () =>
      sketch && modification.phase === 'extend' && modification.entityId && modification.end && modifyTarget
        ? extendSketchCurve(sketch, {
            entityId: modification.entityId,
            end: modification.end,
            target: modifyTarget,
            boundaryId: hoveredModifyCurve && hoveredModifyCurve !== modification.entityId ? hoveredModifyCurve : undefined,
          })
        : null,
    [sketch, modification, modifyTarget, hoveredModifyCurve]
  );
  const mirrorPreview = useMemo(
    () =>
      sketch && modification.phase === 'mirror' && modification.picking === 'axis' && modification.entityIds.length && hoveredModifyCurve
        ? mirrorSketchEntities(sketch, { entityIds: modification.entityIds, axisId: hoveredModifyCurve })
        : null,
    [sketch, modification, hoveredModifyCurve]
  );
  const modificationPreview = offsetPreview?.ok
    ? offsetPreview
    : extendPreview?.ok
      ? extendPreview
      : mirrorPreview?.ok
        ? mirrorPreview
        : null;
  const curvePreview = useMemo(() => {
    if (!sketch || !pending.length || !['conic', 'spline', 'bezier'].includes(tool)) return null;
    const locations = [...pending];
    if (Math.hypot(cursor.x - locations.at(-1)!.x, cursor.y - locations.at(-1)!.y) > 1e-7) locations.push(cursor);
    if (locations.length < 2) return null;
    try {
      const parsedRho = parseCadValue(rho, { unit: 'scalar' });
      if (tool === 'conic' && 'error' in parsedRho) return locations;
      const preview =
        tool === 'conic'
          ? locations[2]
            ? addConic(sketch, {
                start: locations[0]!,
                end: locations[1]!,
                control: locations[2]!,
                rho: 'value' in parsedRho ? parsedRho.value : 0.5,
                construction,
              })
            : null
          : (tool === 'spline' ? addSpline : addBezier)(sketch, { points: locations, construction });
      const curve = preview?.entities.at(-1);
      return curve && curve.type !== 'point' ? tessellateCurve(curve, pointsOf(preview!), 0.25 / markerScale) : locations;
    } catch {
      return locations;
    }
  }, [sketch, pending, cursor, tool, rho, construction, markerScale, parseCadValue]);
  return {
    filletSelection,
    filletPreview,
    chamferSelection,
    chamferPreview,
    cornerPreview,
    parsedTransform,
    transformPreview,
    parsedCircular,
    parsedLinear,
    linearPreview,
    patternAnchor,
    slotPreview,
    slotWidthCircle,
    slotWidthCenter,
    shownSketch,
    annotationSketch,
    offsetPreview,
    extendPreview,
    mirrorPreview,
    modificationPreview,
    curvePreview,
  };
}
