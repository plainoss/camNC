import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@wbcnc/ui/components/dialog';
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

/** The keyboard shortcuts that work where the keyboard is now, opened with `?` (Shift+/). */
export function ShortcutList({
  sections,
  open,
  onOpenChange,
}: {
  sections: ShortcutSection[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[80vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Keyboard shortcuts</DialogTitle>
          <DialogDescription>Press ? again or Escape to close.</DialogDescription>
        </DialogHeader>
        {sections.map(section => (
          <section key={section.title} aria-label={section.title}>
            <h3 className="mb-1 text-sm font-medium">{section.title}</h3>
            <dl className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-1 text-sm">
              {section.items.map(item => (
                <div key={item.label} className="contents">
                  <dt>{item.label}</dt>
                  <dd>
                    <kbd className="rounded border px-1.5 py-0.5 font-mono text-xs">{item.key}</kbd>
                  </dd>
                </div>
              ))}
            </dl>
          </section>
        ))}
      </DialogContent>
    </Dialog>
  );
}
