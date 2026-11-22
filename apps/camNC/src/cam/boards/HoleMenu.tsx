import { t as translate } from '@wbcnc/i18n';
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
        <DropdownMenuLabel className="text-xs">
          {translate('Middle of this hole: ')}
          {+size.toFixed(0)}
          {translate(' mm')}
        </DropdownMenuLabel>
        {state === 'screwed' ? (
          <DropdownMenuItem disabled>{translate('A screw holds it. Remove the screw to clear it.')}</DropdownMenuItem>
        ) : (
          <>
            <DropdownMenuItem onSelect={() => onChoose('clear')}>
              <Check className={cn('size-3', state !== 'cleared' && 'invisible')} />
              {translate(' Clear it, about +')}
              {addMinutes.toFixed(1)}
              {translate(' min ')}
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => onChoose('leave')}>
              <Check className={cn('size-3', state === 'cleared' && 'invisible')} />{' '}
              {small ? translate('Leave it for the vacuum') : translate('Leave it: I’ll tape or screw it down')}
            </DropdownMenuItem>
            {choice && (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuItem onSelect={() => onChoose(undefined)}>{translate('Decide by its size and time')}</DropdownMenuItem>
              </>
            )}
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
