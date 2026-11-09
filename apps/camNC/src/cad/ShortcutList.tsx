import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@wbcnc/ui/components/dialog';
import type { ShortcutSection } from './shortcuts';

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
