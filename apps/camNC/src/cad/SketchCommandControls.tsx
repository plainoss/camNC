import type { Dispatch, RefObject, SetStateAction } from 'react';
import type { CadLengthUnit } from '@wbcnc/cad';
import type { Tool } from './cadEditorShared';
import type { CircularPatternParameters } from './circularPatternParameters';
import type { LinearPatternParameters } from './linearPatternParameters';
import { SketchCircularPatternControls } from './SketchCircularPatternControls';
import { SketchLinearPatternControls } from './SketchLinearPatternControls';
import { SketchSlotControls } from './SketchSlotControls';
import { SketchTransformControls } from './SketchTransformControls';
import { SketchChamferForm, SketchFilletForm } from './SketchValueForms';
import { parseTransformParameters, repositionTransformPivot, type TransformParameters } from './transformParameters';
import type { useSketchCommandPreviews } from './useSketchCommandPreviews';

type SketchCommandPreviews = ReturnType<typeof useSketchCommandPreviews>;

export interface SketchCommandControlsProps
  extends Pick<
    SketchCommandPreviews,
    | 'slotPreview'
    | 'linearPreview'
    | 'parsedCircular'
    | 'parsedLinear'
    | 'transformPreview'
    | 'chamferPreview'
    | 'chamferSelection'
    | 'filletPreview'
  > {
  tool: Tool;
  selected: string[];
  lengthUnit: CadLengthUnit;
  chooseTool: (next: Tool) => void;
  setSelected: Dispatch<SetStateAction<string[]>>;
  slotWidth: string;
  setSlotWidth: Dispatch<SetStateAction<string>>;
  slotChain: boolean;
  setSlotChain: Dispatch<SetStateAction<boolean>>;
  slotWidthField: RefObject<HTMLInputElement | null>;
  acceptSlot: () => void;
  circularParameters: CircularPatternParameters;
  setCircularParameters: Dispatch<SetStateAction<CircularPatternParameters>>;
  circularFields: RefObject<Partial<Record<'count' | 'angle', HTMLInputElement>>>;
  acceptCircularPattern: () => void;
  linearParameters: LinearPatternParameters;
  setLinearParameters: Dispatch<SetStateAction<LinearPatternParameters>>;
  patternFields: RefObject<Partial<Record<Exclude<keyof LinearPatternParameters, 'secondDirection'>, HTMLInputElement>>>;
  acceptLinearPattern: () => void;
  patternNotice: string;
  transformParameters: TransformParameters;
  setTransformParameters: Dispatch<SetStateAction<TransformParameters>>;
  acceptTransform: () => void;
  transformNotice: string;
  splitNotice: string;
  chamferDistances: string[];
  setChamferDistances: Dispatch<SetStateAction<string[]>>;
  acceptChamfer: () => void;
  filletInput: RefObject<HTMLInputElement | null>;
  filletRadius: string;
  setFilletRadius: Dispatch<SetStateAction<string>>;
  setFilletEditing: Dispatch<SetStateAction<boolean>>;
  acceptFillet: () => void;
}

