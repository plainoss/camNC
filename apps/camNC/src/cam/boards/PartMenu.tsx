import { DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator } from '@wbcnc/ui/components/dropdown-menu';
import { Pin, PinOff, Plus } from 'lucide-react';
import { useState } from 'react';
import type { BoardV1 } from '../boards';
import { Hint } from '../Hint';

/** How a body is held on its board (tabs placed where they hold, or nothing that holds it); undefined without tabs. */
export type PartHolding = 'placed' | 'skin' | 'unheld';

export interface PartMenuProps {
  name: string;
  /** Other boards of its thickness. */
  targets: BoardV1[];
  onMoveTo: (board: string | 'new') => void;
  /** Why a board has no room for it ("full and can’t grow within the machine"), else undefined. */
  noRoom?: (board: BoardV1) => string | undefined;
  pinned: boolean;
  onUnpin: () => void;
  /** Its tabs were placed by hand: back to picked ones. */
  onTabsReset?: () => void;
}

/** The boards it can move to; one without room is shown, disabled, with why. */
function MoveTargets({ targets, onMoveTo, noRoom }: Pick<PartMenuProps, 'targets' | 'onMoveTo' | 'noRoom'>) {
  // Only mounted while the menu is open: each check nests the board with the body on it, once per opening.
  const [full] = useState(() => new Map(targets.map(b => [b.id, noRoom?.(b)])));
  return targets.map(b => (
    <DropdownMenuItem key={b.id} disabled={!!full.get(b.id)} onSelect={() => onMoveTo(b.id)}>
      Board {b.name}
      {full.get(b.id) && <span className="text-[10px] text-muted-foreground">{full.get(b.id)}</span>}
    </DropdownMenuItem>
  ));
}

/** A body's menu, the non-drag way to move it: to another board or a new one, unpin. */
export function PartMenuContent({ name, targets, onMoveTo, noRoom, pinned, onUnpin, onTabsReset }: PartMenuProps) {
  return (
    <DropdownMenuContent align="start">
      <DropdownMenuLabel className="text-xs">Move {name} to</DropdownMenuLabel>
      <MoveTargets targets={targets} onMoveTo={onMoveTo} noRoom={noRoom} />
      {targets.length > 0 && <DropdownMenuSeparator />}
      <DropdownMenuItem onSelect={() => onMoveTo('new')}>
        <Plus className="size-3" /> New board
      </DropdownMenuItem>
      {pinned && (
        <>
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={onUnpin}>
            <PinOff className="size-3" /> Unpin (auto-fill may move it)
          </DropdownMenuItem>
        </>
      )}
      {onTabsReset && (
        <>
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={onTabsReset}>Place its tabs automatically again</DropdownMenuItem>
        </>
      )}
    </DropdownMenuContent>
  );
}

/** What the drawing doesn't show of a body: placed by hand (pinned), and that its tabs can't hold it. */
export function PartBadges({ pinned, holding }: { pinned: boolean; holding?: PartHolding }) {
  return (
    <>
      {holding === 'unheld' && (
        <span
          className="rounded bg-destructive/15 px-1 text-[10px] text-destructive"
          title="No edge where tabs would hold it: move it, or switch the board to a bottom skin">
          can’t hold
        </span>
      )}
      {pinned && (
        <Hint text="Pinned: you placed it by hand, so auto-fill leaves it on this board. ⋯ › Unpin lets it move again.">
          <span role="img" aria-label="Placed by hand" tabIndex={0} className="rounded-full bg-background/80 p-0.5">
            <Pin className="size-3 text-muted-foreground" aria-hidden />
          </span>
        </Hint>
      )}
    </>
  );
}
