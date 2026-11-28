import { useRef, useState } from 'react';
import type { CadLengthUnit, CadPoint } from '@wbcnc/cad';
import { idleModificationWorkflow, type ModificationWorkflow } from '@wbcnc/cad-editor/modificationWorkflow';
import type { Point } from './cadEditorShared';
import { initialCircularPatternParameters } from './circularPatternParameters';
import { initialLinearPatternParameters, type LinearPatternParameters } from './linearPatternParameters';
import { initialTransformParameters } from './transformParameters';

/**
 * The values the open sketch's commands are set up with, and the fields they're typed in: the polygon's sides, a
 * shape's size, the slot's width, the patterns, Transform, Split, Chamfer, Fillet, the curve modifications and the
 * conic's rho. CadEditor keeps the fields it focuses itself, and hands these on by their names to the command handlers, previews and controls.
 */
export function useSketchCommandState(lengthText: (value: number) => string, lengthUnit: CadLengthUnit) {
  const [polygonSides, setPolygonSides] = useState('6');
  const polygonCountGesture = useRef<{ sides: number; radius: number } | null>(null);
  const [width, setWidth] = useState(lengthText(100));
  const [height, setHeight] = useState(lengthText(60));
  const [radius, setRadius] = useState(lengthText(10));
  const [slotWidth, setSlotWidth] = useState(lengthText(10));
  const [slotChain, setSlotChain] = useState(false);
  const [sharedSlotWidth, setSharedSlotWidth] = useState<string | undefined>();
  const slotWidthField = useRef<HTMLInputElement>(null);
  const [circularParameters, setCircularParameters] = useState(initialCircularPatternParameters);
  const circularFields = useRef<Partial<Record<'count' | 'angle', HTMLInputElement>>>({});
  const [linearParameters, setLinearParameters] = useState(() => initialLinearPatternParameters(lengthUnit));
  const [patternEditId, setPatternEditId] = useState<string | null>(null);
  const [patternNotice, setPatternNotice] = useState('');
  const patternCommandId = useRef('');
  const patternFields = useRef<Partial<Record<Exclude<keyof LinearPatternParameters, 'secondDirection'>, HTMLInputElement>>>({});
  const [transformParameters, setTransformParameters] = useState(() => initialTransformParameters(undefined, lengthUnit));
  const [transformNotice, setTransformNotice] = useState('');
  const [splitNotice, setSplitNotice] = useState('');
  const [splitFirst, setSplitFirst] = useState<{ entityId: string; parameter: number; point: CadPoint } | null>(null);
  const [chamferDistances, setChamferDistances] = useState([lengthText(10), lengthText(10)]);
  const [filletRadius, setFilletRadius] = useState(lengthText(10));
  const [filletEditing, setFilletEditing] = useState(false);
  const offsetInput = useRef<HTMLInputElement>(null);
  const [modification, setModification] = useState<ModificationWorkflow>(idleModificationWorkflow);
  const [hoveredModifyCurve, setHoveredModifyCurve] = useState<string | null>(null);
  const [modifyTarget, setModifyTarget] = useState<Point | null>(null);
  const [conicEditing, setConicEditing] = useState<string | null>(null);
  const [rho, setRho] = useState('0.5');
  return {
    polygonSides,
    setPolygonSides,
    polygonCountGesture,
    width,
    setWidth,
    height,
    setHeight,
    radius,
    setRadius,
    slotWidth,
    setSlotWidth,
    slotChain,
    setSlotChain,
    sharedSlotWidth,
    setSharedSlotWidth,
    slotWidthField,
    circularParameters,
    setCircularParameters,
    circularFields,
    linearParameters,
    setLinearParameters,
    patternEditId,
    setPatternEditId,
    patternNotice,
    setPatternNotice,
    patternCommandId,
    patternFields,
    transformParameters,
    setTransformParameters,
    transformNotice,
    setTransformNotice,
    splitNotice,
    setSplitNotice,
    splitFirst,
    setSplitFirst,
    chamferDistances,
    setChamferDistances,
    filletRadius,
    setFilletRadius,
    filletEditing,
    setFilletEditing,
    offsetInput,
    modification,
    setModification,
    hoveredModifyCurve,
    setHoveredModifyCurve,
    modifyTarget,
    setModifyTarget,
    conicEditing,
    setConicEditing,
    rho,
    setRho,
  };
}

export type SketchCommandState = ReturnType<typeof useSketchCommandState>;
