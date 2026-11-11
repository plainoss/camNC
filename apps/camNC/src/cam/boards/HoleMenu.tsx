import type { HoleChoice, HoleMiddle } from '@wbcnc/cam';
import { kVacuumSlug } from '@wbcnc/cam/settings';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@wbcnc/ui/components/dropdown-menu';
import { cn } from '@wbcnc/ui/lib/utils';
import { Check } from 'lucide-react';

/** What happens to the piece in the middle of a through hole, at that hole. For every copy of the part. */
export function HoleMenu({
  middle,
  left,
  top,
  onClose,
  onChoose,
}: {
  middle: HoleMiddle;
  left: number;
  top: number;
  onClose: () => void;
  onChoose: (choice: HoleChoice | undefined) => void;
}) {
  const { state, size, addMinutes, choice } = middle;
  const small = size <= kVacuumSlug;
  return (
    <DropdownMenu modal={false} open onOpenChange={open => !open && onClose()}>
      <DropdownMenuTrigger asChild>
        <span aria-hidden className="absolute" style={{ left, top }} />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start">
        <DropdownMenuLabel className="text-xs">Middle of this hole: {+size.toFixed(0)} mm</DropdownMenuLabel>
        {state === 'screwed' ? (
          <DropdownMenuItem disabled>A screw holds it. Remove the screw to clear it.</DropdownMenuItem>
        ) : (
          <>
            <DropdownMenuItem onSelect={() => onChoose('clear')}>
              <Check className={cn('size-3', state !== 'cleared' && 'invisible')} /> Clear it, about +{addMinutes.toFixed(1)} min
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => onChoose('leave')}>
              <Check className={cn('size-3', state === 'cleared' && 'invisible')} />{' '}
              {small ? 'Leave it for the vacuum' : 'Leave it: I’ll tape or screw it down'}
            </DropdownMenuItem>
            {choice && (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuItem onSelect={() => onChoose(undefined)}>Decide by its size and time</DropdownMenuItem>
              </>
            )}
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
