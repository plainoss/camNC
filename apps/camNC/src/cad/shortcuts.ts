import { sketchConstraints } from './SketchToolbar';
import { sketchTools } from './sketchTools';

export interface ShortcutSection {
  title: string;
  items: { label: string; key: string }[];
}

const undoRedo = [
  { label: 'Undo', key: 'Ctrl+Z' },
  { label: 'Redo', key: 'Ctrl+Shift+Z' },
];

/** The Part Studio's keys, as its key handler reads them. */
export const studioShortcuts: ShortcutSection[] = [
  {
    title: 'Part Studio',
    items: [
      { label: 'New sketch', key: 'Shift+S' },
      { label: 'Extrude', key: 'Shift+E' },
      { label: 'Search tools', key: 'Alt+C' },
      ...undoRedo,
    ],
  },
  {
    title: 'View',
    items: [
      { label: 'Zoom to fit', key: 'F' },
      { label: 'Front, back, left, right, top, bottom, isometric', key: 'Shift+1 … Shift+7' },
      { label: 'View normal to the picked plane or face', key: 'N' },
      { label: 'Show or hide planes', key: 'P' },
      { label: 'Hide the part under the pointer', key: 'Y' },
      { label: 'Show all parts', key: 'Shift+Y' },
      { label: 'Make the part under the pointer transparent', key: 'Shift+T' },
      { label: 'Isolate the selected part', key: 'Shift+I' },
    ],
  },
];

/** A sketch's keys: its drawing tools and constraints, then the rest. */
export const sketchShortcuts: ShortcutSection[] = [
  {
    title: 'Sketch tools',
    items: sketchTools.filter(t => t.key && t.id !== 'select').map(t => ({ label: t.label, key: t.key! })),
  },
  {
    title: 'Constraints',
    items: [...sketchConstraints.filter(c => c.key).map(c => ({ label: c.label, key: c.key! })), { label: 'Fix / unfix', key: 'Shift+J' }],
  },
  {
    title: 'Sketch',
    items: [
      { label: 'Construction geometry', key: 'Q' },
      { label: 'Zoom to fit', key: 'F' },
      { label: 'Search tools', key: 'Alt+C' },
      { label: 'Stop the tool, then clear the selection', key: 'Esc' },
      ...undoRedo,
    ],
  },
];
