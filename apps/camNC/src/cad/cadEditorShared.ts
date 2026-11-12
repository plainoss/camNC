import type { CadConstraint, CadDimensionMode, CadEntity } from '@wbcnc/cad';
import type { ConstraintCommandTool } from '@wbcnc/cad-editor/constraintCommands';
import type { SketchTool } from './sketchTools';

// Names shared by CadEditor and the modules split out of it.
export type Point = { x: number; y: number };
export type SketchPoint = Extract<CadEntity, { type: 'point' }>;
export type NumericConstraint = Extract<CadConstraint, { value: number }>;
export type Tool = SketchTool;
export type DimensionMode = CadDimensionMode;
export type ConstraintTool = ConstraintCommandTool;
export type View = { x: number; y: number; w: number; h: number };
export const initialView: View = { x: -35, y: -175, w: 300, h: 210 };
export const numeric = (c: CadConstraint): c is NumericConstraint => 'value' in c;
