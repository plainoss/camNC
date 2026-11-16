import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@wbcnc/ui/components/dialog';
import { useEffect, useState } from 'react';
import type { ShortcutSection, ShortcutTab } from './shortcuts';

const section = ({ title, items }: ShortcutSection) => (
  <section key={title} aria-label={title}>
    <h3 className="mb-1 text-sm font-medium">{title}</h3>
    <dl className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-1 text-sm">
      {items.map(item => (
        <div key={item.label} className="contents">
          <dt>{item.label}</dt>
          <dd>
            <kbd className="rounded border px-1.5 py-0.5 font-mono text-xs">{item.key}</kbd>
          </dd>
        </div>
      ))}
    </dl>
  </section>
);

/**
 * The keyboard shortcuts, opened with `?` (Shift+/): a tab for each part of the app, opening on `initial`, a search
 * across all of them, and what the key names stand for.
 */
export function ShortcutList({
  tabs,
  initial,
  open,
  onOpenChange,
}: {
  tabs: ShortcutTab[];
  /** The tab it opens on: the one for where the keyboard is now. */
  initial: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [tab, setTab] = useState(initial);
  const [query, setQuery] = useState('');
  // Each opening starts on the tab for where it was opened, with no search.
  useEffect(() => {
    if (!open) return;
    setTab(initial);
    setQuery('');
  }, [open, initial]);
  const search = query.trim().toLowerCase();
  const found = search
    ? tabs.flatMap(each =>
        each.sections.flatMap(({ title, items }) => {
          const matches = items.filter(item => item.label.toLowerCase().includes(search) || item.key.toLowerCase().includes(search));
          return matches.length ? [{ title: `${each.title} · ${title}`, items: matches }] : [];
        })
      )
    : [];
  const shown = tabs.find(each => each.title === tab) ?? tabs[0]!;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[80vh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Keyboard shortcuts</DialogTitle>
          <DialogDescription>Press ? again or Escape to close.</DialogDescription>
        </DialogHeader>
        <input
          type="search"
          aria-label="Search shortcuts"
          placeholder="Search shortcuts"
          className="rounded border px-2 py-1 text-sm"
          value={query}
          onChange={event => setQuery(event.target.value)}
        />
        {search ? (
          <div role="region" aria-label="Search results" className="grid gap-3">
            {found.length ? found.map(section) : <p className="text-sm">No shortcut matches “{query.trim()}”.</p>}
          </div>
        ) : (
          <>
            <div role="tablist" aria-label="Shortcut groups" className="flex flex-wrap gap-1 border-b pb-1 text-sm">
              {tabs.map(each => (
                <button
                  key={each.title}
                  type="button"
                  role="tab"
                  aria-selected={each.title === shown.title}
                  className={`rounded px-2 py-1 ${each.title === shown.title ? 'bg-accent font-medium' : ''}`}
                  onClick={() => setTab(each.title)}>
                  {each.title}
                </button>
              ))}
            </div>
            <div role="tabpanel" aria-label={shown.title} className="grid gap-3">
              {shown.sections.map(section)}
              {shown.note && <p className="text-sm text-muted-foreground">{shown.note}</p>}
            </div>
          </>
        )}
        <p className="text-xs text-muted-foreground" aria-label="Key legend">
          Shift ⇧ · Ctrl or ⌘ Command · Alt or ⌥ Option · Esc Escape · ↑ ↓ the arrow keys
        </p>
      </DialogContent>
    </Dialog>
  );
}
