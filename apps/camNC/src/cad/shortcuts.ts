import { sketchConstraints } from './sketchConstraints';
import { sketchTools } from './sketchTools';

export interface ShortcutSection {
  title: string;
  items: { label: string; key: string }[];
}

/** A tab of the shortcut list: its sections, or a note when camNC has nothing there yet. */
export interface ShortcutTab {
  title: string;
  sections: ShortcutSection[];
  note?: string;
}

const undoRedo = [
  { label: 'Undo', key: 'Ctrl+Z' },
  { label: 'Redo', key: 'Ctrl+Shift+Z' },
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

/** Confirmation keeps the open studio sketch; standalone sketch editors keep their own Finish action. */
export const studioSketchShortcuts: ShortcutSection[] = sketchShortcuts.map(section =>
  section.title === 'Sketch'
    ? {
        ...section,
        items: [
          { label: 'Confirm sketch', key: 'Ctrl/⌘+Enter' },
          { label: 'Confirm sketch and extrude it', key: 'Shift+E' },
          ...section.items,
        ],
      }
    : section
);

const general: ShortcutSection = {
  title: 'General',
  items: [
    { label: 'Keyboard shortcuts', key: 'Shift+/' },
    { label: 'Cancel', key: 'Esc' },
    { label: 'Measure', key: '[' },
    { label: 'Search tools', key: 'Alt+C' },
    ...undoRedo,
  ],
};

/** The Part Studio's keys, as its key handler reads them. */
const partStudio: ShortcutSection = {
  title: 'Part Studio',
  items: [
    { label: 'Extrude', key: 'Shift+E' },
    { label: 'Fillet', key: 'Shift+F' },
    { label: 'Hide/show sketches', key: 'Shift+H' },
    { label: 'Hide/show planes', key: 'P' },
    { label: 'Move rollback bar', key: '↑ ↓' },
    { label: 'Sketch', key: 'Shift+S' },
  ],
};

const view: ShortcutSection = {
  title: '3D view',
  items: [
    { label: 'Zoom to fit', key: 'F' },
    { label: 'Front, back, left, right, top, bottom, isometric', key: 'Shift+1 … Shift+7' },
    { label: 'View normal to the picked plane or face', key: 'N' },
    { label: 'Section view', key: 'Shift+X' },
    { label: 'Hide the part under the pointer', key: 'Y' },
    { label: 'Show all parts', key: 'Shift+Y' },
    { label: 'Make the part under the pointer transparent', key: 'Shift+T' },
    { label: 'Isolate the selected part', key: 'Shift+I' },
  ],
};

const none = (what: string) => `camNC has no ${what} yet.`;

/** The list's tabs, in the reference's order, with `sketch` as the Sketch tab. */
const shortcutTabs = (sketch: ShortcutSection[]): ShortcutTab[] => [
  { title: 'General', sections: [general] },
  { title: 'Part Studio', sections: [partStudio] },
  { title: 'Assembly', sections: [], note: none('assemblies') },
  { title: '3D view', sections: [view] },
  { title: 'Sketch', sections: sketch },
  { title: 'Feature Studio', sections: [], note: none('Feature Studio') },
  { title: 'Drawing', sections: [], note: none('drawings') },
];

/** In the Part Studio, on General; in an open studio sketch, on Sketch, which lists confirming it. */
export const studioShortcuts = shortcutTabs(studioSketchShortcuts);
/** A sketch edited on its own. */
export const sketchShortcutTabs: ShortcutTab[] = [
  { title: 'General', sections: [general] },
  { title: 'Sketch', sections: sketchShortcuts },
];
