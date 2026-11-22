import { t as translate } from '@wbcnc/i18n';
import type { SearchCommand } from './CommandSearch';
import { constraintPrompt } from '@wbcnc/cad-editor/constraintCommands';
import { sketchTools as tools } from './sketchTools';

/** What a sketch's tool search offers: its drawing tools, its constraints, and a few other commands. */
export const sketchSearchCommands: SearchCommand[] = [
  ...tools.map(t => ({
    ...t,
    description:
      t.id === 'circumscribedPolygon'
        ? translate('Sketch a regular polygon with its vertices on a circumscribing construction circle.')
        : t.id === 'inscribedPolygon'
          ? translate('Sketch a regular polygon around an inscribed construction circle.')
          : t.id === 'centerPointArc'
            ? translate('Sketch an arc by defining its center, start, and end points.')
            : t.id === 'ellipse'
              ? translate('Sketch an ellipse by defining its center point and two perpendicular axis radii.')
              : t.id === 'threePointCircle'
                ? translate('Sketch a circle by defining three points along its circumference.')
                : t.id === 'alignedRectangle'
                  ? translate('Sketch a rectangle from an oriented first edge and its perpendicular extent.')
                  : undefined,
  })),
  ...(
    [
      'horizontal',
      'vertical',
      'coincident',
      'concentric',
      'symmetric',
      'midpoint',
      'parallel',
      'perpendicular',
      'equal',
      'tangent',
      'normal',
      'pierce',
      'curvature',
    ] as const
  ).map(id => ({ id, label: id[0]!.toUpperCase() + id.slice(1), description: constraintPrompt(id) })),
  { id: 'construction', label: translate('Construction geometry'), key: 'Q' },
  { id: 'fix', label: translate('Fix / unfix'), key: 'Shift+J' },
  { id: 'fit', label: translate('Zoom to fit'), key: 'F' },
];
