import type { ReactNode } from 'react';
import { Button } from '@wbcnc/ui/components/button';
import { LoadingSpinner } from '@wbcnc/ui/components/loading-spinner';
import { cn } from '@wbcnc/ui/lib/utils';
import { Image, Layers, SlidersHorizontal, Sparkles, Type, X } from 'lucide-react';

/** The Carve step shows one side panel at a time, opened from the board's toolbar; the board has the room otherwise. */
export type CarvePanel = 'items' | 'settings' | 'assistant';

const kTool =
  'group relative flex size-10 items-center justify-center rounded-md text-foreground hover:bg-muted aria-pressed:bg-violet-500/15 aria-pressed:text-violet-700 dark:aria-pressed:text-violet-300';

function Tool({
  label,
  pressed,
  busy,
  className,
  onClick,
  children,
}: {
  label: string;
  pressed?: boolean;
  busy?: boolean;
  className?: string;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={pressed}
      aria-busy={busy}
      title={label}
      className={cn(kTool, className)}
      onClick={onClick}>
      {children}
    </button>
  );
}

/** Adds lettering, a file or AI artwork, and opens the Items or Board and bit panel. */
export function CarveToolbar({
  panel,
  choosing,
  onText,
  onFile,
  onPanel,
}: {
  panel: CarvePanel | null;
  choosing: boolean;
  onText: () => void;
  onFile: () => void;
  onPanel: (panel: CarvePanel) => void;
}) {
  return (
    <div
      role="group"
      aria-label="Carve tools"
      className="absolute top-1/2 left-3 z-10 grid -translate-y-1/2 gap-1 rounded-xl border bg-background/95 p-1 shadow-md">
      <Tool label="Lettering" onClick={onText}>
        <Type className="size-[19px]" />
      </Tool>
      <Tool label="Open SVG" busy={choosing} onClick={onFile}>
        {choosing ? <LoadingSpinner className="size-4" aria-label="Opening file chooser" /> : <Image className="size-[19px]" />}
      </Tool>
      <Tool
        label="AI artwork"
        pressed={panel === 'assistant'}
        className="text-violet-600 dark:text-violet-300"
        onClick={() => onPanel('assistant')}>
        <Sparkles className="size-[19px]" />
      </Tool>
      <hr className="mx-1" />
      <Tool label="Items" pressed={panel === 'items'} onClick={() => onPanel('items')}>
        <Layers className="size-[19px]" />
      </Tool>
      <Tool label="Board and bit" pressed={panel === 'settings'} onClick={() => onPanel('settings')}>
        <SlidersHorizontal className="size-[19px]" />
      </Tool>
    </div>
  );
}

/** An empty board offers the three ways to start, where the artwork will go. */
export function CarveEmptyStart({ onText, onFile, onAssistant }: { onText: () => void; onFile: () => void; onAssistant: () => void }) {
  return (
    <div className="pointer-events-none absolute inset-0 flex items-center justify-center p-4">
      <div
        role="group"
        aria-label="Start your carving"
        className="pointer-events-auto grid justify-items-center gap-3 rounded-xl border bg-background p-4 shadow-lg">
        <p className="text-sm text-muted-foreground">Start your carving</p>
        <div className="flex flex-wrap justify-center gap-2">
          <Button variant="outline" size="sm" onClick={onText}>
            <Type /> Add lettering
          </Button>
          <Button variant="outline" size="sm" onClick={onFile}>
            <Image /> Open an SVG file
          </Button>
          <Button variant="outline" size="sm" className="border-violet-500 text-violet-700 dark:text-violet-300" onClick={onAssistant}>
            <Sparkles /> Describe it to AI
          </Button>
        </div>
      </div>
    </div>
  );
}

export function CarvePanelHeader({ title, icon, onClose }: { title: string; icon?: ReactNode; onClose: () => void }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <h3 className="flex items-center gap-1.5 font-medium">
        {icon}
        {title}
      </h3>
      <Button variant="ghost" size="icon" aria-label={`Close ${title}`} onClick={onClose}>
        <X />
      </Button>
    </div>
  );
}
