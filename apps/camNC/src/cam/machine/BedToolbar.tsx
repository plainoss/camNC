import { cn } from '@wbcnc/ui/lib/utils';
import { Plus, Undo2 } from 'lucide-react';
import type { ReactNode } from 'react';
import { useBedEdit } from './bedEdit';

export const kBedButton = 'flex items-center gap-1 rounded px-1.5 py-1 hover:bg-muted disabled:pointer-events-none disabled:opacity-40';

/**
 * The bar beside the board in the top view, or beside the screw, clamp or part selected on it (`item`, with its own
 * buttons as children): Add (for the board), Undo, and below it what a tap or a drag does now, or why nothing changes.
 * The board's own tools come from `CamBedEditor`; a selected item's bar shows its buttons without them.
 */
export function BedToolbar({ item, children }: { item?: string; children?: ReactNode }) {
  const tools = useBedEdit(s => s.tools);
  const mode = useBedEdit(s => s.mode);
  const setMode = useBedEdit(s => s.setMode);
  if (!tools && !item) return null;
  const adding = mode === 'add';
  return (
    <div className="dark flex max-w-full flex-col items-start gap-1 text-xs text-foreground">
      <div
        role="toolbar"
        aria-label={item ?? `Edit board ${tools!.board}`}
        onPointerDown={e => e.stopPropagation()}
        className="flex max-w-full flex-wrap items-center gap-0.5 rounded-md border bg-background/95 p-0.5 shadow-md">
        {item && <span className="px-1.5 font-medium">{item}</span>}
        {children}
        {!item && tools?.hold && (
          <button
            aria-pressed={adding}
            title={`Tap the board where another ${tools.hold} goes.`}
            disabled={tools.blocked}
            className={cn(kBedButton, adding && 'bg-primary text-primary-foreground hover:bg-primary/90')}
            onClick={() => setMode(adding ? 'move' : 'add')}>
            <Plus className="size-3.5" /> Add {tools.hold}
          </button>
        )}
        {tools && (
          <button
            aria-label="Undo"
            title="Undo the last change here (⌘Z)"
            disabled={!tools.undo}
            className={kBedButton}
            onClick={() => tools.undo?.()}>
            <Undo2 className="size-3.5" />
          </button>
        )}
      </div>
      {tools && (
        <span
          className={cn(
            'max-w-full rounded bg-background/75 px-1.5 py-0.5 text-muted-foreground',
            tools.blocked ? 'text-amber-300' : adding && 'text-foreground'
          )}>
          {tools.note}
        </span>
      )}
    </div>
  );
}
