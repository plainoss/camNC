import type { ConstraintCommandTool } from '@wbcnc/cad-editor/constraintCommands';

/** The sketch's constraint tools, as the toolbar lists them, with their keys. */
export const sketchConstraints: { id: ConstraintCommandTool; label: string; key?: string }[] = [
  { id: 'horizontal', label: 'Horizontal', key: 'H' },
  { id: 'vertical', label: 'Vertical', key: 'V' },
  { id: 'coincident', label: 'Coincident', key: 'I' },
  { id: 'concentric', label: 'Concentric', key: 'Shift+O' },
  { id: 'symmetric', label: 'Symmetric', key: 'Shift+Q' },
  { id: 'midpoint', label: 'Midpoint', key: 'Shift+M' },
  { id: 'parallel', label: 'Parallel', key: 'B' },
  { id: 'perpendicular', label: 'Perpendicular', key: 'Shift+L' },
  { id: 'equal', label: 'Equal', key: 'E' },
  { id: 'tangent', label: 'Tangent', key: 'T' },
];