/** The value panels of the sketch commands that work on a selection: slot, patterns, transform, chamfer and fillet. */
export function SketchCommandControls({
  tool,
  selected,
  lengthUnit,
  chooseTool,
  setSelected,
  slotPreview,
  linearPreview,
  parsedCircular,
  parsedLinear,
  transformPreview,
  chamferPreview,
  chamferSelection,
  filletPreview,
  slotWidth,
  setSlotWidth,
  slotChain,
  setSlotChain,
  slotWidthField,
  acceptSlot,
  circularParameters,
  setCircularParameters,
  circularFields,
  acceptCircularPattern,
  linearParameters,
  setLinearParameters,
  patternFields,
  acceptLinearPattern,
  patternNotice,
  transformParameters,
  setTransformParameters,
  acceptTransform,
  transformNotice,
  splitNotice,
  chamferDistances,
  setChamferDistances,
  acceptChamfer,
  filletInput,
  filletRadius,
  setFilletRadius,
  setFilletEditing,
  acceptFillet,
}: SketchCommandControlsProps) {
  return (
    <>
      {tool === 'slot' && selected.length > 0 && (
        <SketchSlotControls
          width={slotWidth}
          onWidth={setSlotWidth}
          chain={slotChain}
          onChain={setSlotChain}
          inputRef={slotWidthField}
          onApply={acceptSlot}
          onCancel={() => {
            chooseTool('select');
            setSelected([]);
          }}
          error={slotPreview && !slotPreview.ok ? slotPreview.message : undefined}
        />
      )}
      {tool === 'circularPattern' && selected.length > 0 && (
        <SketchCircularPatternControls
          parameters={circularParameters}
          onChange={setCircularParameters}
          onApply={acceptCircularPattern}
          onCancel={() => {
            chooseTool('select');
            setSelected([]);
          }}
          error={linearPreview && !linearPreview.ok ? linearPreview.message : undefined}
          previewLimited={parsedCircular.ok && parsedCircular.count > 10}
          releasedCount={linearPreview?.ok ? linearPreview.releasedConstraintIds.length : 0}
          onField={(key, element) => {
            if (element) circularFields.current[key] = element;
            else delete circularFields.current[key];
          }}
        />
      )}
      {tool === 'linearPattern' && selected.length > 0 && (
        <SketchLinearPatternControls
          parameters={linearParameters}
          onChange={setLinearParameters}
          onApply={acceptLinearPattern}
          onCancel={() => {
            chooseTool('select');
            setSelected([]);
          }}
          error={linearPreview && !linearPreview.ok ? linearPreview.message : undefined}
          releasedCount={linearPreview?.ok ? linearPreview.releasedConstraintIds.length : 0}
          previewLimited={parsedLinear.ok && parsedLinear.countX * parsedLinear.countY > 10}
          onField={(key, element) => {
            if (element) patternFields.current[key] = element;
            else delete patternFields.current[key];
          }}
        />
      )}
      {patternNotice && (
        <div className="cad-create-size" role="status">
          {patternNotice}
        </div>
      )}
      {tool === 'transform' && selected.length > 0 && (
        <SketchTransformControls
          parameters={transformParameters}
          onChange={next => {
            if (next.pivotX !== transformParameters.pivotX || next.pivotY !== transformParameters.pivotY) {
              const parsed = parseTransformParameters(next, lengthUnit);
              setTransformParameters(parsed.ok ? repositionTransformPivot(transformParameters, parsed.pivot, lengthUnit) : next);
            } else setTransformParameters(next);
          }}
          onApply={acceptTransform}
          onCancel={() => {
            chooseTool('select');
            setSelected([]);
          }}
          error={transformPreview && !transformPreview.ok ? transformPreview.message : undefined}
          releasedCount={transformPreview?.ok ? transformPreview.releasedConstraintIds.length : 0}
        />
      )}
      {transformNotice && (
        <div className="cad-create-size" role="status">
          {transformNotice}
        </div>
      )}
      {tool === 'split' && splitNotice && (
        <div className="cad-create-size" role="status">
          {splitNotice}
        </div>
      )}
      {tool === 'chamfer' && selected.length > 0 && (
        <SketchChamferForm
          distances={chamferDistances}
          preview={chamferPreview}
          selection={chamferSelection}
          onDistances={setChamferDistances}
          onApply={acceptChamfer}
          onCancel={() => {
            chooseTool('select');
            setSelected([]);
          }}
        />
      )}
      {tool === 'fillet' && selected.length > 0 && (
        <SketchFilletForm
          inputRef={filletInput}
          radius={filletRadius}
          preview={filletPreview}
          onRadius={setFilletRadius}
          onFocus={() => setFilletEditing(true)}
          onApply={acceptFillet}
          onCancel={() => {
            chooseTool('select');
            setSelected([]);
          }}
        />
      )}
    </>
  );
}
