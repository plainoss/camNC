import {
  addCenterRectangle,
  addRectangle,
  parseCadValue,
  type CadLengthUnit,
  type CadPoint,
  type CadSketch,
  type CadValueScope,
} from '@wbcnc/cad';

export type RectangleTool = 'rectangle' | 'centerRectangle';

export const isRectangleTool = (tool: string): tool is RectangleTool => tool === 'rectangle' || tool === 'centerRectangle';

export const rectanglePrompt = (tool: RectangleTool) =>
  `Click or drag from the ${tool === 'centerRectangle' ? 'center' : 'first corner'} to the opposite corner. Or enter sizes below.`;

export interface RectangleInput {
  lengthUnit?: CadLengthUnit;
  tool: RectangleTool;
  /** The first click: a corner, or the center of a center rectangle. */
  start: CadPoint;
  /** The opposite corner, clicked or dragged to. Without it the typed width and height are used. */
  end?: CadPoint;
  width?: string;
  height?: string;
  variables?: CadValueScope;
  construction?: boolean;
}

export type RectangleResult =
  | { sketch: CadSketch; sizeExpressions: Record<string, string | undefined>; error?: undefined }
  | { error: string; sketch?: undefined; sizeExpressions?: undefined };

/**
 * Adds a corner or center rectangle. Drawn to a point it is only shaped; made from typed sizes it is dimensioned, and an
 * expression typed for a size stays on that dimension.
 */
export function createRectangle(sketch: CadSketch, input: RectangleInput): RectangleResult {
  const { tool, start, end, construction } = input;
  const centered = tool === 'centerRectangle';
  const widthValue = end
    ? null
    : parseCadValue(input.width ?? '', { unit: 'mm', variables: input.variables, lengthUnit: input.lengthUnit });
  const heightValue = end
    ? null
    : parseCadValue(input.height ?? '', { unit: 'mm', variables: input.variables, lengthUnit: input.lengthUnit });
  if (widthValue && 'error' in widthValue) return { error: `Rectangle width: ${widthValue.error}` };
  if (heightValue && 'error' in heightValue) return { error: `Rectangle height: ${heightValue.error}` };
  const w = end ? (end.x - start.x) * (centered ? 2 : 1) : widthValue!.value;
  const h = end ? (end.y - start.y) * (centered ? 2 : 1) : heightValue!.value;
  if (!end && (w <= 0 || h <= 0)) return { error: 'Rectangle width and height must be greater than zero.' };
  if (!Number.isFinite(w) || !Number.isFinite(h) || Math.abs(w) < 0.1 || Math.abs(h) < 0.1)
    return { error: 'Width and height must be greater than zero.' };
  const next = (centered ? addCenterRectangle : addRectangle)(sketch, {
    x: centered ? start.x : Math.min(start.x, start.x + w),
    y: centered ? start.y : Math.min(start.y, start.y + h),
    width: Math.abs(w),
    height: Math.abs(h),
    construction,
    dimensioned: end === undefined,
  });
  return {
    sketch: next,
    sizeExpressions: end ? {} : { Width: widthValue?.expression, Height: heightValue?.expression },
  };
}
