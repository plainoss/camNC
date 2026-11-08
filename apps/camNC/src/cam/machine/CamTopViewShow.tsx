import { Popover, PopoverContent, PopoverTrigger } from '@wbcnc/ui/components/popover';
import { cn } from '@wbcnc/ui/lib/utils';
import { Layers } from 'lucide-react';
import { useState } from 'react';
import { TooltipIconButton } from '@/visualize/toolbar/TooltipIconButton';
import { useCamMachine } from './camMachine';
import type { ShowInTopView } from './partGhost';

const kChoices: { value: ShowInTopView; label: string; hint: string }[] = [
  { value: 'program', label: 'This program', hint: 'Only the loaded program.' },
  { value: 'parts', label: '+ Parts', hint: 'The whole parts under it, faint: something to line a slot or a few holes up against.' },
  {
    value: 'all',
    label: '+ All programs',
    hint: 'The parts and every program on this side of the board, faint. Also while a program runs.',
  },
];

/**
 * In the top view while a CAM job is at the machine: what to show besides the loaded program. A view setting, so it's
 * a menu beside the view switcher rather than a bar over the camera image; a dot says more than the program shows.
 * Remembered on this device.
 */
export function CamTopViewShow() {
  const jobId = useCamMachine(s => s.jobId);
  const hasOverlay = useCamMachine(s => !!s.overlay?.parts);
  const show = useCamMachine(s => s.showInTopView);
  const setShow = useCamMachine(s => s.setShowInTopView);
  const [open, setOpen] = useState(false);
  if (!jobId || !hasOverlay) return null;
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <span className="relative inline-flex">
          <TooltipIconButton label="Show in the top view" icon={<Layers />} onClick={() => setOpen(true)} />
          {show !== 'program' && (
            <span aria-hidden className="pointer-events-none absolute top-2 right-1.5 size-1.5 rounded-full bg-primary" />
          )}
        </span>
      </PopoverTrigger>
      <PopoverContent align="start" className="dark w-72 p-1 text-foreground">
        <div role="radiogroup" aria-label="Show in the top view" className="flex flex-col">
          <div className="px-2 pt-1 pb-1.5 text-xs font-medium text-muted-foreground">Show in the top view</div>
          {kChoices.map(c => (
            <button
              key={c.value}
              role="radio"
              aria-checked={show === c.value}
              className="grid grid-cols-[1rem_1fr] gap-x-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-muted"
              onClick={() => {
                setShow(c.value);
                setOpen(false);
              }}>
              <span
                aria-hidden
                className={cn(
                  'mt-1 size-3.5 rounded-full border-2',
                  show === c.value
                    ? 'border-primary bg-[radial-gradient(circle,var(--primary)_40%,transparent_45%)]'
                    : 'border-muted-foreground'
                )}
              />
              <span>{c.label}</span>
              <span className="col-start-2 text-xs text-muted-foreground">{c.hint}</span>
            </button>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}
