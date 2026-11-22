import { t as translate } from '@wbcnc/i18n';
import { sketchConstraints } from './sketchConstraints';
import { sketchTools } from './sketchTools';

export interface ShortcutSection {
  /** Stable identity for behavior; the displayed title is localized. */
  id?: 'sketch-session';
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
  { label: translate('Undo'), key: 'Ctrl+Z' },
  { label: translate('Redo'), key: 'Ctrl+Shift+Z' },
];

/** A sketch's keys: its drawing tools and constraints, then the rest. */
export const sketchShortcuts: ShortcutSection[] = [
  {
    title: translate('Sketch tools'),
    items: sketchTools.filter(t => t.key && t.id !== 'select').map(t => ({ label: t.label, key: t.key! })),
  },
  {
    title: translate('Constraints'),
    items: [
      ...sketchConstraints.filter(c => c.key).map(c => ({ label: c.label, key: c.key! })),
      { label: translate('Fix / unfix'), key: 'Shift+J' },
    ],
  },
  {
    id: 'sketch-session',
    title: translate('Sketch'),
    items: [
      { label: translate('Construction geometry'), key: 'Q' },
      { label: translate('Zoom to fit'), key: 'F' },
      { label: translate('Search tools'), key: 'Alt+C' },
      { label: translate('Stop the tool, then clear the selection'), key: 'Esc' },
      ...undoRedo,
    ],
  },
];

/** Confirmation keeps the open studio sketch; standalone sketch editors keep their own Finish action. */
export const studioSketchShortcuts: ShortcutSection[] = sketchShortcuts.map(section =>
  section.id === 'sketch-session'
    ? {
        ...section,
        items: [
          { label: translate('Confirm sketch'), key: 'Ctrl/⌘+Enter' },
          { label: translate('Confirm sketch and extrude it'), key: 'Shift+E' },
          ...section.items,
        ],
      }
    : section
);

const general: ShortcutSection = {
  title: translate('General'),
  items: [
    { label: translate('Keyboard shortcuts'), key: 'Shift+/' },
    { label: translate('Cancel'), key: 'Esc' },
    { label: translate('Measure'), key: '[' },
    { label: translate('Search tools'), key: 'Alt+C' },
    ...undoRedo,
  ],
};

/** The Part Studio's keys, as its key handler reads them. */
const partStudio: ShortcutSection = {
  title: translate('Part Studio'),
  items: [
    { label: translate('Extrude'), key: 'Shift+E' },
    { label: translate('Fillet'), key: 'Shift+F' },
    { label: translate('Hide/show sketches'), key: 'Shift+H' },
    { label: translate('Hide/show planes'), key: 'P' },
    { label: translate('Move rollback bar'), key: '↑ ↓' },
    { label: translate('Sketch'), key: 'Shift+S' },
  ],
};

const view: ShortcutSection = {
  title: translate('3D view'),
  items: [
    { label: translate('Zoom to fit'), key: 'F' },
    { label: translate('Front, back, left, right, top, bottom, isometric'), key: 'Shift+1 … Shift+7' },
    { label: translate('View normal to the picked plane or face'), key: 'N' },
    { label: translate('Section view'), key: 'Shift+X' },
    { label: translate('Hide the part under the pointer'), key: 'Y' },
    { label: translate('Show all parts'), key: 'Shift+Y' },
    { label: translate('Make the part under the pointer transparent'), key: 'Shift+T' },
    { label: translate('Isolate the selected part'), key: 'Shift+I' },
  ],
};

const none = (what: string) => translate('camNC has no {{value1}} yet.', { value1: what });

/** The list's tabs, in the reference's order, with `sketch` as the Sketch tab. */
const shortcutTabs = (sketch: ShortcutSection[]): ShortcutTab[] => [
  { title: translate('General'), sections: [general] },
  { title: translate('Part Studio'), sections: [partStudio] },
  { title: translate('Assembly'), sections: [], note: none(translate('assemblies')) },
  { title: translate('3D view'), sections: [view] },
  { title: translate('Sketch'), sections: sketch },
  { title: translate('Feature Studio'), sections: [], note: none(translate('Feature Studio')) },
  { title: translate('Drawing'), sections: [], note: none(translate('drawings')) },
];

/** In the Part Studio, on General; in an open studio sketch, on Sketch, which lists confirming it. */
export const studioShortcuts = shortcutTabs(studioSketchShortcuts);
/** A sketch edited on its own. */
export const sketchShortcutTabs: ShortcutTab[] = [
  { title: translate('General'), sections: [general] },
  { title: translate('Sketch'), sections: sketchShortcuts },
];
