import { t as translate } from '@wbcnc/i18n';
export type SketchTool =
  | 'select'
  | 'line'
  | 'rectangle'
  | 'centerRectangle'
  | 'alignedRectangle'
  | 'circle'
  | 'threePointCircle'
  | 'ellipse'
  | 'arc'
  | 'tangentArc'
  | 'centerPointArc'
  | 'point'
  | 'inscribedPolygon'
  | 'circumscribedPolygon'
  | 'split'
  | 'trim'
  | 'extend'
  | 'offset'
  | 'slot'
  | 'linearPattern'
  | 'circularPattern'
  | 'transform'
  | 'mirror'
  | 'dimension'
  | 'fillet'
  | 'chamfer'
  | 'conic'
  | 'spline'
  | 'bezier'
  | 'curveControlPoint';

export interface SketchToolDefinition {
  id: SketchTool;
  label: string;
  key?: string;
}

/** Shared command catalogue: toolbar, palette, shortcuts and their UX checks use the same choices. */
export const sketchTools: readonly SketchToolDefinition[] = [
  { id: 'select', label: translate('Select'), key: 'Esc' },
  { id: 'line', label: translate('Line'), key: 'L' },
  { id: 'rectangle', label: translate('Corner rectangle'), key: 'G' },
  { id: 'centerRectangle', label: translate('Center rectangle'), key: 'R' },
  { id: 'alignedRectangle', label: translate('Aligned rectangle') },
  { id: 'circle', label: translate('Circle'), key: 'C' },
  { id: 'threePointCircle', label: translate('3 point circle') },
  { id: 'ellipse', label: translate('Ellipse') },
  { id: 'arc', label: translate('Arc'), key: 'A' },
  { id: 'centerPointArc', label: translate('Center point arc') },
  { id: 'tangentArc', label: translate('Tangent arc'), key: 'Shift+A' },
  { id: 'conic', label: translate('Conic') },
  { id: 'spline', label: translate('Spline') },
  { id: 'bezier', label: translate('Bezier') },
  { id: 'curveControlPoint', label: translate('Spline control point') },
  { id: 'inscribedPolygon', label: translate('Inscribed polygon') },
  { id: 'circumscribedPolygon', label: translate('Circumscribed polygon') },
  { id: 'point', label: translate('Point'), key: 'Shift+S' },
  { id: 'chamfer', label: translate('Sketch chamfer') },
  { id: 'fillet', label: translate('Sketch fillet'), key: 'Shift+F' },
  { id: 'split', label: translate('Split') },
  { id: 'trim', label: translate('Trim'), key: 'M' },
  { id: 'extend', label: translate('Extend'), key: 'X' },
  { id: 'offset', label: translate('Offset'), key: 'O' },
  { id: 'slot', label: translate('Slot') },
  { id: 'linearPattern', label: translate('Linear pattern') },
  { id: 'circularPattern', label: translate('Circular pattern') },
  { id: 'transform', label: translate('Transform') },
  { id: 'mirror', label: translate('Mirror') },
  { id: 'dimension', label: translate('Dimension'), key: 'D' },
];

const modifyTools = {
  id: 'modify',
  label: translate('Modify tools'),
  tools: ['fillet', 'chamfer', 'split', 'trim', 'extend', 'offset', 'slot', 'mirror', 'transform', 'linearPattern', 'circularPattern'],
} as const;

/** Only the compact layout combines drawing commands; wide layouts retain their native families. */
export const sketchToolGroups = [
  {
    id: 'drawing',
    label: translate('Drawing tools'),
    tools: [
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
      'conic',
      'spline',
      'bezier',
      'curveControlPoint',
      'inscribedPolygon',
      'circumscribedPolygon',
      'point',
    ],
  },
  modifyTools,
] as const;

export const sketchToolFamilies = [
  { id: 'polygon', label: translate('Polygon tools'), tools: ['inscribedPolygon', 'circumscribedPolygon'] },
  { id: 'circle', label: translate('Circle tools'), tools: ['circle', 'threePointCircle', 'ellipse'] },
  { id: 'rectangle', label: translate('Rectangle tools'), tools: ['rectangle', 'centerRectangle', 'alignedRectangle'] },
  { id: 'arc', label: translate('Arc tools'), tools: ['arc', 'tangentArc', 'centerPointArc', 'conic'] },
  { id: 'spline', label: translate('Spline tools'), tools: ['spline', 'bezier', 'curveControlPoint'] },
  { id: 'trim', label: translate('Trim tools'), tools: ['trim', 'extend', 'split'] },
] as const;

export const sketchToolLabel = (tool: SketchToolDefinition) => (tool.key ? `${tool.label} (${tool.key})` : tool.label);
export const sketchToolSection = (tool: SketchTool) =>
  tool === 'inscribedPolygon' || tool === 'circumscribedPolygon'
    ? 'polygon'
    : tool === 'ellipse' || tool === 'threePointCircle'
      ? 'circle'
      : tool === 'centerRectangle' || tool === 'alignedRectangle'
        ? 'rectangle'
        : tool === 'tangentArc' || tool === 'centerPointArc'
          ? 'arc'
          : tool === 'split'
            ? 'trim'
            : tool === 'bezier' || tool === 'curveControlPoint'
              ? 'spline'
              : tool;
