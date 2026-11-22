import { t as translate } from '@wbcnc/i18n';
import type { ConstraintCommandTool } from '@wbcnc/cad-editor/constraintCommands';

/** The sketch's constraint tools, as the toolbar lists them, with their keys. */
export const sketchConstraints: { id: ConstraintCommandTool; label: string; key?: string }[] = [
  { id: 'horizontal', label: translate('Horizontal'), key: 'H' },
  { id: 'vertical', label: translate('Vertical'), key: 'V' },
  { id: 'coincident', label: translate('Coincident'), key: 'I' },
  { id: 'concentric', label: translate('Concentric'), key: 'Shift+O' },
  { id: 'symmetric', label: translate('Symmetric'), key: 'Shift+Q' },
  { id: 'midpoint', label: translate('Midpoint'), key: 'Shift+M' },
  { id: 'parallel', label: translate('Parallel'), key: 'B' },
  { id: 'perpendicular', label: translate('Perpendicular'), key: 'Shift+L' },
  { id: 'equal', label: translate('Equal'), key: 'E' },
  { id: 'tangent', label: translate('Tangent'), key: 'T' },
  { id: 'normal', label: translate('Normal'), key: 'Shift+K' },
  { id: 'pierce', label: translate('Pierce'), key: 'Shift+G' },
  { id: 'curvature', label: translate('Curvature'), key: 'Shift+U' },
];
