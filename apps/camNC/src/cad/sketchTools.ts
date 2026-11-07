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
  | 'trim'
  | 'extend'
  | 'offset'
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
  { id: 'select', label: 'Select', key: 'Esc' },
  { id: 'line', label: 'Line', key: 'L' },
  { id: 'rectangle', label: 'Corner rectangle', key: 'G' },
  { id: 'centerRectangle', label: 'Center rectangle', key: 'R' },
  { id: 'alignedRectangle', label: 'Aligned rectangle' },
  { id: 'circle', label: 'Circle', key: 'C' },
  { id: 'threePointCircle', label: '3 point circle' },
  { id: 'ellipse', label: 'Ellipse' },
  { id: 'arc', label: 'Arc', key: 'A' },
  { id: 'centerPointArc', label: 'Center point arc' },
  { id: 'tangentArc', label: 'Tangent arc', key: 'Shift+A' },
  { id: 'conic', label: 'Conic' },
  { id: 'spline', label: 'Spline' },
  { id: 'bezier', label: 'Bezier' },
  { id: 'curveControlPoint', label: 'Spline control point' },
  { id: 'inscribedPolygon', label: 'Inscribed polygon' },
  { id: 'circumscribedPolygon', label: 'Circumscribed polygon' },
  { id: 'point', label: 'Point', key: 'Shift+S' },
  { id: 'chamfer', label: 'Sketch chamfer' },
  { id: 'fillet', label: 'Sketch fillet', key: 'Shift+F' },
  { id: 'trim', label: 'Trim', key: 'M' },
  { id: 'extend', label: 'Extend', key: 'X' },
  { id: 'offset', label: 'Offset', key: 'O' },
  { id: 'mirror', label: 'Mirror' },
  { id: 'dimension', label: 'Dimension', key: 'D' },
];

const modifyTools = { id: 'modify', label: 'Modify tools', tools: ['fillet', 'chamfer', 'trim', 'extend', 'offset', 'mirror'] } as const;

/** Only the compact layout combines drawing commands; wide layouts retain their native families. */
export const sketchToolGroups = [
  {
    id: 'drawing',
    label: 'Drawing tools',
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
  { id: 'polygon', label: 'Polygon tools', tools: ['inscribedPolygon', 'circumscribedPolygon'] },
  { id: 'circle', label: 'Circle tools', tools: ['circle', 'threePointCircle', 'ellipse'] },
  { id: 'rectangle', label: 'Rectangle tools', tools: ['rectangle', 'centerRectangle', 'alignedRectangle'] },
  { id: 'arc', label: 'Arc tools', tools: ['arc', 'tangentArc', 'centerPointArc', 'conic'] },
  { id: 'spline', label: 'Spline tools', tools: ['spline', 'bezier', 'curveControlPoint'] },
  { id: 'trim', label: 'Trim tools', tools: ['trim', 'extend'] },
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
          : tool === 'bezier' || tool === 'curveControlPoint'
            ? 'spline'
            : tool;
